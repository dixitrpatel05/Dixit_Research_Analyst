# Dixit_Research_Analyst

Advanced multi-stock research dashboard for Indian equities with TradingView ticker input, 10-parameter verdicts, and per-stock PDF deep-dive reports.

## What Is Implemented

- Input accepts up to 50 tickers in TradingView format (examples: `NSE:RELIANCE`, `BSE:500325`, `RELIANCE`).
- Optional watchlist screenshot upload extracts symbols via OCR and carries image price references for validation.
- Direct clipboard paste is supported: user can press `Ctrl+V` / `Cmd+V` to paste watchlist screenshot instantly.
- Each new run clears previous dashboard results and executes fresh research.
- Dashboard renders exactly 12 columns:
	- Column 1: Stock
	- Columns 2-11: 10 research parameter verdicts
	- Column 12: PDF action
- Research API fetches data in parallel with concurrency control for speed.
- No persistent storage is used for completed runs.
- Full multi-page PDF report is generated server-side for each stock, including 10 narrative sections and charts.
- PDF now includes institutional-style layers: executive summary, key metrics snapshot, scenario grid, ranked risks, and prompt-by-prompt deep narrative.
- Data source is free public Yahoo Finance endpoints.

### OCR Input Verification

- Upload image in dashboard and OCR extracts rows like `SYMBOL + LAST`.
- Extracted symbols are normalized to NSE/BSE suffix format.
- Image `LAST` is stored as `referencePrice` and compared to live close (`referencePriceDiffPct`).
- Symbols that cannot be mapped are returned as unresolved errors, preventing silent wrong-stock selection.

## Current Parameter Set

The dashboard columns are mapped to the 10 dimensions in `instructions_research_analyst.txt`:

1. Core Analysis
2. 5Y Financials
3. Moat
4. Valuation
5. Risk
6. Growth Potential
7. Institutional View
8. Bull vs Bear
9. Earnings
10. Buy/Hold/Avoid

Label and model logic live in `app/src/lib/research/config.ts` and `app/src/lib/research/scoring.ts`.

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS 4 with custom CSS visual layer
- `yahoo-finance2` for market and fundamental snapshots
- `pdf-lib` for report generation
- `zod` for request validation
- `p-limit` for high-throughput controlled concurrency

## Run Locally

```bash
cd app
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Production Validation

```bash
cd app
npm run lint
npm run build
```

Both commands pass.

## Zero-Edit Deployment Env Setup (Vercel + Railway)

- Frontend runtime API proxy (`frontend/app/api/[...path]/route.ts`) resolves backend URL in this order:
	1. `BACKEND_API_URL`
	2. `RAILWAY_BACKEND_URL`
	3. `NEXT_PUBLIC_API_URL`
- If backend URL is missing or points to the frontend host, proxy returns explicit config error JSON instead of opaque 502.
- Backend auto-detects provider keys with aliases:
	- Gemini: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
	- Tavily: `TAVILY_API_KEY`, `TAVILY_KEY`
	- NewsData: `NEWSDATA_API_KEY`, `NEWSDATAIO_API_KEY`
	- GNews: `GNEWS_API_KEY`, `GNEWS_TOKEN`

This allows Railway/Vercel project environment variables to be used directly without editing source files.

## Next Accuracy Upgrade

The current model already includes institutional-weighted scoring and latest filing/insider freshness checks. A future upgrade can add extra NSE/BSE alternate free data adapters as optional fallback layers.