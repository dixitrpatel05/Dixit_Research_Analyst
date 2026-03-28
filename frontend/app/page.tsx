"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAlphaStore } from "../src/store/useAlphaStore";

function staggerTransition(i: number) {
  return { delay: i * 0.1, duration: 0.35, ease: "easeOut" as const };
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/^NSE:/, "").replace(/[^A-Z0-9]/g, "");
}

export default function LandingPage() {
  const router = useRouter();
  const setSymbols = useAlphaStore((s) => s.setSymbols);

  const [symbols, setLocalSymbols] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const analyzeCount = useMemo(() => symbols.length, [symbols.length]);

  const addSymbol = (raw: string) => {
    const symbol = normalizeSymbol(raw);
    if (!symbol || symbol.length < 2 || symbol.length > 10) return;
    setLocalSymbols((prev) => (prev.includes(symbol) ? prev : [...prev, symbol]));
  };

  const removeSymbol = (symbol: string) => {
    setLocalSymbols((prev) => prev.filter((s) => s !== symbol));
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const value = input.trim().replace(/,$/, "");
      if (value) addSymbol(value);
      setInput("");
    }

    if (e.key === "Backspace" && !input.trim() && symbols.length > 0) {
      const last = symbols[symbols.length - 1];
      removeSymbol(last);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!["image/png", "image/jpeg", "image/jpg"].includes(dropped.type)) return;
    setFile(dropped);
  };

  const triggerAnalyze = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const form = new FormData();
      if (file) {
        form.append("file", file);
      }
      if (symbols.length) {
        form.append("manual_symbols", symbols.join(","));
      }

      const response = await fetch("/api/ocr", {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        throw new Error(`OCR failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { symbols?: string[] };
      const extracted = Array.isArray(payload.symbols) ? payload.symbols.map(normalizeSymbol).filter(Boolean) : [];
      const merged = Array.from(new Set([...symbols, ...extracted]));

      if (!merged.length) {
        setIsSubmitting(false);
        return;
      }

      setSymbols(merged);
      router.push("/dashboard");
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0A0A0F] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={staggerTransition(0)}>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-gray-200">
              <span className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              AlphaDesk Research Terminal
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={staggerTransition(1)}
            className="mt-6 text-[40px] font-bold leading-[1.05] tracking-[-0.02em] text-white md:text-[56px]"
          >
            Institutional-Grade Research
          </motion.h1>

          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={staggerTransition(2)}
            className="text-[38px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[56px]"
          >
            <span className="bg-gradient-to-r from-blue-300 via-blue-500 to-indigo-400 bg-clip-text text-transparent">for your watchlist</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={staggerTransition(3)}
            className="mt-4 text-sm text-gray-400 md:text-base"
          >
            Upload a screenshot. Get a JP Morgan-level report.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={staggerTransition(4)}
            className="mt-8"
          >
            <label
              htmlFor="watchlistUpload"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className="group flex h-[220px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-400/40 bg-blue-500/5 p-6 text-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-blue-300/70 hover:shadow-[0_0_40px_rgba(59,130,246,0.35)]"
              style={{
                boxShadow: isDragging ? "0 0 40px rgba(59,130,246,0.35)" : undefined,
                borderColor: isDragging ? "rgba(96,165,250,0.85)" : undefined,
              }}
            >
              <UploadCloud className="h-10 w-10 text-blue-300 transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:-translate-y-0.5" />
              <div className="mt-3 text-[15px] font-medium text-white">Drop watchlist screenshot here</div>
              <div className="mt-1 text-xs text-gray-400">PNG, JPG supported</div>
              {file ? <div className="mt-3 text-xs text-blue-300">Selected: {file.name}</div> : null}
              <input
                id="watchlistUpload"
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) setFile(selected);
                }}
              />
            </label>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={staggerTransition(5)}
            className="mt-6 text-center text-xs text-gray-500"
          >
            - or enter symbols manually -
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={staggerTransition(6)}
            className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="mb-2 flex flex-wrap gap-2">
              {symbols.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-xs text-gray-200"
                >
                  {s}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-gray-400 transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-white"
                    onClick={() => removeSymbol(s)}
                    aria-label={`Remove ${s}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Type NSE symbols (e.g. RELIANCE, INFY)"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] placeholder:text-gray-500 focus:border-blue-300/60 focus:ring-2 focus:ring-blue-400/50"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={staggerTransition(7)}
            className="mt-5"
          >
            <button
              type="button"
              onClick={triggerAnalyze}
              disabled={isSubmitting || (symbols.length === 0 && !file)}
              className="group relative w-full overflow-hidden rounded-xl bg-[#3B82F6] px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:translate-x-full group-hover:opacity-100" />
              <span className="relative inline-flex items-center gap-2">
                {isSubmitting ? (
                  <>
                    <motion.span
                      className="h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                    Researching...
                  </>
                ) : (
                  <>Analyze {analyzeCount} stocks -&gt;</>
                )}
              </span>
            </button>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
