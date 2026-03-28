import yahooFinance from "yahoo-finance2";
import { StockSnapshot } from "./types";

const yfClient = new yahooFinance();

type RecordLike = Record<string, unknown>;

type QuoteSummaryLike = {
  price?: {
    longName?: string;
    shortName?: string;
    currency?: string;
  };
  summaryDetail?: {
    trailingPE?: number;
    forwardPE?: number;
    beta?: number;
  };
  defaultKeyStatistics?: {
    profitMargins?: number;
    earningsQuarterlyGrowth?: number;
    beta?: number;
    ["52WeekChange"]?: number;
  };
  financialData?: {
    revenueGrowth?: number;
    earningsGrowth?: number;
    debtToEquity?: number;
    freeCashflow?: number;
    operatingCashflow?: number;
    currentRatio?: number;
    quickRatio?: number;
    recommendationMean?: number;
    returnOnEquity?: number;
  };
  summaryProfile?: {
    sector?: string;
    industry?: string;
    longBusinessSummary?: string;
  };
  secFilings?: {
    filings?: Array<RecordLike>;
  };
  insiderTransactions?: {
    transactions?: Array<RecordLike>;
  };
  incomeStatementHistory?: {
    incomeStatementHistory?: Array<RecordLike>;
  };
  cashflowStatementHistory?: {
    cashflowStatements?: Array<RecordLike>;
  };
};

type SearchNewsLike = {
  title?: string;
  link?: string;
  providerPublishTime?: number | Date;
};

type SearchResultLike = {
  news?: SearchNewsLike[];
};

type HistoricalRowLike = {
  close?: number;
  date?: Date | string;
};

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as RecordLike;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDate(date: Date | string | null): string | null {
  if (!date) {
    return null;
  }
  const parsed = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function getDateFromRecord(item: RecordLike, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (value instanceof Date || typeof value === "string") {
      const date = formatDate(value);
      if (date) {
        return date;
      }
    }
    const nested = asRecord(value);
    if (nested && (nested.fmt || nested.raw)) {
      const fromFmt = typeof nested.fmt === "string" ? formatDate(nested.fmt) : null;
      if (fromFmt) {
        return fromFmt;
      }
      if (typeof nested.raw === "number") {
        const fromRaw = formatDate(new Date(nested.raw * 1000));
        if (fromRaw) {
          return fromRaw;
        }
      }
    }
  }
  return null;
}

function getNumberFromRecord(item: RecordLike, keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key];
    const numberValue = safeNumber(value);
    if (numberValue !== null) {
      return numberValue;
    }

    const nested = asRecord(value);
    if (nested) {
      const raw = safeNumber(nested.raw);
      if (raw !== null) {
        return raw;
      }
    }
  }
  return null;
}

function toSeriesLabel(dateString: string | null, fallback: string): string {
  if (!dateString) {
    return fallback;
  }
  return dateString.slice(0, 4);
}

