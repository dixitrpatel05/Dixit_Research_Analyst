import { ResearchParameter } from "./types";

export const RESEARCH_PARAMETERS: ResearchParameter[] = [
  {
    key: "wallStreetLens",
    label: "1) Core Analysis",
    description: "Business model, moat, trend, health, and 12-24M outlook",
  },
  {
    key: "financialBreakdown",
    label: "2) 5Y Financials",
    description: "5-year revenue, earnings, FCF, margins, debt, and ROE",
  },
  {
    key: "moatStrength",
    label: "3) Moat",
    description: "Competitive moat and durability versus peers",
  },
  {
    key: "valuationBankingStyle",
    label: "4) Valuation",
    description: "P/E benchmark and intrinsic value framing",
  },
  {
    key: "riskStack",
    label: "5) Risk",
    description: "Macro, competition, regulation, and balance sheet risks",
  },
  {
    key: "growthPotential",
    label: "6) Growth Potential",
    description: "Market size, expansion runway, and innovation optionality",
  },
  {
    key: "institutionalView",
    label: "7) Institutional View",
    description: "Portfolio-fit quality from fund manager perspective",
  },
  {
    key: "bullBearBalance",
    label: "8) Bull vs Bear",
    description: "Balance between bull and bear evidence",
  },
  {
    key: "earningsBreakdown",
    label: "9) Earnings",
    description: "Latest earnings quality versus expectations",
  },
  {
    key: "buyDecision",
    label: "10) Buy/Hold/Avoid",
    description: "Integrated investment decision confidence",
  },
];

export const MAX_TICKERS = 50;
export const REQUEST_CONCURRENCY = 6;

// JPM/BlackRock-style multi-factor emphasis: fundamentals first, then risk and valuation.
export const INSTITUTIONAL_FACTOR_WEIGHTS = {
  valuation: 0.14,
  growth: 0.18,
  profitability: 0.16,
  balanceSheet: 0.12,
  cashFlow: 0.12,
  momentum: 0.06,
  volatility: 0.05,
  liquidity: 0.05,
  analystConfidence: 0.04,
  earningsQuality: 0.08,
};
