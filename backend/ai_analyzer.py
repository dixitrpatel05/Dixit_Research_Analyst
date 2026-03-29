import asyncio
import json
from typing import Any

try:
    from google import genai as genai_new
except Exception:
    genai_new = None

try:
    import google.generativeai as genai_legacy
except Exception:
    genai_legacy = None

from env import get_backend_key

_gemini_api_key = get_backend_key("gemini")
MODEL_CANDIDATES = ["gemini-2.0-flash", "gemini-1.5-flash"]

client_new = None
model_legacy = None
if _gemini_api_key and genai_new is not None:
    try:
        client_new = genai_new.Client(api_key=_gemini_api_key)
    except Exception:
        client_new = None

if _gemini_api_key and genai_legacy is not None:
    try:
        genai_legacy.configure(api_key=_gemini_api_key)
        model_legacy = genai_legacy.GenerativeModel("gemini-1.5-flash")
    except Exception:
        model_legacy = None


def _safe_json_load(text: str) -> dict:
    if not text:
        return {}

    raw = text.strip()
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass

    # Fallback for model responses that include extra text around JSON.
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            parsed = json.loads(raw[start : end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def call_gemini(prompt: str) -> dict:
    """Call Gemini and parse JSON response with retry logic."""
    if client_new is None and model_legacy is None:
        return {}

    def _wrap(payload: dict, source: str, model_name: str) -> dict:
        out = dict(payload)
        out["_ai_source"] = source
        out["_ai_model"] = model_name
        return out

    for attempt in range(3):
        try:
            if client_new is not None:
                for model_name in MODEL_CANDIDATES:
                    response = client_new.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "temperature": 0.1,
                            "response_mime_type": "application/json",
                        },
                    )
                    text = getattr(response, "text", "") or ""
                    parsed = _safe_json_load(text)
                    if parsed:
                        return _wrap(parsed, "google.genai", model_name)

            if model_legacy is not None:
                for model_name in MODEL_CANDIDATES:
                    legacy_model = genai_legacy.GenerativeModel(model_name)
                    response = legacy_model.generate_content(
                        prompt,
                        generation_config=genai_legacy.types.GenerationConfig(
                            temperature=0.1,
                            response_mime_type="application/json",
                        ),
                    )
                    parsed = _safe_json_load(getattr(response, "text", "") or "")
                    if parsed:
                        return _wrap(parsed, "google.generativeai", model_name)
        except Exception:
            if attempt == 2:
                return {}
    return {}


def _compact_json(payload: Any) -> str:
    try:
        return json.dumps(payload, indent=2, default=str)
    except Exception:
        return "{}"