export async function fetchStockSnapshot(symbol: string): Promise<StockSnapshot> {
  const now = Date.now();

  const [quoteSummaryResult, historicalResult, searchResult] = await Promise.all([
    yfClient.quoteSummary(symbol, {
      modules: [
        "price",
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
        "summaryProfile",
        "secFilings",
        "insiderTransactions",
        "incomeStatementHistory",
        "cashflowStatementHistory",
      ],
    }),
    yfClient.historical(symbol, {
      period1: new Date(now - 365 * 24 * 60 * 60 * 1000),
      period2: new Date(now),
      interval: "1d",
    }),
    yfClient.search(symbol, {
      newsCount: 8,
      quotesCount: 0,
    }),
  ]);

  const quoteSummary = quoteSummaryResult as QuoteSummaryLike;
  const historicalRows = Array.isArray(historicalResult)
    ? (historicalResult as HistoricalRowLike[])
    : [];
  const lastDailyBar =
    historicalRows.length > 0 ? historicalRows[historicalRows.length - 1] : null;

  const filings = asArray(quoteSummary.secFilings?.filings)
    .map((item) => asRecord(item))
    .filter((item): item is RecordLike => item !== null);
  const latestFilingDate = filings
    .map((item) => getDateFromRecord(item, ["date", "epochDate", "maxAge"]))
    .find((value) => value !== null) ?? null;

  const insiderTransactions = asArray(quoteSummary.insiderTransactions?.transactions)
    .map((item) => asRecord(item))
    .filter((item): item is RecordLike => item !== null);
  const latestInsiderTransactionDate = insiderTransactions
    .map((item) => getDateFromRecord(item, ["startDate", "filerDate", "transactionDate", "ownershipDate"]))
    .find((value) => value !== null) ?? null;
  const insiderNetShares = insiderTransactions.reduce<number | null>((acc, item) => {
    const shares = getNumberFromRecord(item, ["shares", "sharesTraded", "transactionShares"]);
    const value = getNumberFromRecord(item, ["value", "transactionValue"]);
    const directionText = String(item.text ?? item.ownership ?? "").toLowerCase();
    const signed = shares ?? value;
    if (signed === null) {
      return acc;
    }
    const adjusted = directionText.includes("sale") || directionText.includes("sell")
      ? -Math.abs(signed)
      : Math.abs(signed);
    return (acc ?? 0) + adjusted;
  }, null);

  const incomeHistory = asArray(quoteSummary.incomeStatementHistory?.incomeStatementHistory)
    .map((item) => asRecord(item))
    .filter((item): item is RecordLike => item !== null)
    .slice(0, 5)
    .reverse();
  const cashflowHistory = asArray(quoteSummary.cashflowStatementHistory?.cashflowStatements)
    .map((item) => asRecord(item))
    .filter((item): item is RecordLike => item !== null)
    .slice(0, 5)
    .reverse();

  const revenueHistory = incomeHistory
    .map((item, index) => {
      const date = getDateFromRecord(item, ["endDate"]);
      const value = getNumberFromRecord(item, ["totalRevenue", "revenue"]);
      if (value === null) {
        return null;
      }
      return { label: toSeriesLabel(date, `Y${index + 1}`), value };
    })
    .filter((item): item is { label: string; value: number } => item !== null);

  const netIncomeHistory = incomeHistory
    .map((item, index) => {
      const date = getDateFromRecord(item, ["endDate"]);
      const value = getNumberFromRecord(item, ["netIncome"]);
      if (value === null) {
        return null;
      }
      return { label: toSeriesLabel(date, `Y${index + 1}`), value };
    })
    .filter((item): item is { label: string; value: number } => item !== null);

  const freeCashflowHistory = cashflowHistory
    .map((item, index) => {
      const date = getDateFromRecord(item, ["endDate"]);
      const value = getNumberFromRecord(item, ["freeCashFlow", "totalCashFromOperatingActivities"]);
      if (value === null) {
        return null;
      }
      return { label: toSeriesLabel(date, `Y${index + 1}`), value };
    })
    .filter((item): item is { label: string; value: number } => item !== null);

  const priceHistory = historicalRows
    .slice(-120)
    .map((row) => {
      const value = safeNumber(row.close ?? null);
      const date = formatDate(row.date ?? null);
      if (value === null || date === null) {
        return null;
      }
      return { label: date, value };
    })
    .filter((item): item is { label: string; value: number } => item !== null);

  const companyName =
    quoteSummary.price?.longName ??
    quoteSummary.price?.shortName ??
    symbol;
  const symbolCore = symbol.split(".")[0].toUpperCase();
  const companyToken = companyName.split(" ")[0]?.toUpperCase() ?? symbolCore;

  const searchPayload = searchResult as unknown as SearchResultLike;
  const recentNews = (searchPayload.news ?? [])
    .map((news) => {
      const title = typeof news.title === "string" ? news.title.trim() : "";
      const url = typeof news.link === "string" ? news.link.trim() : "";
      if (!title || !url) {
        return null;
      }
      const date =
        typeof news.providerPublishTime === "number"
          ? formatDate(new Date(news.providerPublishTime * 1000))
          : news.providerPublishTime instanceof Date
            ? formatDate(news.providerPublishTime)
            : null;
      const headlineUpper = title.toUpperCase();
      const isRelevant =
        headlineUpper.includes(symbolCore) ||
        headlineUpper.includes(companyToken);
      if (!isRelevant) {
        return null;
      }
      return { title, url, date };
    })
    .filter((item): item is { title: string; url: string; date: string | null } => item !== null);

  const snapshot: StockSnapshot = {
    symbol,
    name: companyName,
    currency: quoteSummary.price?.currency ?? "INR",
    closePrice: safeNumber(lastDailyBar?.close ?? null),
    closeDate: formatDate(lastDailyBar?.date ?? null),
    trailingPE: safeNumber(quoteSummary.summaryDetail?.trailingPE ?? null),
    forwardPE: safeNumber(quoteSummary.summaryDetail?.forwardPE ?? null),
    revenueGrowth: safeNumber(quoteSummary.financialData?.revenueGrowth ?? null),
    earningsGrowth: safeNumber(
      quoteSummary.financialData?.earningsGrowth ??
        quoteSummary.defaultKeyStatistics?.earningsQuarterlyGrowth ??
        null,
    ),
    profitMargins: safeNumber(quoteSummary.defaultKeyStatistics?.profitMargins ?? null),
    debtToEquity: safeNumber(quoteSummary.financialData?.debtToEquity ?? null),
    freeCashflow: safeNumber(quoteSummary.financialData?.freeCashflow ?? null),
    operatingCashflow: safeNumber(
      quoteSummary.financialData?.operatingCashflow ?? null,
    ),
    beta: safeNumber(
      quoteSummary.defaultKeyStatistics?.beta ?? quoteSummary.summaryDetail?.beta ?? null,
    ),
    currentRatio: safeNumber(quoteSummary.financialData?.currentRatio ?? null),
    quickRatio: safeNumber(quoteSummary.financialData?.quickRatio ?? null),
    recommendationMean: safeNumber(quoteSummary.financialData?.recommendationMean ?? null),
    returnOnEquity: safeNumber(quoteSummary.financialData?.returnOnEquity ?? null),
    fiftyTwoWeekChange: safeNumber(
      quoteSummary.defaultKeyStatistics?.["52WeekChange"] ?? null,
    ),
    sector: quoteSummary.summaryProfile?.sector ?? null,
    industry: quoteSummary.summaryProfile?.industry ?? null,
    businessSummary: quoteSummary.summaryProfile?.longBusinessSummary ?? null,
    latestFilingDate,
    latestInsiderTransactionDate,
    insiderNetShares,
    priceHistory,
    revenueHistory,
    netIncomeHistory,
    freeCashflowHistory,
    recentNews,
    sourceUrls: [
      `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history`,
      `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis`,
      `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/financials`,
    ],
  };

  return snapshot;
}
