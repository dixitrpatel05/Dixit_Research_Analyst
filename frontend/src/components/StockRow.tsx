"use client";

import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import {
  AlertTriangle,
  ChevronDown,
  CircleDot,
  Download,
  RefreshCcw,
  ShieldAlert,
  X,
} from "lucide-react";

import CatalystBadge from "./CatalystBadge";
import ConfidenceGauge from "./ConfidenceGauge";

export type StockLoadingState = "idle" | "loading" | "complete" | "error";

interface StockRowProps {
  symbol: string;
  data?: Record<string, any>;
  loadingState?: StockLoadingState;
  isExpanded: boolean;
  onToggle: (symbol: string) => void;
  onRetry?: (symbol: string) => void;
  onDownloadPdf?: (symbol: string) => void;
  isPdfLoading?: boolean;
}

function inr(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NA";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function compact(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NA";
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
}

function pct(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NA";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n;
}

function ratingGlow(rating: string): string {
  const r = (rating || "").toUpperCase();
  if (r === "STRONG_BUY") return "0 0 24px rgba(16,185,129,0.42)";
  if (r === "BUY") return "0 0 24px rgba(59,130,246,0.42)";
  if (r === "HOLD") return "0 0 22px rgba(107,114,128,0.35)";
  if (r === "SELL") return "0 0 24px rgba(239,68,68,0.42)";
  if (r === "STRONG_SELL") return "0 0 24px rgba(127,29,29,0.5)";
  return "0 0 20px rgba(107,114,128,0.28)";
}

function ratingColors(rating: string): { bg: string; text: string; border: string } {
  const r = (rating || "").toUpperCase();
  if (r === "STRONG_BUY") return { bg: "rgba(16,185,129,0.2)", text: "#34D399", border: "rgba(16,185,129,0.6)" };
  if (r === "BUY") return { bg: "rgba(59,130,246,0.2)", text: "#60A5FA", border: "rgba(59,130,246,0.6)" };
  if (r === "HOLD") return { bg: "rgba(107,114,128,0.2)", text: "#D1D5DB", border: "rgba(107,114,128,0.45)" };
  if (r === "SELL") return { bg: "rgba(239,68,68,0.2)", text: "#F87171", border: "rgba(239,68,68,0.6)" };
  if (r === "STRONG_SELL") return { bg: "rgba(127,29,29,0.3)", text: "#FCA5A5", border: "rgba(153,27,27,0.75)" };
  return { bg: "rgba(107,114,128,0.2)", text: "#D1D5DB", border: "rgba(107,114,128,0.45)" };
}

function riskStyle(severity?: string): string {
  const s = String(severity || "LOW").toUpperCase();
  if (s === "HIGH") return "border-red-400/40 bg-red-500/10 text-red-100";
  if (s === "MEDIUM") return "border-orange-400/40 bg-orange-500/10 text-orange-100";
  return "border-yellow-400/40 bg-yellow-500/10 text-yellow-100";
}

