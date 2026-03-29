import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    from google import genai as genai_new
except Exception:
    genai_new = None

try:
    import google.generativeai as genai_legacy
except Exception:
    genai_legacy = None

try:
    from groq import Groq as GroqClient
except Exception:
    GroqClient = None

from env import get_backend_key

_gemini_api_key = get_backend_key("gemini")
_groq_api_key = get_backend_key("groq")
MODEL_CANDIDATES = ["gemini-2.0-flash", "gemini-1.5-flash"]
GROQ_MODEL = "llama-3.3-70b-versatile"
DAILY_TOKEN_BUDGET_EST = 28000
LITE_MODE_TOKEN_THRESHOLD = 24000

_AI_BUDGET_STATE: dict[str, Any] = {
    "day": "",
    "reserved_tokens": 0,
    "calls": 0,
}

_SECTOR_MEMO_CACHE: dict[str, dict[str, Any]] = {}

client_new = None
model_legacy = None
groq_client = None

if _groq_api_key and GroqClient is not None:
    try:
        groq_client = GroqClient(api_key=_groq_api_key)
    except Exception:
        groq_client = None

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


def ai_client_status() -> dict:
    _reset_budget_if_needed()
    return {
        "api_key_present": bool(_gemini_api_key),
        "groq_api_key_present": bool(_groq_api_key),
        "groq_ready": groq_client is not None,
        "google_genai_ready": client_new is not None,
        "google_generativeai_ready": model_legacy is not None,
        "model_candidates": MODEL_CANDIDATES,
        "groq_model": GROQ_MODEL if groq_client is not None else None,
        "budget": {
            "daily_est_limit": DAILY_TOKEN_BUDGET_EST,
            "reserved_tokens": int(_AI_BUDGET_STATE.get("reserved_tokens") or 0),
            "remaining_est": max(0, DAILY_TOKEN_BUDGET_EST - int(_AI_BUDGET_STATE.get("reserved_tokens") or 0)),
            "calls": int(_AI_BUDGET_STATE.get("calls") or 0),
            "mode": "lite" if int(_AI_BUDGET_STATE.get("reserved_tokens") or 0) >= LITE_MODE_TOKEN_THRESHOLD else "standard",
        },
    }


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _reset_budget_if_needed() -> None:
    day = _today_key()
    if _AI_BUDGET_STATE.get("day") != day:
        _AI_BUDGET_STATE["day"] = day
        _AI_BUDGET_STATE["reserved_tokens"] = 0
        _AI_BUDGET_STATE["calls"] = 0


