import { NarrativeSection, ParameterVerdict, StockSnapshot, VerdictLabel } from "./types";

function fmtPct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function fmtNum(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function conclusionFromVerdict(verdict: VerdictLabel): string {
  if (verdict === "Bullish") {
    return "The current setup supports accumulation with disciplined risk limits.";
  }
  if (verdict === "Neutral") {
    return "The setup is balanced; position sizing and entry timing matter.";
  }
  return "Risk-reward is fragile and requires tighter downside controls.";
}

function cagrFromSeries(values: number[]): number | null {
  if (values.length < 2 || values[0] <= 0 || values[values.length - 1] <= 0) {
    return null;
  }
  const periods = values.length - 1;
  return Math.pow(values[values.length - 1] / values[0], 1 / periods) - 1;
}

function verdictOf(
  verdicts: ParameterVerdict[],
  key: NarrativeSection["key"],
): ParameterVerdict | null {
  return verdicts.find((item) => item.key === key) ?? null;
}

export function buildNarrativeSections(
  snapshot: StockSnapshot,
  verdicts: ParameterVerdict[],
  overallVerdict: VerdictLabel,
): NarrativeSection[] {
  const core = verdictOf(verdicts, "wallStreetLens");
  const financial = verdictOf(verdicts, "financialBreakdown");
  const moat = verdictOf(verdicts, "moatStrength");
  const valuation = verdictOf(verdicts, "valuationBankingStyle");
  const risk = verdictOf(verdicts, "riskStack");
  const growth = verdictOf(verdicts, "growthPotential");
  const institutional = verdictOf(verdicts, "institutionalView");
  const debate = verdictOf(verdicts, "bullBearBalance");
  const earnings = verdictOf(verdicts, "earningsBreakdown");
  const decision = verdictOf(verdicts, "buyDecision");

  const revenueCagr = cagrFromSeries(snapshot.revenueHistory.map((item) => item.value));
  const incomeCagr = cagrFromSeries(snapshot.netIncomeHistory.map((item) => item.value));
  const fcfCagr = cagrFromSeries(snapshot.freeCashflowHistory.map((item) => item.value));

  const baseUpside = decision?.score ? Math.round((decision.score - 50) * 0.9) : 0;
  const bullUpside = baseUpside + 18;
  const bearDownside = Math.max(8, 20 - Math.round(baseUpside / 3));

  const bullishArg = `Bull case: revenue growth ${fmtPct(snapshot.revenueGrowth)} with margin profile ${fmtPct(snapshot.profitMargins)} and debt discipline ${fmtNum(snapshot.debtToEquity)}.`;
  const bearishArg = `Bear case: execution and macro shocks can compress multiples, especially if filing freshness (${snapshot.latestFilingDate ?? "n/a"}) weakens or insider tape turns negative.`;

  return [
    {
      key: "wallStreetLens",
      title: "1) Core Analysis",
      content:
        `Business model and revenue engine:\n` +
        `- ${snapshot.businessSummary ?? `${snapshot.name} operates in ${snapshot.industry ?? "its core vertical"} with diversified demand drivers.`}\n` +
        `- Sector/Industry context: ${snapshot.sector ?? "n/a"} / ${snapshot.industry ?? "n/a"}.\n` +
        `- Core financial pulse: revenue growth ${fmtPct(snapshot.revenueGrowth)}, margins ${fmtPct(snapshot.profitMargins)}, debt/equity ${fmtNum(snapshot.debtToEquity)}.\n` +
        `\nInvestment desk interpretation:\n` +
        `- Competitive posture is currently ${core?.verdict ?? overallVerdict}.\n` +
        `- 12-24M base setup: ${conclusionFromVerdict(overallVerdict)}`,
    },
    {
      key: "financialBreakdown",
      title: "2) Deep Financial Breakdown",
      content:
        `5Y fundamental trajectory:\n` +
        `- Revenue CAGR: ${revenueCagr === null ? "n/a" : fmtPct(revenueCagr)}\n` +
        `- Net Income CAGR: ${incomeCagr === null ? "n/a" : fmtPct(incomeCagr)}\n` +
        `- Free Cash Flow CAGR: ${fcfCagr === null ? "n/a" : fmtPct(fcfCagr)}\n` +
        `- ROE signal: ${fmtPct(snapshot.returnOnEquity)}\n` +
        `- Latest filing timestamp used: ${snapshot.latestFilingDate ?? "n/a"}\n` +
        `\nConclusion:\n` +
        `- Balance of growth/profitability/cash conversion indicates ${financial?.verdict ?? "Neutral"} financial resilience.`,
    },
    {
      key: "moatStrength",
      title: "3) Competitive Advantage (Moat)",
      content:
        `Moat diagnostics (brand, switching costs, cost position, execution depth):\n` +
        `- Composite moat score: ${moat?.score ?? 50}/100 (~${Math.max(1, Math.min(10, Math.round((moat?.score ?? 50) / 10)))}/10).\n` +
        `- Margin durability proxy: ${fmtPct(snapshot.profitMargins)} and trend persistence.\n` +
        `- Industry positioning lens: ${moat?.verdict ?? "Neutral"} versus peer-set median quality.\n` +
        `\nWhat can break the moat:\n` +
        `- Sustained price competition, channel disintermediation, or tech displacement without offsetting innovation.`,
    },
    {
      key: "valuationBankingStyle",
      title: "4) Stock Valuation (Investment Banking Style)",
      content:
        `Valuation stack:\n` +
        `- Trailing P/E: ${fmtNum(snapshot.trailingPE)}\n` +
        `- Forward P/E: ${fmtNum(snapshot.forwardPE)}\n` +
        `- Cross-check inputs: growth ${fmtPct(snapshot.revenueGrowth)}, cash-flow signal ${snapshot.freeCashflow === null ? "n/a" : snapshot.freeCashflow > 0 ? "positive" : "negative"}\n` +
        `\nScenario framing:\n` +
        `- Bull case potential: +${bullUpside}% if execution and rerating align.\n` +
        `- Base case potential: +${Math.max(4, baseUpside)}%.\n` +
        `- Bear case risk: -${bearDownside}% under compression/slowdown.\n` +
        `\nValuation verdict: ${valuation?.verdict ?? "Neutral"}.`,
    },
    {
      key: "riskStack",
      title: "5) Risk Analysis",
      content:
        `Ranked risk matrix (most to least dangerous):\n` +
        `1. Macro demand/rates shock\n` +
        `2. Industry disruption and pricing pressure\n` +
        `3. Regulatory/disclosure lag\n` +
        `4. Balance sheet stress and refinancing risk\n` +
        `\nQuant anchors:\n` +
        `- Beta: ${fmtNum(snapshot.beta)} | Debt/Equity: ${fmtNum(snapshot.debtToEquity)}\n` +
        `- Filing recency: ${snapshot.latestFilingDate ?? "n/a"} | Insider recency: ${snapshot.latestInsiderTransactionDate ?? "n/a"}\n` +
        `\nRisk verdict: ${risk?.verdict ?? "Neutral"}.`,
    },
    {
      key: "growthPotential",
      title: "6) Growth Potential Analysis",
      content:
        `5-10Y growth runway view:\n` +
        `- Core demand trend: revenue growth ${fmtPct(snapshot.revenueGrowth)}\n` +
        `- Earnings operating leverage: ${fmtPct(snapshot.earningsGrowth)}\n` +
        `- Expansion and product optionality: inferred from margin + cash conversion sustainability\n` +
        `\nLong-duration estimate:\n` +
        `- ${growth?.verdict === "Bullish" ? "High-conviction compounding if execution remains above sector trend." : growth?.verdict === "Neutral" ? "Balanced runway with selective upside from cycle and product wins." : "Growth profile currently fragile; needs sustained improvement in operating metrics."}`,
    },
    {
      key: "institutionalView",
      title: "7) Institutional Investor Perspective",
      content:
        `Portfolio manager lens:\n` +
        `- Why institutions may buy: quality-adjusted return profile, improving filing cadence, defensible core economics.\n` +
        `- Why they may avoid: valuation crowding, weak disclosure freshness, insider sell pressure, or unstable cash conversion.\n` +
        `- Catalysts: earnings beats, margin expansion, capital allocation clarity, policy tailwinds.\n` +
        `\nInstitutional verdict: ${institutional?.verdict ?? "Neutral"}.`,
    },
    {
      key: "bullBearBalance",
      title: "8) Bull vs Bear Debate",
      content:
        `Bull analyst:\n- ${bullishArg}\n\nBear analyst:\n- ${bearishArg}\n\nModerator conclusion:\n- ${debate?.verdict ?? "Neutral"} balance of evidence.\n- Position sizing should be scenario-weighted, not thesis-only.`,
    },
    {
      key: "earningsBreakdown",
      title: "9) Earnings Report Breakdown",
      content:
        `Latest earnings read-through:\n` +
        `- Revenue signal: ${fmtPct(snapshot.revenueGrowth)}\n` +
        `- Profit signal: ${fmtPct(snapshot.earningsGrowth)}\n` +
        `- Margins: ${fmtPct(snapshot.profitMargins)}\n` +
        `- Filing recency confirmation: ${snapshot.latestFilingDate ?? "n/a"}\n` +
        `\nInterpretation:\n` +
        `- Reporting quality and trend persistence support a ${earnings?.verdict ?? "Neutral"} earnings stance.`,
    },
    {
      key: "buyDecision",
      title: "10) Should I Buy This Stock?",
      content:
        `Time horizon calls:\n` +
        `- 1Y: ${decision?.verdict === "Bullish" ? "constructive with catalyst support" : decision?.verdict === "Neutral" ? "range-bound with tactical opportunities" : "defensive posture preferred"}\n` +
        `- 5Y+: ${overallVerdict === "Bullish" ? "compounding candidate with volatility management" : overallVerdict === "Neutral" ? "selective hold/add on dislocations" : "wait for structural improvement evidence"}\n` +
        `\nAction framework:\n` +
        `- Key catalysts: earnings delivery, margin durability, disclosure quality, capital allocation discipline\n` +
        `- Kill-switch risks: weak filing freshness, sustained FCF deterioration, leverage spike\n` +
        `\nFinal verdict: ${decision?.verdict ?? overallVerdict}. ${conclusionFromVerdict(decision?.verdict ?? overallVerdict)}`,
    },
  ];
}
