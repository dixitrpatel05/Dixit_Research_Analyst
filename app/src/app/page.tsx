"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { RESEARCH_PARAMETERS } from "@/lib/research/config";
import { ParsedWatchlistRow, parseWatchlistText } from "@/lib/research/imageParse";
import { ResearchParameterKey, StockResearchRow } from "@/lib/research/types";

function parseInput(raw: string): string[] {
  return raw
    .split(/[\n,\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function verdictClass(verdict: string): string {
  if (verdict === "Bullish") {
    return "pill pill-bullish";
  }
  if (verdict === "Neutral") {
    return "pill pill-neutral";
  }
  return "pill pill-cautious";
}

type SortKey = "stock" | "catalyst" | ResearchParameterKey;

async function preprocessImageForOcr(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = bitmap.width * scale;
  canvas.height = bitmap.height * scale;

  const context = canvas.getContext("2d");
  if (!context) {
    return blob;
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const boosted = gray > 140 ? 255 : 0;
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }

  context.putImageData(imageData, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((processed) => resolve(processed ?? blob), "image/png", 1);
  });
}

export default function Home() {
  const [tickerInput, setTickerInput] = useState("NSE:RELIANCE, NSE:TCS, NSE:HDFCBANK");
  const [imageRows, setImageRows] = useState<ParsedWatchlistRow[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractInfo, setExtractInfo] = useState<string | null>(null);
  const [rows, setRows] = useState<StockResearchRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("stock");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const tickerCount = useMemo(() => parseInput(tickerInput).length, [tickerInput]);

  const sortedRows = useMemo(() => {
    const next = [...rows];
    next.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;

      if (sortKey === "stock") {
        const compare = a.companyName.localeCompare(b.companyName);
        return sortDirection === "asc" ? compare : -compare;
      }

      if (sortKey === "catalyst") {
        aVal = a.catalystScore;
        bVal = b.catalystScore;
      } else {
        aVal = a.parameterVerdicts.find((v) => v.key === sortKey)?.score ?? 0;
        bVal = b.parameterVerdicts.find((v) => v.key === sortKey)?.score ?? 0;
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
    return next;
  }, [rows, sortDirection, sortKey]);

  async function extractFromImage(imageBlob: Blob, fileName = "watchlist-paste.png") {
    setExtractError(null);
    setExtractInfo(null);
    setIsExtracting(true);

    try {
      const Tesseract = await import("tesseract.js");
      const ocrFile =
        imageBlob instanceof File
          ? imageBlob
          : new File([imageBlob], fileName, { type: imageBlob.type || "image/png" });

      const preprocessedBlob = await preprocessImageForOcr(ocrFile);

      const baseConfig = {
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:- ",
      };

      const [resultPrimary, resultPreprocessed] = await Promise.all([
        Tesseract.recognize(ocrFile, "eng", {
          logger: () => {
            // Keep OCR logs quiet in UI.
          },
          ...baseConfig,
        }),
        Tesseract.recognize(preprocessedBlob, "eng", {
          logger: () => {
            // Keep OCR logs quiet in UI.
          },
          ...baseConfig,
        }),
      ]);

      const extracted = parseWatchlistText(
        `${resultPrimary.data.text}\n${resultPreprocessed.data.text}`,
      );
      if (extracted.length === 0) {
        setExtractError("Could not detect symbols from image. Try a clearer screenshot.");
        setImageRows([]);
        return;
      }

      setImageRows(extracted);
      setTickerInput(extracted.map((item) => item.symbol).join(", "));
      setExtractInfo(
        `Detected ${extracted.length} rows from image${ocrFile.name ? ` (${ocrFile.name})` : ""}.`,
      );
    } catch (ocrError) {
      const message =
        ocrError instanceof Error ? ocrError.message : "Image extraction failed";
      setExtractError(message);
      setImageRows([]);
    } finally {
      setIsExtracting(false);
    }
  }

  function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    void extractFromImage(file);
  }

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      if (!items || items.length === 0) {
        return;
      }

      for (const item of items) {
        if (!item.type.startsWith("image/")) {
          continue;
        }

        const blob = item.getAsFile();
        if (!blob) {
          continue;
        }

        event.preventDefault();
        void extractFromImage(blob, "clipboard-watchlist.png");
        return;
      }
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function runResearch() {
    setError(null);
    setRows([]);
    setAsOf(null);
    const tickers = parseInput(tickerInput);
    if (tickers.length === 0) {
      setError("Please enter at least one ticker.");
      return;
    }

    if (tickers.length > 50) {
      setError("Maximum 50 tickers are allowed.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, imageRows }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Research run failed.");
      }

      setRows(payload.rows ?? []);
      setAsOf(payload.asOf ?? null);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unexpected dashboard error";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="dashboard-shell">
      <div className="ambient ambient-1" />
      <div className="ambient ambient-2" />

      <main className="dashboard-main">
        <section className="hero-card">
          <p className="eyebrow">Dixit Research Analyst</p>
          <h1>Indian Equity Intelligence Dashboard</h1>
          <p className="hero-sub">
            Analyze up to 50 TradingView tickers, generate 10-parameter verdicts,
            and open full per-stock PDF reports from one fast workflow.
          </p>

          <div className="input-grid">
            <label htmlFor="tickers" className="input-label">
              Tickers (NSE:RELIANCE, BSE:500325, or RELIANCE)
            </label>
            <label htmlFor="watchlist-image" className="input-label">
              Or upload watchlist screenshot (OCR symbol + price verification)
            </label>
            <div className="helper-text" suppressHydrationWarning>
              You can also paste screenshot directly with <strong>Ctrl+V</strong> or <strong>Cmd+V</strong>.
            </div>
            <input
              id="watchlist-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              onChange={onImageSelected}
            />
            {isExtracting ? <p className="helper-text">Extracting symbols from image...</p> : null}
            {extractError ? <p className="error-msg">{extractError}</p> : null}
            {extractInfo ? <p className="helper-text">{extractInfo}</p> : null}
            {imageRows.length > 0 ? (
              <p className="helper-text">
                OCR extracted {imageRows.length} symbols with price checks enabled.
              </p>
            ) : null}
            <textarea
              id="tickers"
              className="ticker-input"
              value={tickerInput}
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              spellCheck={false}
              onChange={(event) => setTickerInput(event.target.value)}
              rows={4}
            />
            <div className="action-row">
              <span className="helper-text">{tickerCount}/50 tickers</span>
              <button
                className="run-btn"
                type="button"
                disabled={isLoading}
                onClick={runResearch}
              >
                {isLoading ? "Running deep research..." : "Run Research"}
              </button>
            </div>
            {error ? <p className="error-msg">{error}</p> : null}
          </div>
        </section>

        <section className="table-card">
          <div className="table-header">
            <h2>12-Column Decision Grid</h2>
            <p>
              Source: Yahoo Finance public endpoints | As of: {asOf ? new Date(asOf).toLocaleString() : "-"}
            </p>
            <div className="sort-row">
              <label htmlFor="sort-key">Sort by</label>
              <select
                id="sort-key"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
              >
                <option value="stock">Stock Name</option>
                <option value="catalyst">Catalyst Score</option>
                {RESEARCH_PARAMETERS.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="sort-toggle"
                onClick={() =>
                  setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                }
              >
                {sortDirection === "asc" ? "Ascending" : "Descending"}
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stock</th>
                  {RESEARCH_PARAMETERS.map((item) => (
                    <th key={item.key}>{item.label}</th>
                  ))}
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty-state">
                      Run research to see verdicts and reports.
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((row) => (
                    <tr key={row.ticker}>
                      <td>
                        <div className="stock-cell">
                          <strong>{row.companyName}</strong>
                          <span>{row.ticker}</span>
                          <span>
                            Close: {row.closePrice ?? "N/A"} {row.currency} ({row.closeDate ?? "N/A"})
                          </span>
                          {row.referencePrice !== null ? (
                            <span>
                              Image Last: {row.referencePrice.toFixed(2)} | Drift: {row.referencePriceDiffPct ?? "N/A"}%
                            </span>
                          ) : null}
                          <span className="catalyst-score">
                            Catalyst Score: {row.catalystScore}/100
                          </span>
                          {row.catalystSummary.slice(0, 4).map((line, idx) => (
                            <span key={`${row.ticker}-c-${idx}`} className="catalyst-line">
                              {line}
                            </span>
                          ))}
                        </div>
                      </td>
                      {row.parameterVerdicts.map((item) => (
                        <td key={`${row.ticker}-${item.key}`} title={item.reason}>
                          <span className={verdictClass(item.verdict)}>{item.verdict}</span>
                        </td>
                      ))}
                      <td>
                        {row.pdfBase64 ? (
                          <a
                            className="pdf-btn"
                            href={`data:application/pdf;base64,${row.pdfBase64}`}
                            download={`${row.ticker}-research-report.pdf`}
                            title="Download full report"
                          >
                            Open PDF
                          </a>
                        ) : (
                          <span className="pdf-disabled">Unavailable</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