def _safe_num(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _heuristic_catalyst_fallback(
    symbol: str,
    company_name: str,
    sector: str,
    fundamentals: dict,
    announcements: list[dict],
    bulk_deals: list[dict],
    insider_trades: list[dict],
    news_articles: list[dict],
) -> dict:
    catalyst_type = "SECTOR_TAILWIND"
    headline = "Momentum supported by sector and liquidity"
    evidence: list[str] = []

    if bulk_deals:
        catalyst_type = "INSTITUTIONAL_BUYING"
        headline = "Bulk activity indicates institutional participation"
        evidence.append(f"{len(bulk_deals)} bulk/block deal records detected in recent window")
    if insider_trades:
        catalyst_type = "INSIDER_BUY"
        headline = "Insider activity signaling management confidence"
        evidence.append(f"{len(insider_trades)} insider-trade records were available")
    if announcements:
        top = str((announcements[0] or {}).get("type") or "OTHER").upper()
        if top in {"ORDER_WIN", "CAPEX", "RESULTS", "BUYBACK", "BONUS"}:
            catalyst_type = top if top != "RESULTS" else "RESULTS_BEAT"
            headline = f"Recent {top.replace('_', ' ').title()} disclosure supporting rerating"
        evidence.append(f"{len(announcements)} corporate announcements available in last 90 days")
    if news_articles:
        evidence.append(f"{len(news_articles)} relevant news references captured")

    vs_200dma = _safe_num(fundamentals.get("price_vs_200dma"))
    rev_growth = _safe_num(fundamentals.get("revenue_growth_yoy"))
    roe = _safe_num(fundamentals.get("roe"))
    debt_equity = _safe_num(fundamentals.get("debt_equity"))

    confidence = 42
    if vs_200dma is not None:
        confidence += 8 if vs_200dma > 5 else 3 if vs_200dma > 0 else -2
    if rev_growth is not None:
        confidence += 8 if rev_growth > 15 else 4 if rev_growth > 5 else -3
    if roe is not None:
        confidence += 8 if roe > 15 else 3 if roe > 10 else -2
    if debt_equity is not None:
        confidence += 5 if debt_equity < 0.7 else 1 if debt_equity < 1.5 else -4
    confidence += min(10, len(news_articles)) // 2
    confidence += min(8, len(announcements)) // 2
    confidence += min(6, len(bulk_deals))
    confidence = max(35, min(82, int(confidence)))

    data_points = [announcements, bulk_deals, insider_trades, news_articles]
    non_empty = sum(1 for p in data_points if p)
    quality = "HIGH" if non_empty >= 3 else "MEDIUM" if non_empty >= 2 else "LOW"

    detail = (
        f"Heuristic catalyst scoring was used for {company_name} ({symbol}) due to limited model output. "
        f"The assessment blends trend data (price vs 200DMA: {vs_200dma if vs_200dma is not None else 'NA'}%), "
        f"fundamental momentum (revenue growth: {rev_growth if rev_growth is not None else 'NA'}%), and event flow across "
        f"announcements, news, and deal activity. Sector context for {sector or 'the sector'} remains a secondary support, "
        "while confidence is calibrated conservatively to reflect data certainty."
    )

    evidence = evidence[:3] or [
        "Fallback heuristic mode active due to limited model response",
        "Market and disclosure data were used as confidence anchors",
        "Re-run may produce richer catalyst narrative with additional inputs",
    ]

    return {
        "catalyst_type": catalyst_type,
        "catalyst_headline": headline,
        "catalyst_date": "NA",
        "catalyst_detail": detail,
        "supporting_evidence": evidence,
        "confidence_score": confidence,
        "impact_timeline": "3_MONTHS" if confidence >= 50 else "IMMEDIATE",
        "secondary_catalysts": ["Liquidity trend", "Sector sentiment"],
        "data_quality": quality,
    }


def _heuristic_fundamental_fallback(company_name: str, sector: str, fundamentals: dict, target_default: float | None) -> dict:
    rev_growth = _safe_num(fundamentals.get("revenue_growth_yoy"))
    roe = _safe_num(fundamentals.get("roe"))
    debt_equity = _safe_num(fundamentals.get("debt_equity"))
    pe = _safe_num(fundamentals.get("pe_ratio"))

    score = 50
    if rev_growth is not None:
        score += 12 if rev_growth > 15 else 7 if rev_growth > 8 else 2 if rev_growth > 0 else -6
    if roe is not None:
        score += 12 if roe > 18 else 7 if roe > 12 else 3 if roe > 8 else -5
    if debt_equity is not None:
        score += 8 if debt_equity < 0.5 else 4 if debt_equity < 1 else -6
    if pe is not None:
        score += -2 if pe > 45 else 2 if pe < 25 else 0
    score = max(35, min(84, int(score)))

    if score >= 75:
        rating = "STRONG_BUY"
    elif score >= 66:
        rating = "BUY"
    elif score >= 52:
        rating = "HOLD"
    elif score >= 43:
        rating = "SELL"
    else:
        rating = "STRONG_SELL"

    cmp_value = _safe_num(fundamentals.get("cmp"))
    # Convert fallback score into variable upside instead of constant 8%.
    upside_pct = max(-18.0, min(32.0, (score - 52) * 0.85)) if cmp_value is not None else None
    target_price = round(cmp_value * (1 + upside_pct / 100.0), 2) if cmp_value is not None and upside_pct is not None else target_default

    return {
        "business_description": f"{company_name} operates in {sector or 'its'} sector and was assessed using quantitative fallback scoring.",
        "revenue_trend": f"Revenue growth proxy is {rev_growth:.2f}% yoy." if rev_growth is not None else "Revenue trend could not be inferred.",
        "profitability_trend": f"ROE proxy is {roe:.2f}%." if roe is not None else "Profitability trend could not be inferred.",
        "balance_sheet_health": "STRONG" if (debt_equity is not None and debt_equity < 0.6) else "MODERATE" if (debt_equity is not None and debt_equity < 1.5) else "WEAK",
        "balance_sheet_comment": "Fallback assessment based on debt-equity and profitability proxies.",
        "shareholding_comment": "Detailed shareholding trend classification unavailable in fallback mode.",
        "promoter_concern": False,
        "valuation_vs_peers": "CHEAP" if (pe is not None and pe < 18) else "EXPENSIVE" if (pe is not None and pe > 40) else "FAIR",
        "valuation_comment": "Relative valuation estimated from available PE snapshot.",
        "key_strengths": ["Quantitative momentum", "Financial quality indicators", "Sector participation"],
        "key_concerns": ["Model fallback mode", "Limited narrative certainty"],
        "fundamental_score": score,
        "rating": rating,
        "target_price": target_price,
        "upside_pct": upside_pct,
        "rating_rationale": "Fallback rating is now computed from revenue growth, ROE, leverage, and valuation proxies instead of static defaults.",
    }


def _catalyst_prompt(
    symbol: str,
    company_name: str,
    sector: str,
    cmp_value: Any,
    high_52w: Any,
    low_52w: Any,
    vs_200dma: Any,
    announcements: list[dict],
    bulk_deals: list[dict],
    insider_trades: list[dict],
    news_articles: list[dict],
) -> str:
    return f"""You are a senior equity research analyst at a top Indian institutional brokerage. I will give you raw data about a stock. Your task is to identify the PRIMARY catalyst driving the recent price upmove.

STOCK: {symbol} — {company_name}
SECTOR: {sector}
PRICE PERFORMANCE: CMP ₹{cmp_value}, 52W High ₹{high_52w}, 52W Low ₹{low_52w}, vs 200DMA: {vs_200dma}%

NSE ANNOUNCEMENTS (last 90 days):
{_compact_json(announcements)}

BULK/BLOCK DEALS (last 30 days):
{_compact_json(bulk_deals)}

INSIDER TRADING:
{_compact_json(insider_trades)}

RECENT NEWS:
{_compact_json(news_articles[:10])}

Based on all this data, return a JSON object with EXACTLY these fields:
{{
  "catalyst_type": one of [INSTITUTIONAL_BUYING, ORDER_WIN, CAPEX, RESULTS_BEAT, BONUS_SPLIT, SECTOR_TAILWIND, INSIDER_BUY, REGULATORY_BENEFIT, MANAGEMENT_UPGRADE, MULTIPLE, OTHER],
  "catalyst_headline": string max 12 words summarizing the primary catalyst,
  "catalyst_date": "DD-MMM-YYYY" of when catalyst occurred,
  "catalyst_detail": string of 150-200 words detailed explanation with specific numbers and dates,
  "supporting_evidence": array of 3 strings, each a specific data point or news headline with date,
  "confidence_score": integer 0-100 based on strength of evidence,
  "impact_timeline": one of [IMMEDIATE, 3_MONTHS, 6_MONTHS, 12_MONTHS],
  "secondary_catalysts": array of 2 short strings for additional tailwinds,
  "data_quality": one of [HIGH, MEDIUM, LOW] based on how much data was available
}}
Return ONLY valid JSON, no markdown."""


def _fundamental_prompt(company_name: str, symbol: str, fundamentals: dict, peers: list[dict]) -> str:
    return f"""You are a fundamental equity analyst. Based on the financial data below for {company_name} NSE:{symbol}, provide analysis and scoring.

FINANCIAL DATA:
{_compact_json(fundamentals)}

PEER DATA:
{_compact_json(peers)}

Return JSON with:
{{
  "business_description": string 60 words,
  "revenue_trend": string 1 sentence on revenue trajectory,
  "profitability_trend": string 1 sentence on margin/PAT trend,
  "balance_sheet_health": one of [STRONG, MODERATE, WEAK],
  "balance_sheet_comment": string 30 words,
  "shareholding_comment": string on FII/promoter trend,
  "promoter_concern": boolean (true if pledging >10% or falling holding),
  "valuation_vs_peers": one of [CHEAP, FAIR, EXPENSIVE],
  "valuation_comment": string 30 words,
  "key_strengths": array of 3 strings,
  "key_concerns": array of 2 strings,
  "fundamental_score": integer 0-100,
  "rating": one of [STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL],
  "target_price": number (12-month target based on peer PE or EV/EBITDA),
  "upside_pct": number,
  "rating_rationale": string 80 words
}}
Return ONLY valid JSON."""


def _sector_risk_prompt(
    company_name: str,
    sector: str,
    sub_sector: str,
    sector_news: list[dict],
) -> str:
    return f"""You are a macro research analyst covering Indian equity markets.

COMPANY: {company_name}, SECTOR: {sector}, SUB-SECTOR: {sub_sector}

RECENT SECTOR NEWS:
{_compact_json(sector_news)}

Provide analysis JSON:
{{
  "sector_cycle_stage": one of [EARLY_UPCYCLE, MID_UPCYCLE, PEAK, EARLY_DOWNCYCLE, BOTTOM],
  "sector_outlook": one of [VERY_BULLISH, BULLISH, NEUTRAL, BEARISH],
  "sector_tailwinds": array of 3 strings with specific policy/demand drivers for India,
  "government_schemes": array of relevant PLI/budget/infra schemes benefiting this sector,
  "global_cues": string 2 sentences on global factors affecting this sector,
  "top_risks": array of 3 objects each {{risk_title: string, risk_detail: string 20 words, severity: HIGH|MEDIUM|LOW}},
  "investment_horizon": one of [SHORT_TERM, MEDIUM_TERM, LONG_TERM],
  "sector_leader_or_laggard": one of [LEADER, MID, LAGGARD] for this stock vs sector
}}
Return ONLY valid JSON."""


async def run_catalyst_analysis(
    symbol: str,
    company_name: str,
    sector: str,
    fundamentals: dict,
    announcements: list[dict],
    bulk_deals: list[dict],
    insider_trades: list[dict],
    news_articles: list[dict],
) -> dict:
    prompt = _catalyst_prompt(
        symbol=symbol,
        company_name=company_name,
        sector=sector,
        cmp_value=fundamentals.get("cmp"),
        high_52w=fundamentals.get("52w_high"),
        low_52w=fundamentals.get("52w_low"),
        vs_200dma=fundamentals.get("price_vs_200dma"),
        announcements=announcements,
        bulk_deals=bulk_deals,
        insider_trades=insider_trades,
        news_articles=news_articles,
    )
    return await asyncio.to_thread(call_gemini, prompt)


async def run_fundamental_analysis(
    symbol: str,
    company_name: str,
    fundamentals: dict,
    peers: list[dict],
) -> dict:
    prompt = _fundamental_prompt(
        company_name=company_name,
        symbol=symbol,
        fundamentals=fundamentals,
        peers=peers,
    )
    return await asyncio.to_thread(call_gemini, prompt)


async def run_sector_risk_analysis(
    company_name: str,
    sector: str,
    sub_sector: str,
    sector_news: list[dict],
) -> dict:
    prompt = _sector_risk_prompt(
        company_name=company_name,
        sector=sector,
        sub_sector=sub_sector,
        sector_news=sector_news,
    )
    return await asyncio.to_thread(call_gemini, prompt)


async def analyze_stock_with_gemini(
    symbol: str,
    company_name: str,
    sector: str,
    sub_sector: str,
    fundamentals: dict,
    announcements: list[dict],
    bulk_deals: list[dict],
    insider_trades: list[dict],
    news_articles: list[dict],
    peers: list[dict],
    sector_news: list[dict],
) -> dict:
    """
    Run 3 Gemini calls per stock and merge into one unified research result.
    Calls are intentionally sequential to reduce free-tier rate-limit pressure.
    """
    catalyst = await run_catalyst_analysis(
        symbol=symbol,
        company_name=company_name,
        sector=sector,
        fundamentals=fundamentals,
        announcements=announcements,
        bulk_deals=bulk_deals,
        insider_trades=insider_trades,
        news_articles=news_articles,
    )

    fundamentals_analysis = await run_fundamental_analysis(
        symbol=symbol,
        company_name=company_name,
        fundamentals=fundamentals,
        peers=peers,
    )

    sector_risk = await run_sector_risk_analysis(
        company_name=company_name,
        sector=sector,
        sub_sector=sub_sector,
        sector_news=sector_news,
    )

    cmp_value = fundamentals.get("cmp")
    target_default = round(float(cmp_value) * 1.08, 2) if isinstance(cmp_value, (int, float)) else None

    if not catalyst:
        catalyst = _heuristic_catalyst_fallback(
            symbol=symbol,
            company_name=company_name,
            sector=sector,
            fundamentals=fundamentals,
            announcements=announcements,
            bulk_deals=bulk_deals,
            insider_trades=insider_trades,
            news_articles=news_articles,
        )

    if not fundamentals_analysis:
        fundamentals_analysis = _heuristic_fundamental_fallback(
            company_name=company_name,
            sector=sector,
            fundamentals=fundamentals,
            target_default=target_default,
        )

    if not sector_risk:
        sector_risk = {
            "sector_cycle_stage": "MID_UPCYCLE",
            "sector_outlook": "NEUTRAL",
            "sector_tailwinds": ["Domestic demand", "Policy support", "Cost normalization"],
            "government_schemes": [],
            "global_cues": "Global commodity and rates environment remain mixed.",
            "top_risks": [
                {"risk_title": "Demand volatility", "risk_detail": "Demand swings can impact earnings visibility.", "severity": "MEDIUM"},
                {"risk_title": "Input costs", "risk_detail": "Input costs can compress margins in weaker cycles.", "severity": "MEDIUM"},
                {"risk_title": "Policy shifts", "risk_detail": "Regulatory changes may alter profitability assumptions.", "severity": "LOW"},
            ],
            "investment_horizon": "MEDIUM_TERM",
            "sector_leader_or_laggard": "MID",
        }

    ai_source = "heuristic"
    ai_model = "none"
    if isinstance(catalyst, dict) and catalyst.get("_ai_source"):
        ai_source = str(catalyst.get("_ai_source"))
        ai_model = str(catalyst.get("_ai_model") or "unknown")
    elif isinstance(fundamentals_analysis, dict) and fundamentals_analysis.get("_ai_source"):
        ai_source = str(fundamentals_analysis.get("_ai_source"))
        ai_model = str(fundamentals_analysis.get("_ai_model") or "unknown")

    if isinstance(catalyst, dict):
        catalyst.pop("_ai_source", None)
        catalyst.pop("_ai_model", None)
    if isinstance(fundamentals_analysis, dict):
        fundamentals_analysis.pop("_ai_source", None)
        fundamentals_analysis.pop("_ai_model", None)
    if isinstance(sector_risk, dict):
        sector_risk.pop("_ai_source", None)
        sector_risk.pop("_ai_model", None)

    return {
        "symbol": symbol,
        "company_name": company_name,
        "sector": sector,
        "sub_sector": sub_sector,
        "fundamentals": fundamentals,
        "catalyst_analysis": catalyst,
        "fundamental_analysis": fundamentals_analysis,
        "sector_risk_analysis": sector_risk,
        "inputs": {
            "announcements": announcements,
            "bulk_deals": bulk_deals,
            "insider_trades": insider_trades,
            "news_articles": news_articles,
            "peers": peers,
            "sector_news": sector_news,
        },
        "ai_pipeline": {
            "source": ai_source,
            "model": ai_model,
            "fallback_used": ai_source == "heuristic",
        },
    }
