"use client";

import { useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";

import { apiFetch } from "../src/lib/apiClient";
import { extractSymbolsFromImageClient } from "../src/lib/localOcr";
import { useAlphaStore } from "../src/store/useAlphaStore";

type OcrResponse = {
  symbols?: string[];
};

export default function Home() {
  const router = useRouter();
  const setSymbols = useAlphaStore((s) => s.setSymbols);
  const clearAll = useAlphaStore((s) => s.clearAll);

  const [manualSymbols, setManualSymbols] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applySelectedFile = (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setSelectedFileName("");
      return;
    }

    setSelectedFile(file);
    setSelectedFileName(file.name || "pasted-watchlist.png");
    setErrorMessage("");
  };

  const handleAnalyze = async () => {
    if (isSubmitting) return;

    const hasManual = manualSymbols.trim().length > 0;
    const hasFile = Boolean(selectedFile);
    if (!hasManual && !hasFile) {
      setErrorMessage("Add symbols or paste/upload a watchlist image first.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const payload = new FormData();
      if (hasFile && selectedFile) {
        payload.append("file", selectedFile);
      }
      if (hasManual) {
        payload.append("manual_symbols", manualSymbols);
      }

      const response = await apiFetch("/ocr", {
        method: "POST",
        body: payload,
      });

      if (!response.ok) {
        let detail = "";
        try {
          const maybeJson = (await response.json()) as { error?: string; detail?: string };
          detail = maybeJson.error || maybeJson.detail || "";
        } catch {
          try {
            const text = (await response.text()).trim();
            if (text) {
              detail = text.slice(0, 240);
            }
          } catch {
            // Keep fallback message when response body is unavailable.
          }
        }
        throw new Error(`OCR request failed: ${response.status}${detail ? ` (${detail})` : ""}`);
      }

      const data = (await response.json()) as OcrResponse;
      let extracted = Array.isArray(data.symbols) ? data.symbols : [];

      if (!extracted.length && hasFile && selectedFile) {
        try {
          extracted = await extractSymbolsFromImageClient(selectedFile);
        } catch {
          // Keep default message below if client OCR also fails.
        }
      }

      if (!extracted.length) {
        setErrorMessage("No valid symbols detected. Try a tighter watchlist crop or type symbols manually.");
        return;
      }

      clearAll();
      setSymbols(extracted);
      router.push("/dashboard");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Request failed";
      setErrorMessage(`Could not start analysis (${text}). Please verify backend API URL config and retry.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items || !items.length) return;

      for (const item of items) {
        if (!item.type.startsWith("image/")) {
          continue;
        }

        const file = item.getAsFile();
        if (!file) {
          continue;
        }

        event.preventDefault();
        applySelectedFile(file);
        return;
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <main
      className="min-h-screen w-full flex flex-col items-center justify-center px-6 py-12 bg-[#0A0A0F]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        backgroundColor: "#0A0A0F",
      }}
    >
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-8 text-center">
        <span className="text-blue-400 text-sm font-medium bg-blue-500/10 border border-blue-500/20 px-4 py-1.5 rounded-full">
          AlphaDesk Research Terminal
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="text-5xl font-bold text-white tracking-tight">Institutional-Grade Research</h1>
          <h2 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent tracking-tight">
            for your watchlist
          </h2>
        </div>

        <p className="text-gray-400 text-lg">Upload a screenshot. Get a JP Morgan-level report.</p>

        <label className="w-full cursor-pointer">
          <div className="w-full border-2 border-dashed border-blue-500/40 rounded-2xl p-12 flex flex-col items-center justify-center gap-4 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/70 transition-all duration-200 cursor-pointer min-h-[200px]">
            <div className="w-12 h-12 text-blue-400">
              <UploadCloud size={48} className="text-blue-400" />
            </div>
            <p className="text-white font-medium text-lg">Drop watchlist screenshot here</p>
            <p className="text-gray-500 text-sm">PNG, JPG supported. You can also press Ctrl/Cmd+V to paste.</p>
            {selectedFileName ? <p className="text-gray-400 text-sm">{selectedFileName}</p> : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/jpg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              applySelectedFile(file || null);
            }}
          />
        </label>

        <p className="text-gray-400 text-sm">- or enter symbols manually -</p>

        <input
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/8 transition-all duration-200"
          style={{ color: "#FFFFFF" }}
          placeholder="Type NSE symbols (e.g. RELIANCE, INFY)"
          value={manualSymbols}
          onChange={(e) => setManualSymbols(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAnalyze();
            }
          }}
        />

        {errorMessage ? <p className="w-full text-left text-sm text-red-300">{errorMessage}</p> : null}

        <button
          type="button"
          onClick={() => void handleAnalyze()}
          disabled={isSubmitting}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/60 disabled:cursor-not-allowed text-white font-semibold text-base py-4 px-8 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/25 active:scale-[0.98]"
        >
          {isSubmitting ? "Analyzing..." : "Analyze Stocks ->"}
        </button>
      </div>
    </main>
  );
}
