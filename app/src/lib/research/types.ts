export type VerdictLabel = "Bullish" | "Neutral" | "Cautious";

export type ResearchParameterKey =
  | "wallStreetLens"
  | "financialBreakdown"
  | "moatStrength"
  | "valuationBankingStyle"
  | "riskStack"
  | "growthPotential"
  | "institutionalView"
  | "bullBearBalance"
  | "earningsBreakdown"
  | "buyDecision";

export interface ResearchParameter {
  key: ResearchParameterKey;
  label: string;
  description: string;
}

export interface ParameterVerdict {
  key: ResearchParameterKey;
  label: string;
  score: number;
  verdict: VerdictLabel;
  reason: string;
}

export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface NarrativeSection {
  key: ResearchParameterKey;
  title: string;
  content: string;
}

export type CatalystDirection = "Bullish" | "Neutral" | "Cautious";

export interface CatalystEvent {
  type: string;
  title: string;
  date: string;
  direction: CatalystDirection;
  confidence: number;
  source: string;
  sourceType: "exchange" | "institutional" | "broker" | "news" | "market";
  verified: boolean;
  url?: string;
}

export interface CatalystReport {
  executiveSummary: string;
  primaryCatalyst: {
    reason: string;
    details: string;
    source: string;
    date: string;
  };
  secondaryFactors: string[];
  institutionalActivity: string[];
  analystAction: string[];
  confidenceScore: number;
  confidenceRationale: string;
  questionAnswers: CatalystQuestionAnswer[];
  finalSynthesis: string;
  dataQualityNote: string;
}

export interface CatalystQuestionAnswer {
  id: number;
  question: string;
  answer: "YES" | "NO";
  signal: "BULLISH" | "BEARISH" | "NEUTRAL" | "NO SIGNAL";
  timeframe: string;
  reasoning: string;
  evidence: string[];
  sources: string[];
}

export interface FilingItem {
  title: string;
  date: string;
  source: string;
  url?: string;
}

export interface NewsItem {
  title: string;
  date: string | null;
  url: string;
}

export interface StockSnapshot {
  symbol: string;
  name: string;
  currency: string;
  closePrice: number | null;
  closeDate: string | null;
  trailingPE: number | null;
  forwardPE: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  profitMargins: number | null;
  debtToEquity: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;
  beta: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  recommendationMean: number | null;
  fiftyTwoWeekChange: number | null;
  sector: string | null;
  industry: string | null;
  businessSummary: string | null;
  returnOnEquity: number | null;
  latestFilingDate: string | null;
  recentFilings: FilingItem[];
  latestInsiderTransactionDate: string | null;
  insiderNetShares: number | null;
  priceHistory: TimeSeriesPoint[];
  revenueHistory: TimeSeriesPoint[];
  netIncomeHistory: TimeSeriesPoint[];
  freeCashflowHistory: TimeSeriesPoint[];
  recentNews: NewsItem[];
  sourceUrls: string[];
}

export interface StockResearchRow {
  ticker: string;
  companyName: string;
  closePrice: number | null;
  closeDate: string | null;
  currency: string;
  referencePrice: number | null;
  referencePriceDiffPct: number | null;
  catalystScore: number;
  catalystSummary: string[];
  topCatalysts: CatalystEvent[];
  catalystReport: CatalystReport;
  parameterVerdicts: ParameterVerdict[];
  overallVerdict: VerdictLabel;
  overallScore: number;
  pdfBase64: string;
  sourceUrls: string[];
  narratives: NarrativeSection[];
  error?: string;
}

export interface ResearchResponse {
  asOf: string;
  source: string;
  rows: StockResearchRow[];
}
