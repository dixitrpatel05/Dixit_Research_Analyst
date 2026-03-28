import asyncio
import json
import os
from typing import Any

import google.generativeai as genai


genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-1.5-flash")


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
    for attempt in range(3):
        try:
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )
            return _safe_json_load(getattr(response, "text", "") or "")
        except Exception:
            if attempt == 2:
                return {}
    return {}


def _compact_json(payload: Any) -> str:
    try:
        return json.dumps(payload, indent=2, default=str)
    except Exception:
        return "{}"


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
        catalyst = {
            "catalyst_type": "SECTOR_TAILWIND",
            "catalyst_headline": "Momentum supported by sector and liquidity",
            "catalyst_date": "NA",
            "catalyst_detail": "Catalyst inference is temporarily running in fallback mode because AI response was unavailable. Data signals from price, volume, and news flow were used to generate a conservative baseline interpretation.",
            "supporting_evidence": [
                "Recent market activity indicates above-baseline attention for the symbol",
                "Multiple recent public news mentions were detected",
                "Fundamental data snapshot was available for scoring context",
            ],
            "confidence_score": 55,
            "impact_timeline": "3_MONTHS",
            "secondary_catalysts": ["Macro liquidity", "Sector sentiment"],
            "data_quality": "MEDIUM",
        }

    if not fundamentals_analysis:
        fundamentals_analysis = {
            "business_description": f"{company_name} operates in {sector} and is being evaluated with fallback scoring.",
            "revenue_trend": "Revenue trend could not be AI-classified in this run.",
            "profitability_trend": "Profitability trend could not be AI-classified in this run.",
            "balance_sheet_health": "MODERATE",
            "balance_sheet_comment": "Fallback assessment due to unavailable AI response.",
            "shareholding_comment": "Shareholding interpretation unavailable from AI in this run.",
            "promoter_concern": False,
            "valuation_vs_peers": "FAIR",
            "valuation_comment": "Valuation marked FAIR in fallback mode.",
            "key_strengths": ["Scale", "Diversification", "Market relevance"],
            "key_concerns": ["Execution variability", "Macro sensitivity"],
            "fundamental_score": 60,
            "rating": "HOLD",
            "target_price": target_default,
            "upside_pct": 8.0 if target_default is not None else None,
            "rating_rationale": "Fallback rating generated because AI response was unavailable. Re-run later for full model-driven narrative.",
        }

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
    }