def _estimate_tokens(text: str) -> int:
    # Cheap approximation to avoid extra tokenizer dependency.
    return max(1, len(text or "") // 4)


def _reserve_budget(prompt: str, max_output_tokens: int) -> bool:
    _reset_budget_if_needed()
    est = _estimate_tokens(prompt) + max(64, int(max_output_tokens))
    used = int(_AI_BUDGET_STATE.get("reserved_tokens") or 0)
    if used + est > DAILY_TOKEN_BUDGET_EST:
        return False
    _AI_BUDGET_STATE["reserved_tokens"] = used + est
    _AI_BUDGET_STATE["calls"] = int(_AI_BUDGET_STATE.get("calls") or 0) + 1
    return True


def _current_mode() -> str:
    _reset_budget_if_needed()
    used = int(_AI_BUDGET_STATE.get("reserved_tokens") or 0)
    return "lite" if used >= LITE_MODE_TOKEN_THRESHOLD else "standard"


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


def call_gemini(prompt: str, max_output_tokens: int = 1400, mode: str = "standard") -> dict:
    """Call Groq (primary) then Gemini (fallback) with budget-aware, low-retry JSON parsing."""
    if groq_client is None and client_new is None and model_legacy is None:
        return {}

    if not _reserve_budget(prompt, max_output_tokens):
        return {}

    def _wrap(payload: dict, source: str, model_name: str) -> dict:
        out = dict(payload)
        out["_ai_source"] = source
        out["_ai_model"] = model_name
        return out

    lite = mode == "lite"

    # Try Groq first (faster, generous free tier)
    if groq_client is not None:
        try:
            response = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                temperature=0.1,
                max_tokens=900 if lite else max_output_tokens,
            )
            text = response.choices[0].message.content or ""
            parsed = _safe_json_load(text)
            if parsed:
                return _wrap(parsed, "groq", GROQ_MODEL)
        except Exception:
            pass

    # Fallback to Gemini with one-pass attempts to control token burn.
    try:
        if client_new is not None:
            for model_name in MODEL_CANDIDATES:
                for cfg in (
                    {"temperature": 0.1, "response_mime_type": "application/json"},
                    {"temperature": 0.1},
                ):
                    response = client_new.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=cfg,
                    )
                    text = getattr(response, "text", "") or ""
                    parsed = _safe_json_load(text)
                    if parsed:
                        return _wrap(parsed, "google.genai", model_name)

        if model_legacy is not None and not lite:
            for model_name in MODEL_CANDIDATES:
                legacy_model = genai_legacy.GenerativeModel(model_name)
                for generation_config in (
                    genai_legacy.types.GenerationConfig(
                        temperature=0.1,
                        response_mime_type="application/json",
                    ),
                    genai_legacy.types.GenerationConfig(
                        temperature=0.1,
                    ),
                ):
                    response = legacy_model.generate_content(
                        prompt,
                        generation_config=generation_config,
                    )
                    parsed = _safe_json_load(getattr(response, "text", "") or "")
                    if parsed:
                        return _wrap(parsed, "google.generativeai", model_name)
    except Exception:
        return {}
    return {}


def _compact_json(payload: Any, max_chars: int = 3500) -> str:
    try:
        text = json.dumps(payload, separators=(",", ":"), default=str)
        if len(text) > max_chars:
            return text[:max_chars] + "..."
        return text
    except Exception:
        return "{}"


