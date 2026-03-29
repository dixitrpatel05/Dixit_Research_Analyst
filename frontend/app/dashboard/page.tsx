"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Moon, Plus, Sun } from "lucide-react";
import { useRouter } from "next/navigation";

import { apiFetch } from "../../src/lib/apiClient";
import StockRow from "../../src/components/StockRow";
import { useAlphaStore } from "../../src/store/useAlphaStore";

type BatchEvent = {
  symbol?: string;
  status?: string;
  stage?: string;
  error?: string;
  result?: Record<string, unknown>;
};

const RATING_FILTERS = ["ALL", "STRONG_BUY", "BUY", "HOLD", "SELL"];

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export default function DashboardPage() {
  const router = useRouter();

  const symbols = useAlphaStore((s) => s.symbols);
  const setSymbols = useAlphaStore((s) => s.setSymbols);
  const researchData = useAlphaStore((s) => s.researchData);
  const setResearchData = useAlphaStore((s) => s.setResearchData);
  const loadingStates = useAlphaStore((s) => s.loadingStates);
  const setLoadingState = useAlphaStore((s) => s.setLoadingState);
  const filters = useAlphaStore((s) => s.filters);
  const setFilter = useAlphaStore((s) => s.setFilter);
  const expandedRow = useAlphaStore((s) => s.expandedRow);
  const setExpandedRow = useAlphaStore((s) => s.setExpandedRow);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pdfLoadingMap, setPdfLoadingMap] = useState<Record<string, boolean>>({});
  const [isDarkSurface, setIsDarkSurface] = useState(true);

  const stocks = useMemo(
    () => symbols.map((symbol) => ({ symbol, data: researchData[symbol], state: loadingStates[symbol] || "idle" })),
    [symbols, researchData, loadingStates],
  );

  const filteredStocks = useMemo(() => {
    const activeRating = filters.rating[0] || "ALL";
    if (activeRating === "ALL") return stocks;

    return stocks.filter((s) => {
      const rating = String((s.data?.fundamental_analysis as any)?.rating || "").toUpperCase();
      return rating === activeRating;
    });
  }, [stocks, filters.rating]);

  const avgConfidence = useMemo(() => {
    const values = stocks
      .map((s) => asNumber((s.data?.catalyst_analysis as any)?.confidence_score))
      .filter((n) => n > 0);
    if (!values.length) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }, [stocks]);

  const strongBuyCount = useMemo(
    () =>
      stocks.filter(
        (s) => String((s.data?.fundamental_analysis as any)?.rating || "").toUpperCase() === "STRONG_BUY",
      ).length,
    [stocks],
  );

  const catalystBreakdown = useMemo(() => {
    const counter = new Map<string, number>();
    stocks.forEach((s) => {
      const key = String((s.data?.catalyst_analysis as any)?.catalyst_type || "OTHER");
      counter.set(key, (counter.get(key) || 0) + 1);
    });
    const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 4);
  }, [stocks]);

  const runBatchResearch = async (targetSymbols: string[]) => {
    if (!targetSymbols.length) return;

    setIsStreaming(true);
    useAlphaStore.setState({ currentStage: {} });

    targetSymbols.forEach((sym) => setLoadingState(sym, "loading"));

    try {
      const response = await apiFetch("/research/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: targetSymbols }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Streaming request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith("data:"));
          if (!line) continue;

          const raw = line.slice(5).trim();
          if (!raw) continue;

          let payload: BatchEvent;
          try {
            payload = JSON.parse(raw) as BatchEvent;
          } catch {
            continue;
          }

          if (payload.status === "finished") {
            continue;
          }

          const symbol = String(payload.symbol || "").toUpperCase();
          if (!symbol) continue;

          if (payload.status === "loading") {
            setLoadingState(symbol, "loading");
            useAlphaStore.setState((state) => ({
              currentStage: {
                ...state.currentStage,
                [symbol]: payload.stage || "fetching_data",
              },
            }));
          }

          if (payload.status === "complete" && payload.result) {
            setResearchData(symbol, payload.result);
            setLoadingState(symbol, "complete");
            useAlphaStore.setState((state) => ({
              currentStage: {
                ...state.currentStage,
                [symbol]: "completed",
              },
            }));
          }

          if (payload.status === "error") {
            setLoadingState(symbol, "error");
            useAlphaStore.setState((state) => ({
              currentStage: {
                ...state.currentStage,
                [symbol]: payload.error || "failed",
              },
            }));
          }
        }
      }
    } catch {
      targetSymbols.forEach((sym) => setLoadingState(sym, "error"));
    } finally {
      setIsStreaming(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!symbols.length) return;
    const pending = symbols.filter((s) => !researchData[s]);
    if (!pending.length) return;

    void runBatchResearch(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (key === "r") {
        e.preventDefault();
        setIsRefreshing(true);
        void runBatchResearch(symbols);
      }

      if (key === "n") {
        e.preventDefault();
        router.push("/");
      }

      if (key === "f") {
        e.preventDefault();
        const next = filters.rating[0] === "ALL" ? "BUY" : "ALL";
        setFilter("rating", [next]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filters.rating, router, setFilter, symbols]);

  const handleDownloadPdf = async (symbol: string) => {
    setPdfLoadingMap((prev) => ({ ...prev, [symbol]: true }));
    try {
      const response = await apiFetch(`/report/${symbol}/pdf`);
      if (!response.ok) throw new Error("PDF download failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${symbol}_alphadesk_report.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      // Silent fail in UI for now.
    } finally {
      setPdfLoadingMap((prev) => ({ ...prev, [symbol]: false }));
    }
  };

  return (
    <main className={cx("h-screen overflow-hidden", isDarkSurface ? "bg-[#0A0A0F] text-white" : "bg-[#F6F7FB] text-[#0B1220]")}>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[rgba(10,10,15,0.8)] backdrop-blur-[20px]">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4">
          <div>
            <div className="text-[18px] font-bold tracking-[-0.02em]">AlphaDesk</div>
            <div className="text-[12px] text-gray-400">Research Terminal</div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {RATING_FILTERS.map((pill) => {
              const active = (filters.rating[0] || "ALL") === pill;
              return (
                <button
                  key={pill}
                  type="button"
                  onClick={() => setFilter("rating", [pill])}
                  className={cx(
                    "rounded-full border px-3 py-1 text-xs transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    active
                      ? "border-blue-400/70 bg-blue-500/20 text-blue-100"
                      : "border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20 hover:bg-white/[0.06]",
                  )}
                >
                  {pill === "ALL" ? "All" : pill.replace("_", " ")}
                </button>
              );
            })}
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-300 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-white/20 hover:bg-white/[0.06]"
            >
              By Sector
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-gray-300">{symbols.length} stocks</span>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />
              New Analysis
            </button>
            <button
              type="button"
              onClick={() => setIsDarkSurface((v) => !v)}
              className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-gray-300 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-white/20"
              aria-label="Toggle theme"
            >
              {isDarkSurface ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex h-full max-w-[1400px] flex-col px-4 pb-4 pt-20">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs text-gray-400">Total Stocks Analyzed</div>
            <div className="mt-2 text-2xl font-bold">{stocks.filter((s) => s.data).length}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs text-gray-400">Avg Confidence Score</div>
            <div className="mt-2 text-2xl font-bold text-blue-300">{avgConfidence}%</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs text-gray-400">Strong Buy Count</div>
            <div className="mt-2 text-2xl font-bold text-emerald-300">{strongBuyCount}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs text-gray-400">Catalyst Breakdown</div>
            <div className="mt-2 flex gap-1">
              {catalystBreakdown.length ? (
                catalystBreakdown.map(([label, count]) => (
                  <div key={label} className="h-2 rounded-full bg-blue-400/70" style={{ width: `${Math.max(8, count * 18)}px` }} title={label} />
                ))
              ) : (
                <div className="text-xs text-gray-500">No data yet</div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          {!symbols.length ? (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
              <div>
                <div className="mx-auto mb-3 h-20 w-20 animate-pulse rounded-full bg-gradient-to-r from-blue-500/25 to-cyan-500/25" />
                <div className="text-sm text-gray-300">No stocks loaded yet.</div>
                <div className="mt-1 text-xs text-gray-500">Start a new analysis to populate your dashboard.</div>
              </div>
            </div>
          ) : (
            <AnimateRows>
              {filteredStocks.map((stock, idx) => (
                <motion.div
                  key={stock.symbol}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04, duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                >
                  <StockRow
                    symbol={stock.symbol}
                    data={stock.data}
                    loadingState={stock.state as any}
                    isExpanded={expandedRow === stock.symbol}
                    onToggle={(s) => setExpandedRow(expandedRow === s ? null : s)}
                    onRetry={(s) => void runBatchResearch([s])}
                    onDownloadPdf={handleDownloadPdf}
                    isPdfLoading={Boolean(pdfLoadingMap[stock.symbol])}
                  />
                </motion.div>
              ))}
            </AnimateRows>
          )}
        </section>
      </div>

      {isStreaming || isRefreshing ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 rounded-xl border border-white/10 bg-black/60 p-3 text-xs text-gray-200 backdrop-blur-xl">
          {isRefreshing ? "Refreshing all stocks..." : "Streaming research updates..."}
        </div>
      ) : null}
    </main>
  );
}

function AnimateRows({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
