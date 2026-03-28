"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";

export default function Home() {
  const [symbols, setSymbols] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");

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
            <p className="text-gray-500 text-sm">PNG, JPG supported</p>
            {selectedFileName ? <p className="text-gray-400 text-sm">{selectedFileName}</p> : null}
          </div>
          <input
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/jpg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setSelectedFileName(file ? file.name : "");
            }}
          />
        </label>

        <p className="text-gray-400 text-sm">- or enter symbols manually -</p>

        <input
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/8 transition-all duration-200"
          style={{ color: "#FFFFFF" }}
          placeholder="Type NSE symbols (e.g. RELIANCE, INFY)"
          value={symbols}
          onChange={(e) => setSymbols(e.target.value)}
        />

        <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base py-4 px-8 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/25 active:scale-[0.98]">
          Analyze Stocks -&gt;
        </button>
      </div>
    </main>
  );
}