export default function StockRow({
  symbol,
  data,
  loadingState = "idle",
  isExpanded,
  onToggle,
  onRetry,
  onDownloadPdf,
  isPdfLoading = false,
}: StockRowProps) {
  const fundamentals = (data?.fundamentals || {}) as Record<string, any>;
  const catalyst = (data?.catalyst_analysis || {}) as Record<string, any>;
  const fundamentalsAI = (data?.fundamental_analysis || {}) as Record<string, any>;
  const sectorRisk = (data?.sector_risk_analysis || {}) as Record<string, any>;

  const companyName = String(data?.company_name || symbol);
  const cmp = toNumber(fundamentals?.cmp);
  const dayChangePct =
    toNumber(fundamentals?.day_change_pct) ??
    (() => {
      const prevClose = toNumber(fundamentals?.prev_close);
      if (cmp === null || prevClose === null || prevClose === 0) return null;
      return ((cmp - prevClose) / prevClose) * 100;
    })();

  const confidence = toNumber(catalyst?.confidence_score) ?? 0;
  const rating = String(fundamentalsAI?.rating || "HOLD").toUpperCase();
  const upside = toNumber(fundamentalsAI?.upside_pct);
  const target = toNumber(fundamentalsAI?.target_price);

  const promoterConcern = Boolean(fundamentalsAI?.promoter_concern) || Number(fundamentals?.promoter_pledge || 0) > 10;

  const filings: Array<Record<string, any>> = Array.isArray(data?.inputs?.announcements) ? data.inputs.announcements : [];
  const risks: Array<Record<string, any>> = Array.isArray(sectorRisk?.top_risks) ? sectorRisk.top_risks : [];
  const peers: Array<Record<string, any>> = Array.isArray(data?.inputs?.peers) ? data.inputs.peers : [];
  const evidence: string[] = Array.isArray(catalyst?.supporting_evidence) ? catalyst.supporting_evidence : [];

  const ratingTheme = ratingColors(rating);

  const freshness = data?.cache?.status === "hit" ? `Cached ${Math.max(1, Number(data?.cache?.age_minutes || 0))}m ago` : "Live";
  const freshnessDot = data?.cache?.status === "hit" ? "bg-gray-400" : "bg-emerald-400";

  if (loadingState === "error") {
    return (
      <div className="mb-2 rounded-xl border border-red-400/30 bg-red-950/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-100">
            <AlertTriangle className="h-4 w-4" />
            <span>Failed to analyze {symbol}. Please retry.</span>
          </div>
          <button
            type="button"
            onClick={() => onRetry?.(symbol)}
            className="inline-flex items-center gap-1 rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-1.5 text-xs text-red-100 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-red-400/20"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className={clsx(
        "mb-2 rounded-xl border border-white/10 bg-white/[0.02]",
        "transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
        "hover:-translate-y-px hover:border-white/20 hover:bg-white/[0.04] hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
      )}
    >
      <div
        className={clsx(
          "grid items-center gap-3 p-3 md:grid-cols-[20%_25%_15%_20%_12%_8%]",
          "grid-cols-1",
          loadingState === "loading" && "opacity-70",
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-white">{companyName}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md bg-blue-500/15 px-2 py-0.5 font-mono text-[11px] text-blue-300">{symbol}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-gray-300">
              <span className={clsx("h-1.5 w-1.5 rounded-full", freshnessDot)} />
              {freshness}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[18px] font-bold text-white">{inr(cmp)}</span>
            <CircleDot className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div
            className={clsx(
              "mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              dayChangePct !== null && dayChangePct >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300",
            )}
          >
            {pct(dayChangePct)}
          </div>
        </div>

        <div className="min-w-0">
          <CatalystBadge type={catalyst?.catalyst_type} confidence={confidence} />
          <div className="mt-2 line-clamp-2 text-[13px] text-white">{String(catalyst?.catalyst_headline || "No primary catalyst")}</div>
          <div className="mt-1 text-[11px] text-gray-400">{String(catalyst?.catalyst_date || "Date NA")}</div>
          <div className="mt-0.5 text-[11px] text-gray-500">{Math.round(confidence)}% confidence</div>
        </div>

        <div className="flex flex-col items-start gap-1 md:items-center">
          <ConfidenceGauge score={confidence} />
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-gray-300">
            {String(catalyst?.impact_timeline || "IMMEDIATE")}
          </span>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-gray-200">ROE {pct(toNumber(fundamentals?.roe))}</div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-gray-200">
              Rev {pct(toNumber(fundamentals?.revenue_growth_yoy))}
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-gray-200">D/E {toNumber(fundamentals?.debt_equity)?.toFixed(2) ?? "NA"}</div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-gray-200">
              Prom {pct(toNumber(fundamentals?.promoter_holding))}
            </div>
          </div>
          {promoterConcern ? (
            <div className="inline-flex items-center gap-1 rounded-md border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">
              <ShieldAlert className="h-3 w-3" />
              Promoter concern flagged
            </div>
          ) : null}
        </div>

        <div className="space-y-1">
          <div
            className="inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold"
            style={{
              background: ratingTheme.bg,
              color: ratingTheme.text,
              borderColor: ratingTheme.border,
              boxShadow: ratingGlow(rating),
            }}
          >
            {rating}
          </div>
          <div className="text-[12px] text-gray-200">Target {inr(target)}</div>
          <div className={clsx("text-[12px]", upside !== null && upside >= 0 ? "text-emerald-300" : "text-red-300")}>
            {pct(upside)}
          </div>
        </div>

        <div className="flex items-center justify-start gap-2 md:justify-end">
          <button
            type="button"
            onClick={() => onDownloadPdf?.(symbol)}
            disabled={isPdfLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-gray-100 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPdfLoading ? (
              <motion.span
                className="h-3.5 w-3.5 rounded-full border border-white/50 border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            PDF
          </button>

          <button
            type="button"
            onClick={() => onToggle(symbol)}
            className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-200 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-white/20 hover:bg-white/10"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `Collapse ${symbol}` : `Expand ${symbol}`}
          >
            <ChevronDown
              className={clsx(
                "h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
                isExpanded && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded ? (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-white/10"
          >
            <div className="relative grid gap-4 p-4 md:grid-cols-3">
              <button
                type="button"
                onClick={() => onToggle(symbol)}
                className="absolute right-3 top-3 inline-flex rounded-md border border-white/10 bg-white/5 p-1 text-gray-300 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-white/20 hover:bg-white/10"
                aria-label="Close details"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <div className="space-y-3 pr-4">
                <h4 className="text-sm font-semibold text-white">Catalyst Deep Dive</h4>
                <p className="text-xs leading-6 text-gray-300">{String(catalyst?.catalyst_detail || "No catalyst detail available.")}</p>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 text-[11px] font-semibold text-gray-200">Supporting Evidence</div>
                  <ul className="space-y-1.5 text-[11px] text-gray-300">
                    {evidence.slice(0, 3).map((item, idx) => (
                      <li key={`${symbol}-ev-${idx}`} className="list-disc pl-1 marker:text-blue-300">
                        {String(item)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-white">Recent Filings</h4>
                <div className="overflow-hidden rounded-lg border border-white/10">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-white/[0.04] text-gray-300">
                      <tr>
                        <th className="px-2 py-2">Date</th>
                        <th className="px-2 py-2">Type</th>
                        <th className="px-2 py-2">Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filings.slice(0, 5).map((row, idx) => {
                        const isRedFlag = ["INSIDER_TRADE", "QIP", "OTHER"].includes(String(row?.type || "").toUpperCase());
                        return (
                          <tr key={`${symbol}-fil-${idx}`} className={clsx("border-t border-white/5", isRedFlag && "bg-orange-500/10")}>
                            <td className="px-2 py-2 text-gray-300">{String(row?.date || "NA")}</td>
                            <td className="px-2 py-2 text-gray-200">{String(row?.type || "NA")}</td>
                            <td className="px-2 py-2 text-gray-300">{String(row?.headline || "NA")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-[11px] text-red-100">
                  <span className="font-semibold">Red Flags:</span> {promoterConcern ? "Promoter concern detected" : "No major promoter alerts in current dataset"}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-white">Risks and Sector</h4>

                <div className="space-y-2">
                  {risks.slice(0, 3).map((risk, idx) => (
                    <div
                      key={`${symbol}-risk-${idx}`}
                      className={clsx("rounded-lg border p-2 text-[11px]", riskStyle(String(risk?.severity || "LOW")))}
                    >
                      <div className="font-semibold">{String(risk?.risk_title || "Risk")}</div>
                      <div className="mt-1 opacity-90">{String(risk?.risk_detail || "Risk detail unavailable")}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[11px] text-gray-200">
                  <div className="font-semibold">Sector Outlook</div>
                  <div className="mt-1 text-gray-300">{String(sectorRisk?.sector_outlook || "NEUTRAL")}</div>
                  <div className="mt-1 text-gray-400">Stage: {String(sectorRisk?.sector_cycle_stage || "MID_UPCYCLE")}</div>
                </div>

                <div className="overflow-hidden rounded-lg border border-white/10">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-white/[0.04] text-gray-300">
                      <tr>
                        <th className="px-2 py-2">Peer</th>
                        <th className="px-2 py-2">PE</th>
                        <th className="px-2 py-2">ROE</th>
                        <th className="px-2 py-2">Rev%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {peers.slice(0, 3).map((peer, idx) => (
                        <tr key={`${symbol}-peer-${idx}`} className="border-t border-white/5">
                          <td className="px-2 py-2 text-gray-200">{String(peer?.symbol || peer?.name || "NA")}</td>
                          <td className="px-2 py-2 text-gray-300">{toNumber(peer?.pe)?.toFixed(2) ?? "NA"}</td>
                          <td className="px-2 py-2 text-gray-300">{pct(toNumber(peer?.roe))}</td>
                          <td className="px-2 py-2 text-gray-300">{pct(toNumber(peer?.revenue_growth))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
