import pLimit from "p-limit";
import {
  MAX_TICKERS,
  REQUEST_CONCURRENCY,
  RESEARCH_PARAMETERS,
} from "./config";
import { buildCatalystInsight } from "./catalyst";
import { fetchStockSnapshot } from "./data";
import { buildNarrativeSections } from "./narrative";
import { buildResearchPdfBase64 } from "./pdf";
import { evaluateParameters, scoreToOverallVerdict } from "./scoring";
import { StockResearchRow } from "./types";

function fallbackRow(
  ticker: string,
  error: string,
  referencePrice: number | null,
): StockResearchRow {
  const parameterVerdicts = RESEARCH_PARAMETERS.map((parameter) => ({
    key: parameter.key,
    label: parameter.label,
    score: 0,
    verdict: "Cautious" as const,
    reason: "Data unavailable",
  }));

  return {
    ticker,
    companyName: ticker,
    closePrice: null,
    closeDate: null,
    currency: "INR",
    referencePrice,
    referencePriceDiffPct: null,
    catalystScore: 0,
    catalystSummary: ["Catalyst data unavailable."],
    topCatalysts: [],
    catalystReport: {
      executiveSummary:
        "No material news or filings found; the move may be purely technical or driven by broader market sentiment.",
      primaryCatalyst: {
        reason: "Unavailable",
        details: "Catalyst investigation failed for this symbol in current run.",
        source: "n/a",
        date: new Date().toISOString().slice(0, 10),
      },
      secondaryFactors: ["No data available."],
      institutionalActivity: ["No data available."],
      analystAction: ["No data available."],
      confidenceScore: 1,
      confidenceRationale: "Data retrieval failure.",
      questionAnswers: [],
      finalSynthesis: "Result: No material news/events found. Move is likely technical.",
      dataQualityNote: "Catalyst run failed before evidence checks could execute.",
    },
    parameterVerdicts,
    overallVerdict: "Cautious",
    overallScore: 0,
    pdfBase64: "",
    sourceUrls: [],
    narratives: [],
    error,
  };
}

export async function researchTickers(
  tickers: string[],
  referencePrices: Record<string, number> = {},
): Promise<StockResearchRow[]> {
  const trimmed = tickers.slice(0, MAX_TICKERS);
  const limit = pLimit(REQUEST_CONCURRENCY);

  return Promise.all(
    trimmed.map((ticker) =>
      limit(async () => {
        try {
          const referencePrice =
            typeof referencePrices[ticker] === "number" ? referencePrices[ticker] : null;
          const snapshot = await fetchStockSnapshot(ticker);
          const parameterVerdicts = evaluateParameters(snapshot);
          const catalyst = buildCatalystInsight(snapshot);
          const overallScore = Math.round(
            parameterVerdicts.reduce((sum, item) => sum + item.score, 0) /
              parameterVerdicts.length,
          );

          const row: StockResearchRow = {
            ticker,
            companyName: snapshot.name,
            closePrice: snapshot.closePrice,
            closeDate: snapshot.closeDate,
            currency: snapshot.currency,
            referencePrice,
            referencePriceDiffPct:
              referencePrice !== null && snapshot.closePrice !== null
                ? Math.round(((snapshot.closePrice - referencePrice) / referencePrice) * 10000) /
                  100
                : null,
            catalystScore: catalyst.score,
            catalystSummary: catalyst.summary,
            topCatalysts: catalyst.events,
            catalystReport: catalyst.report,
            parameterVerdicts,
            overallVerdict: scoreToOverallVerdict(overallScore),
            overallScore,
            pdfBase64: "",
            sourceUrls: snapshot.sourceUrls,
            narratives: [],
          };

          row.narratives = buildNarrativeSections(
            snapshot,
            parameterVerdicts,
            row.overallVerdict,
          );

          row.pdfBase64 = await buildResearchPdfBase64(row, snapshot);
          return row;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown research failure";
          const referencePrice =
            typeof referencePrices[ticker] === "number" ? referencePrices[ticker] : null;
          return fallbackRow(ticker, message, referencePrice);
        }
      }),
    ),
  );
}