def _safe_num(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _parse_any_date(value: Any) -> datetime | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None

    for fmt in (
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y",
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue

    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
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
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    announcements_recent = [
        a for a in announcements if _parse_any_date((a or {}).get("date")) is None or _parse_any_date((a or {}).get("date")) >= cutoff
    ]
    news_recent = [
        n
        for n in news_articles
        if _parse_any_date((n or {}).get("published_date") or (n or {}).get("date")) is None
        or _parse_any_date((n or {}).get("published_date") or (n or {}).get("date")) >= cutoff
    ]

    catalyst_type = "OTHER"
    headline = "No confirmed single catalyst yet"
    evidence: list[str] = []
    catalyst_date = "NA"

    if bulk_deals:
        catalyst_type = "INSTITUTIONAL_BUYING"
        headline = "Bulk activity indicates institutional participation"
        evidence.append(f"{len(bulk_deals)} bulk/block deal records detected in recent window")
    if insider_trades:
        catalyst_type = "INSIDER_BUY"
        headline = "Insider activity signaling management confidence"
        evidence.append(f"{len(insider_trades)} insider-trade records were available")
    if announcements_recent:
        top_row = announcements_recent[0] or {}
        top = str(top_row.get("type") or "OTHER").upper()
        if top in {"ORDER_WIN", "CAPEX", "RESULTS", "BUYBACK", "BONUS"}:
            catalyst_type = top if top != "RESULTS" else "RESULTS_BEAT"
            headline = f"Recent {top.replace('_', ' ').title()} disclosure supporting rerating"
        catalyst_date = str(top_row.get("date") or "NA")
        evidence.append(f"{len(announcements_recent)} corporate announcements available in last 90 days")
    if news_recent:
        evidence.append(f"{len(news_recent)} relevant news references captured in last 90 days")

    vs_200dma = _safe_num(fundamentals.get("price_vs_200dma"))
    rev_growth = _safe_num(fundamentals.get("revenue_growth_yoy"))
    roe = _safe_num(fundamentals.get("roe"))
    debt_equity = _safe_num(fundamentals.get("debt_equity"))

    confidence = 40
    if vs_200dma is not None:
        confidence += 8 if vs_200dma > 5 else 3 if vs_200dma > 0 else -2
    if rev_growth is not None:
        confidence += 8 if rev_growth > 15 else 4 if rev_growth > 5 else -3
    if roe is not None:
        confidence += 8 if roe > 15 else 3 if roe > 10 else -2
    if debt_equity is not None:
        confidence += 5 if debt_equity < 0.7 else 1 if debt_equity < 1.5 else -4
    confidence += min(10, len(news_recent)) // 2
    confidence += min(8, len(announcements_recent)) // 2
    confidence += min(6, len(bulk_deals))
    confidence = max(35, min(82, int(confidence)))

    if catalyst_type == "OTHER":
        if vs_200dma is not None and vs_200dma > 12:
            catalyst_type = "MULTIPLE"
            headline = "Momentum breakout with improving market participation"
        elif rev_growth is not None and rev_growth > 12:
            catalyst_type = "RESULTS_BEAT"
            headline = "Earnings momentum likely supporting rerating"
        elif debt_equity is not None and debt_equity < 0.6 and roe is not None and roe > 15:
            catalyst_type = "MANAGEMENT_UPGRADE"
            headline = "Quality balance-sheet profile attracting revaluation"

    data_points = [announcements_recent, bulk_deals, insider_trades, news_recent]
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
        "catalyst_date": catalyst_date,
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
    announcements_slim = announcements[:12]
    bulk_slim = bulk_deals[:12]
    insider_slim = insider_trades[:12]
    news_slim = news_articles[:12]

    return f"""You are a senior equity research analyst at a top Indian institutional brokerage. I will give you raw data about a stock. Your task is to identify the PRIMARY catalyst driving the recent price upmove.

STRICT TIME RULE: Use only catalysts from the latest 90 days. Ignore FY24/old historical events unless they had a fresh disclosure in the last 90 days.

STOCK: {symbol} — {company_name}
SECTOR: {sector}
PRICE PERFORMANCE: CMP ₹{cmp_value}, 52W High ₹{high_52w}, 52W Low ₹{low_52w}, vs 200DMA: {vs_200dma}%

NSE ANNOUNCEMENTS (last 90 days):
{_compact_json(announcements_slim)}

BULK/BLOCK DEALS (last 30 days):
{_compact_json(bulk_slim)}

INSIDER TRADING:
{_compact_json(insider_slim)}

RECENT NEWS (prefer last 90 days):
{_compact_json(news_slim)}

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
If there is no valid catalyst in the last 90 days, set catalyst_type="OTHER", confidence_score<=45, and explain data limitation.
Return ONLY valid JSON, no markdown."""


def _fundamental_prompt(company_name: str, symbol: str, fundamentals: dict, peers: list[dict]) -> str:
    peers_slim = peers[:8]
    return f"""You are a fundamental equity analyst. Based on the financial data below for {company_name} NSE:{symbol}, provide analysis and scoring.

FINANCIAL DATA:
{_compact_json(fundamentals)}

PEER DATA:
{_compact_json(peers_slim)}

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
    news_slim = sector_news[:10]
    return f"""You are a macro research analyst covering Indian equity markets.

COMPANY: {company_name}, SECTOR: {sector}, SUB-SECTOR: {sub_sector}

RECENT SECTOR NEWS:
{_compact_json(news_slim)}

Use only last 90-day evidence. Avoid generic statements; tie each risk/tailwind to current India market context and recent disclosures/news.

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


def _recent_sorted(items: list[dict], date_keys: tuple[str, ...], limit: int) -> list[dict]:
    def _get_dt(entry: dict) -> datetime:
        for key in date_keys:
            dt = _parse_any_date(entry.get(key))
            if dt is not None:
                return dt
        return datetime.min.replace(tzinfo=timezone.utc)

    out = [x for x in items if isinstance(x, dict)]
    out.sort(key=_get_dt, reverse=True)
    return out[:limit]


def _compact_inputs_for_model(
    announcements: list[dict],
    bulk_deals: list[dict],
    insider_trades: list[dict],
    news_articles: list[dict],
    peers: list[dict],
    sector_news: list[dict],
    mode: str,
) -> dict[str, list[dict]]:
    is_lite = mode == "lite"

    ann_limit = 5 if is_lite else 8
    deal_limit = 4 if is_lite else 6
    insider_limit = 4 if is_lite else 6
    news_limit = 6 if is_lite else 10
    peer_limit = 4 if is_lite else 6

    ann = _recent_sorted(announcements, ("date",), ann_limit)
    deals = _recent_sorted(bulk_deals, ("date",), deal_limit)
    insider = _recent_sorted(insider_trades, ("date",), insider_limit)
    news = _recent_sorted(news_articles, ("published_date", "date"), news_limit)
    sec_news = _recent_sorted(sector_news, ("published_date", "date"), news_limit)
    peers_slim = _recent_sorted(peers, ("date",), peer_limit)

    # Keep only high-signal fields to reduce token burn.
    ann = [{"date": a.get("date"), "type": a.get("type"), "headline": a.get("headline")} for a in ann]
    deals = [
        {
            "date": d.get("date"),
            "deal_type": d.get("deal_type"),
            "client": d.get("client_name"),
            "value_cr": d.get("value_cr"),
        }
        for d in deals
    ]
    insider = [
        {
            "date": i.get("date"),
            "person": i.get("person_name"),
            "type": i.get("transaction_type"),
            "value_lakh": i.get("value_lakh"),
        }
        for i in insider
    ]
    news = [
        {
            "date": n.get("published_date") or n.get("date"),
            "title": n.get("title"),
            "source": n.get("source"),
        }
        for n in news
    ]
    sec_news = [
        {
            "date": n.get("published_date") or n.get("date"),
            "title": n.get("title"),
            "source": n.get("source"),
        }
        for n in sec_news
    ]
    peers_slim = [
        {
            "name": p.get("name"),
            "symbol": p.get("symbol"),
            "pe": p.get("pe"),
            "roe": p.get("roe"),
            "revenue_growth": p.get("revenue_growth"),
        }
        for p in peers_slim
    ]

    return {
        "announcements": ann,
        "bulk_deals": deals,
        "insider_trades": insider,
        "news_articles": news,
        "sector_news": sec_news,
        "peers": peers_slim,
    }


def _unified_analysis_prompt(
    symbol: str,
    company_name: str,
    sector: str,
    sub_sector: str,
    fundamentals: dict,
    compact_inputs: dict[str, list[dict]],
    mode: str,
) -> str:
    max_words = "100" if mode == "lite" else "180"
    return f"""You are a senior Indian equities research analyst. Produce ONE strict JSON covering catalyst, fundamentals, and sector risk.

STRICT RULES:
1) Use only evidence from last 90 days for catalyst and sector-risk narrative.
2) Ignore stale reasons (e.g., FY24 old events) unless a fresh disclosure appears in last 90 days.
3) Be specific and data-backed, avoid generic filler.
4) Return ONLY valid JSON, no markdown.

MODE: {mode.upper()}
STOCK: {symbol} | COMPANY: {company_name} | SECTOR: {sector} | SUB-SECTOR: {sub_sector}

FUNDAMENTALS:
{_compact_json({
    "cmp": fundamentals.get("cmp"),
    "pe_ratio": fundamentals.get("pe_ratio"),
    "market_cap": fundamentals.get("market_cap"),
    "revenue_growth_yoy": fundamentals.get("revenue_growth_yoy"),
    "roe": fundamentals.get("roe"),
    "roce": fundamentals.get("roce"),
    "debt_equity": fundamentals.get("debt_equity"),
    "price_vs_50dma": fundamentals.get("price_vs_50dma"),
    "price_vs_200dma": fundamentals.get("price_vs_200dma"),
    "52w_high": fundamentals.get("52w_high"),
    "52w_low": fundamentals.get("52w_low"),
    "promoter_holding": fundamentals.get("promoter_holding"),
    "fii_holding": fundamentals.get("fii_holding"),
})}

ANNOUNCEMENTS(last 90d): {_compact_json(compact_inputs.get("announcements") or [])}
BULK DEALS(last 30d): {_compact_json(compact_inputs.get("bulk_deals") or [])}
INSIDER(last 90d): {_compact_json(compact_inputs.get("insider_trades") or [])}
NEWS(last 90d): {_compact_json(compact_inputs.get("news_articles") or [])}
SECTOR NEWS(last 90d): {_compact_json(compact_inputs.get("sector_news") or [])}
PEERS: {_compact_json(compact_inputs.get("peers") or [])}

Return JSON with exact top-level keys:
{{
  "catalyst_analysis": {{
    "catalyst_type": "INSTITUTIONAL_BUYING|ORDER_WIN|CAPEX|RESULTS_BEAT|BONUS_SPLIT|SECTOR_TAILWIND|INSIDER_BUY|REGULATORY_BENEFIT|MANAGEMENT_UPGRADE|MULTIPLE|OTHER",
    "catalyst_headline": "string max 12 words",
    "catalyst_date": "DD-MMM-YYYY or NA",
    "catalyst_detail": "string max {max_words} words",
    "supporting_evidence": ["3 concise evidence lines with dates"],
    "confidence_score": 0,
    "impact_timeline": "IMMEDIATE|3_MONTHS|6_MONTHS|12_MONTHS",
    "secondary_catalysts": ["2 short strings"],
    "data_quality": "HIGH|MEDIUM|LOW"
  }},
  "fundamental_analysis": {{
    "business_description": "string",
    "revenue_trend": "string",
    "profitability_trend": "string",
    "balance_sheet_health": "STRONG|MODERATE|WEAK",
    "balance_sheet_comment": "string",
    "shareholding_comment": "string",
    "promoter_concern": false,
    "valuation_vs_peers": "CHEAP|FAIR|EXPENSIVE",
    "valuation_comment": "string",
    "key_strengths": ["3 strings"],
    "key_concerns": ["2 strings"],
    "fundamental_score": 0,
    "rating": "STRONG_BUY|BUY|HOLD|SELL|STRONG_SELL",
    "target_price": 0,
    "upside_pct": 0,
    "rating_rationale": "string"
  }},
  "sector_risk_analysis": {{
    "sector_cycle_stage": "EARLY_UPCYCLE|MID_UPCYCLE|PEAK|EARLY_DOWNCYCLE|BOTTOM",
    "sector_outlook": "VERY_BULLISH|BULLISH|NEUTRAL|BEARISH",
    "sector_tailwinds": ["3 strings"],
    "government_schemes": ["up to 4 strings"],
    "global_cues": "string",
    "top_risks": [
      {{"risk_title":"string", "risk_detail":"string", "severity":"HIGH|MEDIUM|LOW"}},
      {{"risk_title":"string", "risk_detail":"string", "severity":"HIGH|MEDIUM|LOW"}},
      {{"risk_title":"string", "risk_detail":"string", "severity":"HIGH|MEDIUM|LOW"}}
    ],
    "investment_horizon": "SHORT_TERM|MEDIUM_TERM|LONG_TERM",
    "sector_leader_or_laggard": "LEADER|MID|LAGGARD"
  }}
}}"""


async def run_unified_analysis(
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
    mode: str,
) -> dict:
    compact = _compact_inputs_for_model(
        announcements=announcements,
        bulk_deals=bulk_deals,
        insider_trades=insider_trades,
        news_articles=news_articles,
        peers=peers,
        sector_news=sector_news,
        mode=mode,
    )
    prompt = _unified_analysis_prompt(
        symbol=symbol,
        company_name=company_name,
        sector=sector,
        sub_sector=sub_sector,
        fundamentals=fundamentals,
        compact_inputs=compact,
        mode=mode,
    )
    max_out = 900 if mode == "lite" else 1400
    return await asyncio.to_thread(call_gemini, prompt, max_out, mode)


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
    Run one unified AI call per stock to reduce token burn and improve free-tier throughput.
    """
    mode = _current_mode()

    ai_blob = await run_unified_analysis(
        symbol=symbol,
        company_name=company_name,
        sector=sector,
        sub_sector=sub_sector,
        fundamentals=fundamentals,
        announcements=announcements,
        bulk_deals=bulk_deals,
        insider_trades=insider_trades,
        news_articles=news_articles,
        peers=peers,
        sector_news=sector_news,
        mode=mode,
    )

    catalyst = ai_blob.get("catalyst_analysis") if isinstance(ai_blob.get("catalyst_analysis"), dict) else {}
    fundamentals_analysis = ai_blob.get("fundamental_analysis") if isinstance(ai_blob.get("fundamental_analysis"), dict) else {}
    sector_risk = ai_blob.get("sector_risk_analysis") if isinstance(ai_blob.get("sector_risk_analysis"), dict) else {}

    cmp_value = fundamentals.get("cmp")
    target_default = round(float(cmp_value) * 1.08, 2) if isinstance(cmp_value, (int, float)) else None

    # Guard against stale catalyst dates that violate the 90-day relevance rule.
    catalyst_date = _parse_any_date((catalyst or {}).get("catalyst_date")) if isinstance(catalyst, dict) else None
    if catalyst_date is not None and catalyst_date < (datetime.now(timezone.utc) - timedelta(days=90)):
        catalyst = {}

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

    sector_key = f"{_today_key()}::{(sector or 'UNKNOWN').upper()}::{(sub_sector or 'UNKNOWN').upper()}"
    cached_sector = _SECTOR_MEMO_CACHE.get(sector_key)
    if not sector_risk and cached_sector:
        sector_risk = dict(cached_sector)

    if not sector_risk:
        trend = _safe_num(fundamentals.get("price_vs_200dma"))
        rev = _safe_num(fundamentals.get("revenue_growth_yoy"))
        if trend is not None and trend > 8 and rev is not None and rev > 8:
            outlook = "BULLISH"
            stage = "MID_UPCYCLE"
        elif trend is not None and trend < -5:
            outlook = "BEARISH"
            stage = "EARLY_DOWNCYCLE"
        else:
            outlook = "NEUTRAL"
            stage = "MID_UPCYCLE"

        sector_risk = {
            "sector_cycle_stage": stage,
            "sector_outlook": outlook,
            "sector_tailwinds": [
                f"Recent demand signal for {sector} from last-quarter disclosures",
                "Domestic liquidity and participation remain supportive",
                "Earnings revisions can drive rerating when delivery sustains",
            ],
            "government_schemes": ["Budget capex pipeline", "PLI-linked manufacturing support"],
            "global_cues": "US rates, crude trend, and global risk appetite remain key external drivers over next 1-2 quarters.",
            "top_risks": [
                {
                    "risk_title": "Execution slippage",
                    "risk_detail": "Project/order execution delays can weaken near-term earnings delivery.",
                    "severity": "MEDIUM",
                },
                {
                    "risk_title": "Margin pressure",
                    "risk_detail": "Input cost or pricing pressure may impact EBITDA trajectory.",
                    "severity": "MEDIUM",
                },
                {
                    "risk_title": "Regulatory surprise",
                    "risk_detail": "Any policy shift may alter growth assumptions for the sector.",
                    "severity": "LOW",
                },
            ],
            "investment_horizon": "MEDIUM_TERM",
            "sector_leader_or_laggard": "MID",
        }

    if sector_risk:
        _SECTOR_MEMO_CACHE[sector_key] = dict(sector_risk)

    ai_source = str(ai_blob.get("_ai_source") or "heuristic")
    ai_model = str(ai_blob.get("_ai_model") or "none")
    if not ai_blob:
        ai_source = "heuristic"
        ai_model = "none"

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
            "mode": mode,
            "budget_remaining_est": max(0, DAILY_TOKEN_BUDGET_EST - int(_AI_BUDGET_STATE.get("reserved_tokens") or 0)),
        },
    }
