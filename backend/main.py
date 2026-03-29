from __future__ import annotations

import asyncio
import io
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytesseract
from fastapi import FastAPI, File, Form, HTTPException, Path, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pydantic import BaseModel, Field

from env import get_backend_key, has_backend_key

from ai_analyzer import analyze_stock_with_gemini
from data_collectors import (
    bse_announcements,
    get_peer_data,
    newsdata_fetch,
    nse_announcements,
    nse_bulk_block_deals,
    nse_insider_trading,
    tavily_news_search,
    yfinance_fundamentals,
)
from pdf_generator import generate_pdf_bytes

app = FastAPI(title="AlphaDesk API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CACHE_TTL_HOURS = 24
RESEARCH_CACHE: dict[str, dict[str, Any]] = {}

# Conservative exclusion set so OCR does not emit obvious non-symbols.
SYMBOL_STOPWORDS = {
    "NSE",
    "BSE",
    "BUY",
    "SELL",
    "HOLD",
    "STRONG",
    "TARGET",
    "PRICE",
    "VOLUME",
    "OPEN",
    "HIGH",
    "LOW",
    "CLOSE",
    "DELIVERY",
    "QTY",
    "DAY",
    "WEEK",
    "MONTH",
    "TOTAL",
    "INDIA",
    "LIMITED",
    "LTD",
    "CMP",
}


class BatchResearchRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _cache_get(symbol: str) -> dict | None:
    key = symbol.upper()
    item = RESEARCH_CACHE.get(key)
    if not item:
        return None

    ts = item.get("timestamp")
    data = item.get("data")
    if not isinstance(ts, datetime) or not isinstance(data, dict):
        RESEARCH_CACHE.pop(key, None)
        return None

    if _now_utc() - ts > timedelta(hours=CACHE_TTL_HOURS):
        RESEARCH_CACHE.pop(key, None)
        return None

    enriched = dict(data)
    enriched["cache"] = {
        "status": "hit",
        "age_minutes": int((_now_utc() - ts).total_seconds() // 60),
    }
    return enriched


def _cache_set(symbol: str, data: dict) -> None:
    RESEARCH_CACHE[symbol.upper()] = {
        "timestamp": _now_utc(),
        "data": data,
    }


def _normalize_symbol(value: str) -> str:
    s = (value or "").strip().upper()
    s = s.replace("NSE:", "").replace("BSE:", "")
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


def _is_likely_symbol(token: str) -> bool:
    if not token or not (2 <= len(token) <= 10):
        return False
    if token in SYMBOL_STOPWORDS:
        return False
    if token.isdigit():
        return False
    return bool(re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", token))


def _extract_symbols_from_text(text: str) -> list[str]:
    raw = re.findall(r"\b[A-Z]{2,10}\b", (text or "").upper())
    out: list[str] = []
    seen: set[str] = set()
    for token in raw:
        if _is_likely_symbol(token) and token not in seen:
            seen.add(token)
            out.append(token)
    return out


def _prepare_image_variants(image: Image.Image) -> list[Image.Image]:
    base = image.convert("RGB")
    w, h = base.size

    variants: list[Image.Image] = [base]

    # Upscale narrow screenshots to improve OCR readability.
    if w < 1000:
        scale = max(2, int(1200 / max(w, 1)))
        upscaled = base.resize((w * scale, h * scale), Image.Resampling.LANCZOS)
        variants.append(upscaled)

    # Enhance contrast and sharpness for dark-theme watchlist screenshots.
    contrast = ImageEnhance.Contrast(base).enhance(2.0)
    sharp = ImageEnhance.Sharpness(contrast).enhance(2.2)
    variants.append(sharp)

    gray = ImageOps.grayscale(base)
    boosted = ImageEnhance.Contrast(gray).enhance(2.4)
    bw = boosted.point(lambda p: 255 if p > 140 else 0, mode="1").convert("RGB")
    variants.append(bw)

    denoised = base.filter(ImageFilter.MedianFilter(size=3))
    variants.append(denoised)

    # Deduplicate by dimensions and first bytes to avoid redundant OCR calls.
    unique: list[Image.Image] = []
    seen: set[tuple[int, int, bytes]] = set()
    for v in variants:
        key = (v.size[0], v.size[1], v.tobytes()[:128])
        if key in seen:
            continue
        seen.add(key)
        unique.append(v)
    return unique


def _extract_symbols_with_tesseract(image: Image.Image) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    configs = [
        "--psm 6 --oem 3",
        "--psm 11 --oem 3",
        "--psm 4 --oem 3",
    ]

    for variant in _prepare_image_variants(image):
        for cfg in configs:
            try:
                text = pytesseract.image_to_string(variant, config=cfg)
            except Exception:
                continue
            for sym in _extract_symbols_from_text(text):
                if sym not in seen:
                    seen.add(sym)
                    candidates.append(sym)
            if len(candidates) >= 8:
                return candidates
    return candidates


def _extract_symbols_from_model_text(raw: str) -> list[str]:
    if not raw:
        return []

    cleaned = raw.strip()
    out: list[str] = []
    seen: set[str] = set()

    # Try strict JSON first.
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict) and isinstance(parsed.get("symbols"), list):
            for token in parsed["symbols"]:
                sym = _normalize_symbol(str(token or ""))
                if _is_likely_symbol(sym) and sym not in seen:
                    seen.add(sym)
                    out.append(sym)
            if out:
                return out
    except Exception:
        pass

    # Fallback: extract uppercase tokens from free-form model output.
    for token in re.split(r"[^A-Za-z0-9:]+", cleaned):
        sym = _normalize_symbol(token)
        if _is_likely_symbol(sym) and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def _extract_symbols_with_gemini_vision(image: Image.Image) -> list[str]:
    api_key = get_backend_key("gemini")
    if not api_key:
        return []

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompts = [
            (
                "You are reading a TradingView watchlist screenshot with columns like Symbol and Last. "
                "Extract ticker symbols from the Symbol column only. "
                "Return strict JSON: {\"symbols\": [\"RELIANCE\", \"INFY\"]}. "
                "Rules: uppercase, max 10 chars, no prices, no bullets, no extra keys."
            ),
            (
                "List only ticker symbols visible in this watchlist image. "
                "One symbol per line, uppercase, no explanation, no numbering."
            ),
        ]

        best: list[str] = []
        for variant in _prepare_image_variants(image)[:3]:
            for idx, prompt in enumerate(prompts):
                response = model.generate_content(
                    [prompt, variant],
                    generation_config=genai.types.GenerationConfig(
                        temperature=0,
                        response_mime_type="application/json" if idx == 0 else "text/plain",
                    ),
                )
                raw = (getattr(response, "text", "") or "").strip()
                symbols = _extract_symbols_from_model_text(raw)
                if len(symbols) > len(best):
                    best = symbols
                if len(best) >= 5:
                    return best
        return best
    except Exception:
        return []


def _extract_symbols_from_image_bytes(content: bytes) -> list[str]:
    try:
        image = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception:
        return []

    symbols = _extract_symbols_with_tesseract(image)
    if symbols:
        return symbols

    # Fallback OCR path for environments where Tesseract binary is unavailable.
    return _extract_symbols_with_gemini_vision(image)


def _parse_manual_symbols(manual_symbols: str | None) -> list[str]:
    if not manual_symbols:
        return []
    chunks = re.split(r"[\s,;\n]+", manual_symbols)
    out: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        sym = _normalize_symbol(chunk)
        if _is_likely_symbol(sym) and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


async def _gnews_fetch(symbol: str, company_name: str) -> list[dict]:
    key = get_backend_key("gnews")
    if not key:
        return []

    try:
        url = "https://gnews.io/api/v4/search"
        params = {
            "q": company_name or symbol,
            "lang": "en",
            "token": key,
            "max": 10,
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()

        articles = payload.get("articles", []) if isinstance(payload, dict) else []
        out: list[dict] = []
        for item in articles:
            if not isinstance(item, dict):
                continue
            out.append(
                {
                    "title": item.get("title"),
                    "url": item.get("url"),
                    "content": (item.get("description") or "")[:200] or None,
                    "published_date": item.get("publishedAt"),
                    "relevance_score": None,
                    "source": (item.get("source") or {}).get("name"),
                }
            )
        return out
    except Exception:
        return []


async def _collect_news_with_fallback(symbol: str, company_name: str) -> tuple[list[dict], dict[str, str]]:
    tavily_task = tavily_news_search(symbol, company_name)
    newsdata_task = newsdata_fetch(symbol, company_name)
    gnews_task = _gnews_fetch(symbol, company_name)

    tavily_res, newsdata_res, gnews_res = await asyncio.gather(
        tavily_task,
        newsdata_task,
        gnews_task,
        return_exceptions=True,
    )

    tavily_items = tavily_res if isinstance(tavily_res, list) else []
    newsdata_items = newsdata_res if isinstance(newsdata_res, list) else []
    gnews_items = gnews_res if isinstance(gnews_res, list) else []

    if tavily_items:
        return tavily_items, {
            "selected": "tavily",
            "tavily": "ok",
            "newsdata": "ok" if newsdata_items else "empty",
            "gnews": "ok" if gnews_items else "empty",
        }

    if newsdata_items:
        normalized = [
            {
                "title": n.get("title"),
                "url": None,
                "content": (n.get("description") or "")[:200] or None,
                "published_date": n.get("pubDate"),
                "relevance_score": None,
                "source": n.get("source"),
            }
            for n in newsdata_items
            if isinstance(n, dict)
        ]
        return normalized, {
            "selected": "newsdata",
            "tavily": "empty",
            "newsdata": "ok",
            "gnews": "ok" if gnews_items else "empty",
        }

    if gnews_items:
        return gnews_items, {
            "selected": "gnews",
            "tavily": "empty",
            "newsdata": "empty",
            "gnews": "ok",
        }

    return [], {
        "selected": "none",
        "tavily": "empty",
        "newsdata": "empty",
        "gnews": "empty",
    }


async def run_research_pipeline(symbol: str) -> dict:
    symbol = _normalize_symbol(symbol)
    if not _is_likely_symbol(symbol):
        raise HTTPException(status_code=400, detail=f"Invalid symbol: {symbol}")

    cached = _cache_get(symbol)
    if cached:
        return cached

    fundamentals = await yfinance_fundamentals(symbol)
    company_name = str(fundamentals.get("company_name") or symbol)
    sector = str(fundamentals.get("sector") or "Unknown")
    sub_sector = str((fundamentals.get("_raw_info") or {}).get("industry") or "Unknown")

    announcements_task = nse_announcements(symbol)
    bulk_task = nse_bulk_block_deals(symbol)
    insider_task = nse_insider_trading(symbol)
    bse_task = bse_announcements(str((fundamentals.get("_raw_info") or {}).get("exchange") or ""))
    peers_task = get_peer_data(symbol, sector)
    news_task = _collect_news_with_fallback(symbol, company_name)

    (
        announcements_res,
        bulk_res,
        insider_res,
        bse_res,
        peers_res,
        news_bundle,
    ) = await asyncio.gather(
        announcements_task,
        bulk_task,
        insider_task,
        bse_task,
        peers_task,
        news_task,
        return_exceptions=True,
    )

    announcements = announcements_res if isinstance(announcements_res, list) else []
    bulk_deals = bulk_res if isinstance(bulk_res, list) else []
    insider_trades = insider_res if isinstance(insider_res, list) else []
    bse_items = bse_res if isinstance(bse_res, list) else []
    peers = peers_res if isinstance(peers_res, list) else []

    if isinstance(news_bundle, tuple) and len(news_bundle) == 2:
        news_articles = news_bundle[0] if isinstance(news_bundle[0], list) else []
        news_health = news_bundle[1] if isinstance(news_bundle[1], dict) else {}
    else:
        news_articles = []
        news_health = {
            "selected": "none",
            "tavily": "error",
            "newsdata": "error",
            "gnews": "error",
        }

    sector_news = news_articles[:10]

    ai_result = await analyze_stock_with_gemini(
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
    )

    catalyst_analysis = ai_result.get("catalyst_analysis") if isinstance(ai_result.get("catalyst_analysis"), dict) else {}
    fundamental_analysis = ai_result.get("fundamental_analysis") if isinstance(ai_result.get("fundamental_analysis"), dict) else {}

    unified = {
        **ai_result,
        # Flatten key fields for frontend/API consumers expecting top-level values.
        "catalyst_type": catalyst_analysis.get("catalyst_type"),
        "rating": fundamental_analysis.get("rating"),
        "target_price": fundamental_analysis.get("target_price"),
        "generated_at": _now_utc().isoformat(),
        "cache": {"status": "miss", "age_minutes": 0},
        "inputs": {
            **(ai_result.get("inputs") or {}),
            "bse_announcements": bse_items,
        },
        "source_health": {
            "yfinance": "ok" if fundamentals.get("cmp") is not None else "partial",
            "nse_announcements": "ok" if announcements else "empty",
            "nse_bulk_block": "ok" if bulk_deals else "empty",
            "nse_insider": "ok" if insider_trades else "empty",
            "bse": "ok" if bse_items else "empty",
            "news": news_health,
            "gemini": "ok" if ai_result.get("catalyst_analysis") else "partial",
        },
    }

    _cache_set(symbol, unified)
    return unified


@app.post("/api/ocr")
async def ocr_extract_symbols(
    file: UploadFile | None = File(default=None),
    manual_symbols: str | None = Form(default=None),
) -> JSONResponse:
    symbols: list[str] = []

    if file is not None:
        try:
            content = await file.read()
            ocr_symbols = await asyncio.to_thread(_extract_symbols_from_image_bytes, content)
            symbols.extend(ocr_symbols)
        except Exception:
            # Do not fail if OCR fails; manual input can still proceed.
            pass

    manual = _parse_manual_symbols(manual_symbols)
    for sym in manual:
        if sym not in symbols:
            symbols.append(sym)

    return JSONResponse(content={"symbols": symbols})


@app.post("/api/research/batch")
async def batch_research(payload: BatchResearchRequest) -> StreamingResponse:
    symbols = [_normalize_symbol(s) for s in payload.symbols]
    symbols = [s for s in symbols if _is_likely_symbol(s)]

    if not symbols:
        raise HTTPException(status_code=400, detail="No valid symbols provided")

    semaphore = asyncio.Semaphore(3)
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def worker(sym: str) -> None:
        await queue.put({"symbol": sym, "status": "loading", "stage": "starting"})
        async with semaphore:
            try:
                await queue.put({"symbol": sym, "status": "loading", "stage": "fetching_data"})
                result = await run_research_pipeline(sym)
                await queue.put({"symbol": sym, "status": "complete", "result": result})
            except Exception as exc:
                await queue.put(
                    {
                        "symbol": sym,
                        "status": "error",
                        "error": str(exc),
                    }
                )
            finally:
                await queue.put({"symbol": sym, "status": "done"})

    tasks = [asyncio.create_task(worker(sym)) for sym in symbols]

    async def event_generator():
        completed = 0
        total = len(tasks)

        try:
            while completed < total:
                event = await queue.get()
                if event.get("status") == "done":
                    completed += 1
                    continue
                yield f"data: {json.dumps(event, default=str)}\n\n"

            yield f"data: {json.dumps({'status': 'finished', 'total': total})}\n\n"
        finally:
            await asyncio.gather(*tasks, return_exceptions=True)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)


@app.post("/api/research/{symbol}")
async def research_symbol(symbol: str = Path(..., min_length=2, max_length=15)) -> JSONResponse:
    result = await run_research_pipeline(symbol)
    return JSONResponse(content=result)


@app.get("/api/report/{symbol}/pdf")
async def get_report_pdf(symbol: str = Path(..., min_length=2, max_length=15)) -> StreamingResponse:
    result = await run_research_pipeline(symbol)
    pdf_bytes = generate_pdf_bytes(result)

    filename = f"{_normalize_symbol(symbol)}_alphadesk_report.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)


@app.get("/api/health")
async def health() -> JSONResponse:
    env_health = {
        "gemini": has_backend_key("gemini"),
        "tavily": has_backend_key("tavily"),
        "newsdata": has_backend_key("newsdata"),
        "gnews": has_backend_key("gnews"),
    }

    return JSONResponse(
        content={
            "status": "ok",
            "time": _now_utc().isoformat(),
            "cache_entries": len(RESEARCH_CACHE),
            "data_sources": {
                "yfinance": "operational",
                "nse": "operational",
                "bse": "operational",
                "tavily": "operational" if env_health["tavily"] else "missing_key",
                "newsdata": "operational" if env_health["newsdata"] else "missing_key",
                "gnews": "operational" if env_health["gnews"] else "missing_key",
                "gemini": "operational" if env_health["gemini"] else "missing_key",
            },
        }
    )
