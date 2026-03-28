"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useParams } from "next/navigation";

import { useAlphaStore } from "../../../src/store/useAlphaStore";

function inr(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return "NA";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function pct(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return "NA";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function badgeStyle(rating: string): string {
  const key = String(rating || "HOLD").toUpperCase();
  if (key.includes("BUY")) return "bg-emerald-100 text-emerald-700 border-emerald-300";
  if (key.includes("SELL")) return "bg-red-100 text-red-700 border-red-300";
  return "bg-gray-100 text-gray-700 border-gray-300";
}

export default function ReportPreviewPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = String(params?.symbol || "").toUpperCase();

  const researchData = useAlphaStore((s) => s.researchData);
  const data = researchData[symbol] as Record<string, any> | undefined;

  const [isDownloading, setIsDownloading] = useState(false);
  const [apiData, setApiData] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    if (data || !symbol) return;

    let mounted = true;
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/research/${symbol}`, { method: "POST" });
        if (!response.ok) return;
        const payload = (await response.json()) as Record<string, any>;
        if (mounted) setApiData(payload);
      } catch {
        // Ignore fetch errors for preview.
      }
    };

    void fetchData();
    return () => {
      mounted = false;
    };
  }, [data, symbol]);

  const report = useMemo(() => data || apiData || {}, [data, apiData]);

  const fundamentals = (report?.fundamentals || {}) as Record<string, any>;
  const catalyst = (report?.catalyst_analysis || {}) as Record<string, any>;
  const fundamentalAnalysis = (report?.fundamental_analysis || {}) as Record<string, any>;
  const sectorRisk = (report?.sector_risk_analysis || {}) as Record<string, any>;

  const companyName = String(report?.company_name || symbol || "Unknown Company");

  const handleDownload = async () => {
    if (!symbol || isDownloading) return;
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/report/${symbol}/pdf`);
      if (!response.ok) throw new Error("PDF generation failed");
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
      // Silent fail to keep preview accessible.
    } finally {
      setIsDownloading(false);
    }
  };

  const peers = Array.isArray(report?.inputs?.peers) ? report.inputs.peers : [];
  const filings = Array.isArray(report?.inputs?.announcements) ? report.inputs.announcements : [];
  const risks = Array.isArray(sectorRisk?.top_risks) ? sectorRisk.top_risks : [];

  return (
    <main className="min-h-screen bg-white py-10 text-[#0f172a]">
      <div className="mx-auto w-full max-w-[900px] space-y-8 px-6 pb-20">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="rounded-t-lg bg-[#1a3a5c] px-6 py-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-bold tracking-[-0.02em]">{companyName}</h1>
                <p className="mt-1 text-sm text-white/80">{symbol} | AlphaDesk Research</p>
              </div>
              <span className="rounded-md border border-white/30 bg-[#0f2740] px-2 py-1 text-[10px] font-semibold">
                INITIATING COVERAGE
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-5">
            <MetricCard label="CMP" value={inr(fundamentals?.cmp)} />
            <MetricCard label="Target" value={inr(fundamentalAnalysis?.target_price)} />
            <MetricCard label="Upside" value={pct(fundamentalAnalysis?.upside_pct)} />
            <MetricCard label="Rating" value={String(fundamentalAnalysis?.rating || "HOLD")} />
            <MetricCard label="Market Cap" value={new Intl.NumberFormat("en-IN", { notation: "compact" }).format(Number(fundamentals?.market_cap || 0))} />
          </div>

          <div className="px-6 pb-6 text-sm leading-7 text-slate-700">
            {String(
              fundamentalAnalysis?.rating_rationale ||
                "This preview mirrors the generated PDF report format with investment thesis, catalyst confidence, and valuation context.",
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold text-blue-700">Catalyst Deep Dive</h2>
          <p className="mt-2 text-xl font-semibold text-slate-900">{String(catalyst?.catalyst_headline || "No primary catalyst identified")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              {String(catalyst?.catalyst_type || "OTHER")}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              Confidence: {Number(catalyst?.confidence_score || 0)}%
            </span>
          </div>
          <p className="mt-4 columns-1 text-sm leading-7 text-slate-700 md:columns-2">{String(catalyst?.catalyst_detail || "No catalyst narrative available")}</p>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Supporting Evidence</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {(Array.isArray(catalyst?.supporting_evidence) ? catalyst.supporting_evidence : []).slice(0, 3).map((e: string, i: number) => (
                <li key={`${symbol}-evidence-${i}`}>{String(e)}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">Financial Snapshot</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <RatioCard label="PE" value={String(fundamentals?.pe_ratio ?? "NA")} />
            <RatioCard label="ROE" value={pct(fundamentals?.roe)} />
            <RatioCard label="ROCE" value={pct(fundamentals?.roce)} />
            <RatioCard label="D/E" value={String(fundamentals?.debt_equity ?? "NA")} />
            <RatioCard label="Rev Growth" value={pct(fundamentals?.revenue_growth_yoy)} />
            <RatioCard label="Promoter" value={pct(fundamentals?.promoter_holding)} />
            <RatioCard label="FII" value={pct(fundamentals?.fii_holding)} />
            <RatioCard label="Volume" value={String(fundamentals?.current_volume ?? "NA")} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">NSE and BSE Filings</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-600">
                  <th className="border border-slate-200 px-2 py-2">Date</th>
                  <th className="border border-slate-200 px-2 py-2">Type</th>
                  <th className="border border-slate-200 px-2 py-2">Summary</th>
                </tr>
              </thead>
              <tbody>
                {filings.slice(0, 10).map((f: Record<string, any>, i: number) => (
                  <tr key={`${symbol}-filing-${i}`} className={String(f?.type || "").toUpperCase().includes("INSIDER") ? "bg-orange-50" : ""}>
                    <td className="border border-slate-200 px-2 py-2">{String(f?.date || "NA")}</td>
                    <td className="border border-slate-200 px-2 py-2">{String(f?.type || "NA")}</td>
                    <td className="border border-slate-200 px-2 py-2">{String(f?.headline || "NA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">Sector and Peer View</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs text-slate-700">
              Sector Outlook: {String(sectorRisk?.sector_outlook || "NEUTRAL")}
            </span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs text-slate-700">
              Cycle: {String(sectorRisk?.sector_cycle_stage || "MID_UPCYCLE")}
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-600">
                  <th className="border border-slate-200 px-2 py-2">Peer</th>
                  <th className="border border-slate-200 px-2 py-2">PE</th>
                  <th className="border border-slate-200 px-2 py-2">ROE</th>
                  <th className="border border-slate-200 px-2 py-2">Revenue Growth</th>
                </tr>
              </thead>
              <tbody>
                {peers.slice(0, 3).map((p: Record<string, any>, i: number) => (
                  <tr key={`${symbol}-peer-${i}`}>
                    <td className="border border-slate-200 px-2 py-2">{String(p?.name || p?.symbol || "NA")}</td>
                    <td className="border border-slate-200 px-2 py-2">{String(p?.pe ?? "NA")}</td>
                    <td className="border border-slate-200 px-2 py-2">{pct(p?.roe)}</td>
                    <td className="border border-slate-200 px-2 py-2">{pct(p?.revenue_growth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">Valuation and Risks</h2>

          <div className="mt-4 rounded-lg border border-slate-200 p-4">
            <div className="text-sm text-slate-600">Final Recommendation</div>
            <div className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${badgeStyle(String(fundamentalAnalysis?.rating || "HOLD"))}`}>
              {String(fundamentalAnalysis?.rating || "HOLD")}
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-700">{String(fundamentalAnalysis?.rating_rationale || "No rationale available")}</p>
          </div>

          <div className="mt-4 space-y-2">
            {risks.slice(0, 3).map((r: Record<string, any>, i: number) => {
              const sev = String(r?.severity || "LOW").toUpperCase();
              const colors =
                sev === "HIGH"
                  ? "border-red-300 bg-red-50"
                  : sev === "MEDIUM"
                    ? "border-orange-300 bg-orange-50"
                    : "border-yellow-300 bg-yellow-50";
              return (
                <div key={`${symbol}-risk-${i}`} className={`rounded-lg border p-3 ${colors}`}>
                  <div className="text-sm font-semibold">{String(r?.risk_title || "Risk")}</div>
                  <div className="mt-1 text-xs text-slate-700">{String(r?.risk_detail || "Risk detail unavailable")}</div>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-[11px] leading-6 text-slate-400">
            Disclaimer: This preview uses publicly available information and model-assisted analysis for informational purposes only.
          </p>
        </section>
      </div>

      <motion.button
        type="button"
        onClick={handleDownload}
        disabled={isDownloading || !symbol}
        whileHover={{ scale: 1.05 }}
        className="fixed bottom-6 right-6 inline-flex items-center gap-2 rounded-full bg-[#3B82F6] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(59,130,246,0.4)] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isDownloading ? (
          <motion.span
            className="h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
        ) : null}
        {isDownloading ? "Generating PDF..." : "Download PDF"}
      </motion.button>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function RatioCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
