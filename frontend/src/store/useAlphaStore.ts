"use client";

import { create } from "zustand";

export interface ResearchResult {
  [key: string]: unknown;
}

export interface AlphaStore {
  symbols: string[];
  researchData: Record<string, ResearchResult>;
  loadingStates: Record<string, "idle" | "loading" | "complete" | "error">;
  currentStage: Record<string, string>;
  filters: { rating: string[]; sector: string[] };
  expandedRow: string | null;

  setSymbols: (symbols: string[]) => void;
  setResearchData: (symbol: string, data: ResearchResult) => void;
  setLoadingState: (symbol: string, state: string) => void;
  setFilter: (key: string, values: string[]) => void;
  setExpandedRow: (symbol: string | null) => void;
  clearAll: () => void;
}

const STORAGE_KEY = "alphadesk_research_data_v1";
const TTL_MS = 86_400_000;

interface PersistedResearchData {
  data: Record<string, ResearchResult>;
  timestamp: number;
}

function readPersistedResearchData(): Record<string, ResearchResult> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as PersistedResearchData;
    if (!parsed || typeof parsed !== "object") {
      window.localStorage.removeItem(STORAGE_KEY);
      return {};
    }

    const ageMs = Date.now() - Number(parsed.timestamp || 0);
    if (ageMs >= TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return {};
    }

    return parsed.data && typeof parsed.data === "object" ? parsed.data : {};
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

function writePersistedResearchData(data: Record<string, ResearchResult>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const payload: PersistedResearchData = {
      data,
      timestamp: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota and serialization failures.
  }
}

function clearPersistedResearchData(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}

const initialResearchData = readPersistedResearchData();

export const useAlphaStore = create<AlphaStore>((set) => ({
  symbols: [],
  researchData: initialResearchData,
  loadingStates: {},
  currentStage: {},
  filters: { rating: [], sector: [] },
  expandedRow: null,

  setSymbols: (symbols) => {
    const normalized = Array.from(
      new Set(
        (symbols || [])
          .map((s) => String(s || "").trim().toUpperCase())
          .filter((s) => s.length > 0),
      ),
    );
    set({ symbols: normalized });
  },

  setResearchData: (symbol, data) => {
    const key = String(symbol || "").trim().toUpperCase();
    if (!key) {
      return;
    }

    set((state) => {
      const nextResearchData = {
        ...state.researchData,
        [key]: data,
      };
      writePersistedResearchData(nextResearchData);
      return { researchData: nextResearchData };
    });
  },

  setLoadingState: (symbol, state) => {
    const key = String(symbol || "").trim().toUpperCase();
    if (!key) {
      return;
    }
    const nextState =
      state === "loading" || state === "complete" || state === "error" || state === "idle"
        ? state
        : "idle";

    set((prev) => ({
      loadingStates: {
        ...prev.loadingStates,
        [key]: nextState,
      },
    }));
  },

  setFilter: (key, values) => {
    const safeValues = Array.from(
      new Set((values || []).map((v) => String(v || "").trim()).filter((v) => v.length > 0)),
    );

    set((state) => {
      if (key !== "rating" && key !== "sector") {
        return state;
      }
      return {
        filters: {
          ...state.filters,
          [key]: safeValues,
        },
      };
    });
  },

  setExpandedRow: (symbol) => {
    set({ expandedRow: symbol ? String(symbol).toUpperCase() : null });
  },

  clearAll: () => {
    clearPersistedResearchData();
    set({
      symbols: [],
      researchData: {},
      loadingStates: {},
      currentStage: {},
      filters: { rating: [], sector: [] },
      expandedRow: null,
    });
  },
}));
