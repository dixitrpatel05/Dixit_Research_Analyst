import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import yfinance as yf
from bs4 import BeautifulSoup
from tavily import TavilyClient


NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
}


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _safe_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    candidates = [
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y",
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
    ]
    raw = value.strip()
    for fmt in candidates:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    try:
        # Last resort: allow ISO-like values with timezone.
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _stringify_date(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.strftime("%d-%b-%Y")


def _classify_announcement(subject: str) -> str:
    text = (subject or "").upper()
    if any(k in text for k in ["ORDER", "CONTRACT", "LOA", "LETTER OF AWARD"]):
        return "ORDER_WIN"
    if any(k in text for k in ["CAPEX", "EXPANSION", "PLANT", "CAPITAL EXPENDITURE"]):
        return "CAPEX"
    if "BONUS" in text:
        return "BONUS"
    if "BUYBACK" in text:
        return "BUYBACK"
    if "QIP" in text or "QUALIFIED INSTITUTIONAL" in text:
        return "QIP"
    if "AGM" in text or "ANNUAL GENERAL MEETING" in text:
        return "AGM"
    if any(k in text for k in ["RESULT", "EARNINGS", "QUARTERLY"]):
        return "RESULTS"
    if "INSIDER" in text:
        return "INSIDER_TRADE"
    return "OTHER"


async def _nse_get_json(endpoint: str) -> Any:
    url = f"https://www.nseindia.com{endpoint}"
    timeout = httpx.Timeout(20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        await client.get("https://www.nseindia.com", headers=NSE_HEADERS)
        response = await client.get(url, headers=NSE_HEADERS)
        response.raise_for_status()
        return response.json()


def _sum_quarterly_row(df: Any, row_name: str) -> float | None:
    try:
        if df is None or row_name not in df.index:
            return None
        row = df.loc[row_name]
        values = [float(v) for v in row.values if v is not None]
        if not values:
            return None
        return float(sum(values[:4]))
    except Exception:
        return None


def _latest_row_value(df: Any, row_name: str) -> float | None:
    try:
        if df is None or row_name not in df.index:
            return None
        row = df.loc[row_name]
        vals = [v for v in row.values if v is not None]
        if not vals:
            return None
        return float(vals[0])
    except Exception:
        return None


def _yoy_growth(current: float | None, previous: float | None) -> float | None:
    try:
        if current is None or previous is None or previous == 0:
            return None
        return ((current - previous) / abs(previous)) * 100.0
    except Exception:
        return None


async def yfinance_fundamentals(symbol: str) -> dict:
    """
    Collect financial and market metrics for NSE symbols using yfinance.
    Missing metrics are returned as None and this function never raises.
    """
    try:
        ticker = await asyncio.to_thread(yf.Ticker, f"{symbol}.NS")
        info = await asyncio.to_thread(lambda: ticker.info or {})

        financials = await asyncio.to_thread(lambda: ticker.financials)
        quarterly_financials = await asyncio.to_thread(lambda: ticker.quarterly_financials)
        balance_sheet = await asyncio.to_thread(lambda: ticker.balance_sheet)
        institutional_holders = await asyncio.to_thread(lambda: ticker.institutional_holders)
        major_holders = await asyncio.to_thread(lambda: ticker.major_holders)

        company_name = info.get("longName") or info.get("shortName") or symbol
        sector = info.get("sector")

        revenue_ttm = _sum_quarterly_row(quarterly_financials, "Total Revenue")
        pat_ttm = _sum_quarterly_row(quarterly_financials, "Net Income")

        annual_revenue_current = _latest_row_value(financials, "Total Revenue")
        annual_revenue_prev = None
        try:
            if financials is not None and "Total Revenue" in financials.index:
                vals = [float(v) for v in financials.loc["Total Revenue"].values if v is not None]
                if len(vals) > 1:
                    annual_revenue_prev = vals[1]
        except Exception:
            annual_revenue_prev = None

        revenue_growth_yoy = _yoy_growth(annual_revenue_current, annual_revenue_prev)

        total_debt = _latest_row_value(balance_sheet, "Total Debt")
        total_equity = _latest_row_value(balance_sheet, "Stockholders Equity")
        debt_equity = None
        if total_debt is not None and total_equity not in (None, 0):
            debt_equity = total_debt / total_equity
        elif info.get("debtToEquity") is not None:
            debt_equity = _safe_float(info.get("debtToEquity"))
            if debt_equity is not None and debt_equity > 10:
                debt_equity = debt_equity / 100.0

        roe = _safe_float(info.get("returnOnEquity"))
        if roe is not None and abs(roe) <= 1.0:
            roe *= 100.0

        # ROCE is not always provided directly; fallback to returnOnAssets proxy if needed.
        roce = _safe_float(info.get("returnOnCapital"))
        if roce is None:
            roce = _safe_float(info.get("returnOnAssets"))
        if roce is not None and abs(roce) <= 1.0:
            roce *= 100.0

        promoter_holding = None
        fii_holding = None
        try:
            promoter_holding = _safe_float(info.get("heldPercentInsiders"))
            if promoter_holding is not None and promoter_holding <= 1.0:
                promoter_holding *= 100.0
        except Exception:
            promoter_holding = None

        try:
            fii_holding = _safe_float(info.get("heldPercentInstitutions"))
            if fii_holding is not None and fii_holding <= 1.0:
                fii_holding *= 100.0
        except Exception:
            fii_holding = None

        # If tabular holders data exists, try to derive an institutional estimate.
        try:
            if fii_holding is None and institutional_holders is not None and not institutional_holders.empty:
                shares_col = next((c for c in institutional_holders.columns if "Shares" in c), None)
                if shares_col and info.get("sharesOutstanding"):
                    total_inst_shares = float(institutional_holders[shares_col].sum())
                    so = float(info.get("sharesOutstanding"))
                    if so > 0:
                        fii_holding = (total_inst_shares / so) * 100.0
        except Exception:
            pass

        cmp_price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        dma_200 = _safe_float(info.get("twoHundredDayAverage"))
        dma_50 = _safe_float(info.get("fiftyDayAverage"))

        price_vs_200dma = None
        if cmp_price is not None and dma_200 not in (None, 0):
            price_vs_200dma = ((cmp_price - dma_200) / dma_200) * 100.0

        price_vs_50dma = None
        if cmp_price is not None and dma_50 not in (None, 0):
            price_vs_50dma = ((cmp_price - dma_50) / dma_50) * 100.0

        return {
            "company_name": company_name,
            "sector": sector,
            "market_cap": _safe_float(info.get("marketCap")),
            "cmp": cmp_price,
            "pe_ratio": _safe_float(info.get("trailingPE") or info.get("forwardPE")),
            "revenue_ttm": revenue_ttm,
            "pat_ttm": pat_ttm,
            "revenue_growth_yoy": revenue_growth_yoy,
            "debt_equity": debt_equity,
            "roe": roe,
            "roce": roce,
            "promoter_holding": promoter_holding,
            "fii_holding": fii_holding,
            "52w_high": _safe_float(info.get("fiftyTwoWeekHigh")),
            "52w_low": _safe_float(info.get("fiftyTwoWeekLow")),
            "avg_volume_20d": _safe_int(info.get("averageVolume") or info.get("averageDailyVolume10Day")),
            "current_volume": _safe_int(info.get("volume") or info.get("regularMarketVolume")),
            "price_vs_200dma": price_vs_200dma,
            "price_vs_50dma": price_vs_50dma,
            # Keep raw slices for optional downstream diagnostics.
            "_raw_info": info,
            "_raw_major_holders": getattr(major_holders, "to_dict", lambda: None)(),
        }
    except Exception:
        return {
            "company_name": symbol,
            "sector": None,
            "market_cap": None,
            "cmp": None,
            "pe_ratio": None,
            "revenue_ttm": None,
            "pat_ttm": None,
            "revenue_growth_yoy": None,
            "debt_equity": None,
            "roe": None,
            "roce": None,
            "promoter_holding": None,
            "fii_holding": None,
            "52w_high": None,
            "52w_low": None,
            "avg_volume_20d": None,
            "current_volume": None,
            "price_vs_200dma": None,
            "price_vs_50dma": None,
        }


async def nse_announcements(symbol: str) -> list[dict]:
    """
    Fetch recent NSE corporate announcements with basic event-type classification.
    """
    try:
        payload = await _nse_get_json(f"/api/corp-announcements?index=equities&symbol={symbol.upper()}")
        rows = payload.get("data", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            return []

        cutoff = datetime.now() - timedelta(days=90)
        out: list[dict] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            subject = str(item.get("subject") or item.get("sm_name") or item.get("desc") or "")
            raw_date = item.get("broadcastDt") or item.get("an_dt") or item.get("dt") or item.get("date")
            dt = _parse_date(str(raw_date) if raw_date is not None else None)
            if dt and dt < cutoff:
                continue

            attachment = item.get("attchmntFile") or item.get("attchmnt") or item.get("url")
            if attachment and isinstance(attachment, str) and attachment.startswith("/"):
                attachment = f"https://www.nseindia.com{attachment}"

            out.append(
                {
                    "date": _stringify_date(dt) or (str(raw_date) if raw_date else None),
                    "type": _classify_announcement(subject),
                    "headline": subject,
                    "url": attachment,
                }
            )
        return out
    except Exception:
        return []


async def nse_bulk_block_deals(symbol: str) -> list[dict]:
    """
    Combine NSE bulk and block deals and filter by symbol over the last 30 days.
    """
    try:
        bulk_payload, block_payload = await asyncio.gather(
            _nse_get_json("/api/bulk-deals"),
            _nse_get_json("/api/block-deals"),
            return_exceptions=True,
        )

        datasets: list[Any] = []
        if not isinstance(bulk_payload, Exception):
            datasets.append(bulk_payload)
        if not isinstance(block_payload, Exception):
            datasets.append(block_payload)

        cutoff = datetime.now() - timedelta(days=30)
        target = symbol.upper()
        output: list[dict] = []

        for payload in datasets:
            rows = payload.get("data", payload) if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                continue
            for item in rows:
                if not isinstance(item, dict):
                    continue
                raw_symbol = str(item.get("symbol") or item.get("symbolName") or item.get("smb") or "").upper()
                if target not in raw_symbol:
                    continue

                raw_date = item.get("date") or item.get("tradeDate") or item.get("dttm")
                dt = _parse_date(str(raw_date) if raw_date is not None else None)
                if dt and dt < cutoff:
                    continue

                qty = _safe_float(item.get("quantity") or item.get("qty") or item.get("quantityTraded"))
                price = _safe_float(item.get("price") or item.get("tradePrice") or item.get("wap"))
                value_cr = None
                if qty is not None and price is not None:
                    value_cr = (qty * price) / 1e7

                output.append(
                    {
                        "date": _stringify_date(dt) or (str(raw_date) if raw_date else None),
                        "client_name": item.get("clientName") or item.get("buyerName") or item.get("sellerName"),
                        "deal_type": item.get("dealType") or item.get("tradeType") or item.get("buySell") or "UNKNOWN",
                        "quantity": _safe_int(qty),
                        "price": price,
                        "value_cr": value_cr,
                    }
                )
        return output
    except Exception:
        return []


async def nse_insider_trading(symbol: str) -> list[dict]:
    """
    Fetch insider transaction announcements from NSE endpoint.
    """
    try:
        endpoint = f"/api/corporate-announcements?symbol={symbol.upper()}&issuer=&subject=&fromDate=&toDate=&type=insider"
        payload = await _nse_get_json(endpoint)
        rows = payload.get("data", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            return []

        output: list[dict] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            raw_date = item.get("date") or item.get("broadcastDt") or item.get("an_dt")
            dt = _parse_date(str(raw_date) if raw_date is not None else None)

            qty = _safe_float(item.get("qty") or item.get("quantity") or item.get("shares"))
            value_lakh = _safe_float(item.get("value") or item.get("valueLakh") or item.get("amount"))
            if value_lakh is None:
                price = _safe_float(item.get("price") or item.get("tradePrice"))
                if qty is not None and price is not None:
                    value_lakh = (qty * price) / 1e5

            output.append(
                {
                    "date": _stringify_date(dt) or (str(raw_date) if raw_date else None),
                    "person_name": item.get("personName") or item.get("name") or item.get("acquirerName"),
                    "designation": item.get("designation") or item.get("category") or item.get("personCategory"),
                    "transaction_type": item.get("transactionType") or item.get("action") or item.get("buySell"),
                    "quantity": _safe_int(qty),
                    "value_lakh": value_lakh,
                }
            )

        return output
    except Exception:
        return []


async def bse_announcements(bse_code: str) -> list[dict]:
    """
    Fetch BSE announcements and return the latest significant items.
    """
    try:
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        url = (
            "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
            f"?pageno=1&strCat=-1&strPrevDate={date_str}&strScrip={bse_code}"
            f"&strSearch=P&strToDate={date_str}&strType=C"
        )
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.bseindia.com/",
        }
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()

        body = resp.text.strip()
        parsed: Any
        try:
            parsed = resp.json()
        except Exception:
            # Some responses can be HTML wrappers around JSON/script payloads.
            soup = BeautifulSoup(body, "lxml")
            text = soup.get_text(" ", strip=True)
            json_match = re.search(r"(\{.*\}|\[.*\])", text)
            parsed = json.loads(json_match.group(1)) if json_match else []

        rows = parsed.get("Table", parsed.get("table", parsed)) if isinstance(parsed, dict) else parsed
        if not isinstance(rows, list):
            return []

        output: list[dict] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            headline = str(item.get("HEADLINE") or item.get("News_Sub") or item.get("SUBCATNAME") or "").strip()
            raw_date = item.get("NEWS_DT") or item.get("DissemDT") or item.get("DATE")
            dt = _parse_date(str(raw_date) if raw_date is not None else None)
            if not headline:
                continue
            output.append(
                {
                    "date": _stringify_date(dt) or (str(raw_date) if raw_date else None),
                    "headline": headline,
                    "url": item.get("ATTACHMENTNAME") or item.get("NSURL") or item.get("Attachment"),
                }
            )

        return output[:10]
    except Exception:
        return []


async def tavily_news_search(symbol: str, company_name: str) -> list[dict]:
    """
    Run 3 targeted Tavily queries and merge top relevant articles.
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return []

    queries = [
        f"{company_name} NSE stock order win contract news 2025 2026",
        f"{company_name} institutional buying FII bulk deal India",
        f"{company_name} quarterly results earnings profit India",
    ]

    try:
        client = TavilyClient(api_key=api_key)

        def _search_once(query: str) -> dict:
            return client.search(query=query, search_depth="advanced", max_results=5)

        responses = await asyncio.gather(*[asyncio.to_thread(_search_once, q) for q in queries], return_exceptions=True)

        merged: list[dict] = []
        seen: set[str] = set()
        for result in responses:
            if isinstance(result, Exception) or not isinstance(result, dict):
                continue
            for item in result.get("results", []):
                if not isinstance(item, dict):
                    continue
                url = item.get("url")
                if not url or url in seen:
                    continue
                seen.add(url)
                content = (item.get("content") or "").strip()
                merged.append(
                    {
                        "title": item.get("title"),
                        "url": url,
                        "content": content[:200] if content else None,
                        "published_date": item.get("published_date"),
                        "relevance_score": _safe_float(item.get("score")),
                    }
                )

        merged.sort(key=lambda x: x.get("relevance_score") or 0.0, reverse=True)
        return merged
    except Exception:
        return []


async def newsdata_fetch(symbol: str, company_name: str) -> list[dict]:
    """
    Fetch business news from NewsData.io for the company.
    """
    api_key = os.getenv("NEWSDATA_API_KEY")
    if not api_key:
        return []

    url = "https://newsdata.io/api/1/news"
    params = {
        "apikey": api_key,
        "q": company_name or symbol,
        "language": "en",
        "category": "business",
        "timeframe": "48",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()

        rows = payload.get("results", []) if isinstance(payload, dict) else []
        output = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            output.append(
                {
                    "title": item.get("title"),
                    "description": item.get("description"),
                    "pubDate": item.get("pubDate"),
                    "source": item.get("source_id") or item.get("source_name"),
                }
            )
        return output
    except Exception:
        return []


SECTOR_PEER_MAP: dict[str, list[str]] = {
    "Financial Services": ["HDFCBANK", "ICICIBANK", "KOTAKBANK", "SBIN"],
    "Technology": ["INFY", "TCS", "WIPRO", "HCLTECH"],
    "Energy": ["RELIANCE", "ONGC", "IOC", "BPCL"],
    "Consumer Defensive": ["HINDUNILVR", "ITC", "DABUR", "NESTLEIND"],
    "Industrials": ["LT", "SIEMENS", "ABB", "CUMMINSIND"],
    "Healthcare": ["SUNPHARMA", "DRREDDY", "CIPLA", "LUPIN"],
    "Basic Materials": ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL"],
    "Utilities": ["NTPC", "POWERGRID", "ADANIPOWER", "TATAPOWER"],
}


async def get_peer_data(symbol: str, sector: str | None) -> list[dict]:
    """
    Build a small peer set (up to 3) from sector defaults and yfinance snapshots.
    """
    try:
        raw_peers = SECTOR_PEER_MAP.get(sector or "", [])
        peers = [s for s in raw_peers if s.upper() != symbol.upper()][:3]

        # Fallback list when sector is unknown.
        if not peers:
            peers = [s for s in ["RELIANCE", "TCS", "HDFCBANK", "INFY"] if s.upper() != symbol.upper()][:3]

        async def _fetch(peer_symbol: str) -> dict:
            try:
                t = await asyncio.to_thread(yf.Ticker, f"{peer_symbol}.NS")
                info = await asyncio.to_thread(lambda: t.info or {})
                return {
                    "name": info.get("longName") or peer_symbol,
                    "symbol": peer_symbol,
                    "pe": _safe_float(info.get("trailingPE") or info.get("forwardPE")),
                    "roe": (
                        (_safe_float(info.get("returnOnEquity")) * 100.0)
                        if _safe_float(info.get("returnOnEquity")) is not None
                        and abs(_safe_float(info.get("returnOnEquity"))) <= 1
                        else _safe_float(info.get("returnOnEquity"))
                    ),
                    "market_cap": _safe_float(info.get("marketCap")),
                    "revenue_growth": (
                        (_safe_float(info.get("revenueGrowth")) * 100.0)
                        if _safe_float(info.get("revenueGrowth")) is not None
                        and abs(_safe_float(info.get("revenueGrowth"))) <= 1
                        else _safe_float(info.get("revenueGrowth"))
                    ),
                }
            except Exception:
                return {
                    "name": peer_symbol,
                    "symbol": peer_symbol,
                    "pe": None,
                    "roe": None,
                    "market_cap": None,
                    "revenue_growth": None,
                }

        results = await asyncio.gather(*[_fetch(p) for p in peers], return_exceptions=False)
        return results
    except Exception:
        return []
