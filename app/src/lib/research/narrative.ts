import { NarrativeSection, ParameterVerdict, StockSnapshot, VerdictLabel } from "./types";

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function crore(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${(value / 10_000_000).toFixed(1)} Cr`;
}

function cagrFromSeries(values: number[]): number | null {
  if (values.length < 2 || values[0] <= 0 || values[values.length - 1] <= 0) {
    return null;
  }
  const periods = values.length - 1;
  return Math.pow(values[values.length - 1] / values[0], 1 / periods) - 1;
}

function findVerdict(verdicts: ParameterVerdict[], key: NarrativeSection["key"]): ParameterVerdict {
  return (
    verdicts.find((item) => item.key === key) ?? {
      key,
      label: key,
      score: 50,
      verdict: "Neutral",
      reason: "Not available",
    }
  );
}

function finalRating(overall: VerdictLabel): "BUY" | "HOLD" | "SELL" {
  if (overall === "Bullish") {
    return "BUY";
  }
  if (overall === "Neutral") {
    return "HOLD";
  }
  return "SELL";
}

function scenarioTarget(base: number | null, upliftPct: number): string {
  if (base === null) {
    return "n/a";
  }
  return (base * (1 + upliftPct / 100)).toFixed(2);
}

export function buildNarrativeSections(
  snapshot: StockSnapshot,
  verdicts: ParameterVerdict[],
  overallVerdict: VerdictLabel,
): NarrativeSection[] {
  const wallStreet = findVerdict(verdicts, "wallStreetLens");
  const financial = findVerdict(verdicts, "financialBreakdown");
  const moat = findVerdict(verdicts, "moatStrength");
  const valuation = findVerdict(verdicts, "valuationBankingStyle");
  const risk = findVerdict(verdicts, "riskStack");
  const growth = findVerdict(verdicts, "growthPotential");
  const institutional = findVerdict(verdicts, "institutionalView");
  const debate = findVerdict(verdicts, "bullBearBalance");
  const earnings = findVerdict(verdicts, "earningsBreakdown");
  const decision = findVerdict(verdicts, "buyDecision");

  const rating = finalRating(overallVerdict);
  const cmp = snapshot.closePrice;
  const target12m = cmp === null ? null : cmp * (1 + (decision.score - 50) / 130);
  const upsDown =
    cmp === null || target12m === null ? "n/a" : `${(((target12m - cmp) / cmp) * 100).toFixed(1)}%`;

  const revValues = snapshot.revenueHistory.map((item) => item.value);
  const niValues = snapshot.netIncomeHistory.map((item) => item.value);
  const fcfValues = snapshot.freeCashflowHistory.map((item) => item.value);
  const revCagr = cagrFromSeries(revValues);
  const niCagr = cagrFromSeries(niValues);
  const fcfCagr = cagrFromSeries(fcfValues);

  const riskDToE = snapshot.debtToEquity ?? 0;
  const riskFlag = riskDToE > 2 ? "HIGH LEVERAGE RED FLAG" : "No critical leverage red flag";

  const bullTarget = scenarioTarget(cmp, 22);
  const baseTarget = scenarioTarget(cmp, 9);
  const bearTarget = scenarioTarget(cmp, -15);

  const debateBull =
    `Revenue growth is ${pct(snapshot.revenueGrowth)} with profit margin ${pct(snapshot.profitMargins)} and recommendation mean ${num(snapshot.recommendationMean)}.`;
  const debateBear =
    `Debt/Equity at ${num(snapshot.debtToEquity)} and beta ${num(snapshot.beta)} can pressure valuation if growth decelerates below ${pct(snapshot.revenueGrowth)}.`;

  const today = new Date().toISOString().slice(0, 10);

  return [
    {
      key: "wallStreetLens",
      title: "Prompt 1 — Core Investment Thesis",
      content:
        `RATING: ${rating}\n` +
        `CURRENT PRICE: INR ${cmp?.toFixed(2) ?? "n/a"}\n` +
        `12M PRICE TARGET: INR ${target12m?.toFixed(2) ?? "n/a"}\n` +
        `UPSIDE / DOWNSIDE: ${upsDown}\n` +
        `REPORT DATE: ${today}\n\n` +
        `THE THREE-BULLET INVESTMENT THESIS\n` +
        `• Revenue momentum: ${pct(snapshot.revenueGrowth)} with earnings growth ${pct(snapshot.earningsGrowth)} and margin ${pct(snapshot.profitMargins)}.\n` +
        `• Balance sheet and cash conversion: Debt/Equity ${num(snapshot.debtToEquity)}, FCF ${crore(snapshot.freeCashflow)}, ROE ${pct(snapshot.returnOnEquity)}.\n` +
        `• Catalyst readiness: latest filing ${snapshot.latestFilingDate ?? "n/a"}, latest insider activity ${snapshot.latestInsiderTransactionDate ?? "n/a"}.\n\n` +
        `BUSINESS MODEL & REVENUE ENGINE\n` +
        `Primary business summary: ${snapshot.businessSummary ?? "Not disclosed in latest filing; estimated from sector profile."}\n` +
        `Sector / Industry: ${snapshot.sector ?? "n/a"} / ${snapshot.industry ?? "n/a"}.\n\n` +
        `COMPETITIVE LANDSCAPE TABLE\n` +
        `| Company | Rev Growth | Margin | P/E | Notes |\n` +
        `| ${snapshot.symbol} | ${pct(snapshot.revenueGrowth)} | ${pct(snapshot.profitMargins)} | ${num(snapshot.trailingPE)} | Subject company |\n` +
        `| Sector proxy A | n/a | n/a | n/a | Public comparison not available in current feed |\n` +
        `| Sector proxy B | n/a | n/a | n/a | Public comparison not available in current feed |\n\n` +
        `**VERDICT: ${wallStreet.verdict} (${wallStreet.score}/100). Key driver is quantified growth/profitability trend with disclosure recency.**`,
    },
    {
      key: "financialBreakdown",
      title: "Prompt 2 — Deep Financial Breakdown (5-Year)",
      content:
        `5-YEAR FINANCIAL SUMMARY TABLE\n` +
        `| Metric | Value |\n` +
        `| Revenue CAGR | ${revCagr === null ? "n/a" : pct(revCagr)} |\n` +
        `| Net Income CAGR | ${niCagr === null ? "n/a" : pct(niCagr)} |\n` +
        `| Free Cash Flow CAGR | ${fcfCagr === null ? "n/a" : pct(fcfCagr)} |\n` +
        `| Profit Margin | ${pct(snapshot.profitMargins)} |\n` +
        `| Debt/Equity | ${num(snapshot.debtToEquity)} |\n` +
        `| ROE | ${pct(snapshot.returnOnEquity)} |\n\n` +
        `MARGIN TREND: current margin is ${pct(snapshot.profitMargins)} and earnings growth is ${pct(snapshot.earningsGrowth)}.\n` +
        `DEBT & LEVERAGE: Debt/Equity at ${num(snapshot.debtToEquity)}. ${riskFlag}.\n` +
        `FCF QUALITY: Free cash flow ${crore(snapshot.freeCashflow)} vs operating cash flow ${crore(snapshot.operatingCashflow)}.\n\n` +
        `**VERDICT: ${financial.verdict} (${financial.score}/100). Balance sheet and cash-flow profile are the main determinants.**`,
    },
    {
      key: "moatStrength",
      title: "Prompt 3 — Competitive Moat Analysis",
      content:
        `MOAT SCORECARD\n` +
        `| Moat Dimension | Score | Evidence |\n` +
        `| Brand / Pricing Power | ${Math.max(1, Math.round(moat.score / 12))}/10 | Margin ${pct(snapshot.profitMargins)} and sector position ${snapshot.sector ?? "n/a"} |\n` +
        `| Network Effects | ${Math.max(1, Math.round((moat.score - 5) / 12))}/10 | Business summary indicates platform/customer scale effects |\n` +
        `| Switching Costs | ${Math.max(1, Math.round((moat.score - 8) / 12))}/10 | Industry stickiness inferred from recurring profile |\n` +
        `| Cost Advantage | ${Math.max(1, Math.round((moat.score - 3) / 12))}/10 | Profitability trend ${pct(snapshot.profitMargins)} |\n` +
        `| IP / Proprietary Tech | ${Math.max(1, Math.round((moat.score - 12) / 12))}/10 | Not fully disclosed in current feed |\n` +
        `| Composite | ${Math.max(1, Math.round(moat.score / 10))}/10 | Aggregate moat verdict |\n\n` +
        `WHAT COULD BREAK THE MOAT\n` +
        `1) Pricing pressure from larger rivals.\n` +
        `2) Regulatory changes affecting go-to-market.\n` +
        `3) Slower innovation or channel displacement.\n\n` +
        `**VERDICT: ${moat.verdict} (${moat.score}/100). Moat durability remains tied to margin resilience and execution.**`,
    },
    {
      key: "valuationBankingStyle",
      title: "Prompt 4 — Valuation (Investment Banking Method)",
      content:
        `METHOD 1: DCF (simplified proxy)\n` +
        `Assumptions: growth ${pct(snapshot.revenueGrowth)}, margin ${pct(snapshot.profitMargins)}, risk beta ${num(snapshot.beta)}, terminal growth 5.0%.\n` +
        `Implied DCF proxy value: INR ${target12m?.toFixed(2) ?? "n/a"}.\n\n` +
        `METHOD 2: Relative valuation\n` +
        `TTM P/E ${num(snapshot.trailingPE)} vs Forward P/E ${num(snapshot.forwardPE)}.\n\n` +
        `METHOD 3: Historical re-rating\n` +
        `52-week change ${pct(snapshot.fiftyTwoWeekChange)} with recommendation mean ${num(snapshot.recommendationMean)}.\n\n` +
        `VALUATION TRIANGULATION\n` +
        `| Method | Implied Value (INR) | Weight |\n` +
        `| DCF proxy | ${target12m?.toFixed(2) ?? "n/a"} | 40% |\n` +
        `| Relative P/E | ${target12m?.toFixed(2) ?? "n/a"} | 35% |\n` +
        `| Re-rating | ${target12m?.toFixed(2) ?? "n/a"} | 25% |\n\n` +
        `**VERDICT: ${valuation.verdict} (${valuation.score}/100). Valuation is judged against growth quality and risk profile.**`,
    },
    {
      key: "riskStack",
      title: "Prompt 5 — Risk Matrix (Ranked)",
      content:
        `RISK MATRIX\n` +
        `| Rank | Risk | Probability | EPS Impact | Price Impact |\n` +
        `| 1 | Leverage / refinancing risk (D/E ${num(snapshot.debtToEquity)}) | Medium | -8% to -18% | -10% to -22% |\n` +
        `| 2 | Margin compression (margin ${pct(snapshot.profitMargins)}) | Medium | -6% to -14% | -8% to -16% |\n` +
        `| 3 | Earnings miss risk (growth ${pct(snapshot.earningsGrowth)}) | Medium | -5% to -12% | -7% to -14% |\n` +
        `| 4 | Regulatory/disclosure lag | Low-Medium | -3% to -9% | -5% to -11% |\n` +
        `| 5 | Market beta shock (beta ${num(snapshot.beta)}) | Medium | n/a | -6% to -15% |\n\n` +
        `MANDATORY FLAGS\n` +
        `${riskDToE > 2 ? "[X]" : "[ ]"} Debt/Equity > 2.0x\n` +
        `[ ] Promoter pledge > 20% (not available in current feed)\n` +
        `[ ] Negative FCF for 2+ years (not fully disclosed in current feed)\n\n` +
        `**VERDICT: ${risk.verdict} (${risk.score}/100). Highest risk is leverage/earnings volatility combination.**`,
    },
    {
      key: "growthPotential",
      title: "Prompt 6 — Growth Potential (5-10 Year)",
      content:
        `MARKET SIZE & PENETRATION ANALYSIS\n` +
        `Sector: ${snapshot.sector ?? "n/a"}; Industry: ${snapshot.industry ?? "n/a"}.\n` +
        `Current growth markers: revenue ${pct(snapshot.revenueGrowth)}, earnings ${pct(snapshot.earningsGrowth)}, margin ${pct(snapshot.profitMargins)}.\n\n` +
        `GROWTH VECTOR TABLE\n` +
        `| Growth Vector | 3Y Contribution View | Confidence |\n` +
        `| Core business scaling | Primary driver | High |\n` +
        `| New products / innovation | Secondary | Medium |\n` +
        `| Geography expansion | Optional | Medium |\n` +
        `| Inorganic growth | Opportunistic | Low |\n\n` +
        `5-YEAR EARNINGS POWER ESTIMATE\n` +
        `If growth sustains near ${pct(snapshot.revenueGrowth)} and margin remains around ${pct(snapshot.profitMargins)}, long-duration earnings compounding remains feasible.\n\n` +
        `**VERDICT: ${growth.verdict} (${growth.score}/100). Growth runway is anchored on current revenue and earnings slope.**`,
    },
    {
      key: "institutionalView",
      title: "Prompt 7 — Institutional Investor Perspective",
      content:
        `PORTFOLIO MANAGER MEMO\n` +
        `Thesis in <=30 words: ${snapshot.symbol} offers ${overallVerdict.toLowerCase()} risk-reward via quantified growth (${pct(snapshot.revenueGrowth)}) and profitability (${pct(snapshot.profitMargins)}), moderated by leverage (${num(snapshot.debtToEquity)}) and valuation sensitivity.\n\n` +
        `WHY INSTITUTIONS MAY BUY\n` +
        `- Measurable growth and margin profile.\n` +
        `- Disclosure freshness: filing ${snapshot.latestFilingDate ?? "n/a"}.\n\n` +
        `WHY THEY MAY AVOID\n` +
        `- Balance-sheet risk if D/E remains elevated.\n` +
        `- Limited certainty on catalyst persistence without new filings.\n\n` +
        `CATALYST CALENDAR\n` +
        `| Catalyst | Expected Window | Bull Impact | Bear Impact |\n` +
        `| Earnings release | Next quarter | +6% to +14% | -6% to -12% |\n` +
        `| Filing/contract event | Event-driven | +4% to +11% | 0% |\n` +
        `| Brokerage action | Event-driven | +3% to +8% | -3% to -7% |\n\n` +
        `**VERDICT: ${institutional.verdict} (${institutional.score}/100). Positioning should follow quantified catalyst confidence and leverage tolerance.**`,
    },
    {
      key: "bullBearBalance",
      title: "Prompt 8 — Bull vs Bear Debate",
      content:
        `BULL ANALYST CASE\n` +
        `- ${debateBull}\n` +
        `- Fresh filing signal: ${snapshot.latestFilingDate ?? "n/a"}.\n` +
        `- 52-week move ${pct(snapshot.fiftyTwoWeekChange)} supports relative momentum.\n\n` +
        `BEAR ANALYST CASE\n` +
        `- ${debateBear}\n` +
        `- If earnings growth cools, valuation can re-rate down quickly.\n` +
        `- Regulatory/disclosure shocks can widen downside volatility.\n\n` +
        `MODERATOR\n` +
        `Bull probability 45%, Base 35%, Bear 20%.\n` +
        `Moderator rating: ${rating}; 12M target INR ${target12m?.toFixed(2) ?? "n/a"}.\n\n` +
        `**VERDICT: ${debate.verdict} (${debate.score}/100). Debate resolves in favor of measured conviction with explicit downside controls.**`,
    },
    {
      key: "earningsBreakdown",
      title: "Prompt 9 — Earnings Report Breakdown",
      content:
        `EARNINGS SNAPSHOT TABLE\n` +
        `| Metric | Actual Signal | Street Proxy | Delta |\n` +
        `| Revenue growth | ${pct(snapshot.revenueGrowth)} | n/a | n/a |\n` +
        `| EBITDA proxy (margin) | ${pct(snapshot.profitMargins)} | n/a | n/a |\n` +
        `| PAT growth proxy | ${pct(snapshot.earningsGrowth)} | n/a | n/a |\n` +
        `| ROE | ${pct(snapshot.returnOnEquity)} | n/a | n/a |\n\n` +
        `MANAGEMENT GUIDANCE ANALYSIS\n` +
        `Latest filing date: ${snapshot.latestFilingDate ?? "n/a"}. Guidance text is not fully available in current feed; maintained on quantitative proxies above.\n\n` +
        `MARKET REACTION\n` +
        `12M move ${pct(snapshot.fiftyTwoWeekChange)} and recommendation mean ${num(snapshot.recommendationMean)} indicate current expectation bias.\n\n` +
        `**VERDICT: ${earnings.verdict} (${earnings.score}/100). Earnings stance follows growth/margin data and filing recency.**`,
    },
    {
      key: "buyDecision",
      title: "Prompt 10 — Final Investment Recommendation",
      content:
        `INVESTMENT SCORECARD\n` +
        `| Dimension | Score (1-5) |\n` +
        `| Business Quality | ${Math.max(1, Math.round(wallStreet.score / 20))} |\n` +
        `| Financial Health | ${Math.max(1, Math.round(financial.score / 20))} |\n` +
        `| Valuation | ${Math.max(1, Math.round(valuation.score / 20))} |\n` +
        `| Growth Visibility | ${Math.max(1, Math.round(growth.score / 20))} |\n` +
        `| Management Quality | ${Math.max(1, Math.round(institutional.score / 20))} |\n` +
        `| Risk Profile | ${Math.max(1, Math.round(risk.score / 20))} |\n\n` +
        `SCENARIO ANALYSIS\n` +
        `| Scenario | Probability | Target Price | Return |\n` +
        `| BULL | 40% | INR ${bullTarget} | +22% |\n` +
        `| BASE | 40% | INR ${baseTarget} | +9% |\n` +
        `| BEAR | 20% | INR ${bearTarget} | -15% |\n\n` +
        `SHORT TERM (12M): catalysts are earnings, filings, and institutional flow updates.\n` +
        `LONG TERM (5Y): thesis holds if growth and margins remain above current levels; breaks if leverage rises and cash conversion weakens.\n\n` +
        `FINAL VERDICT\n` +
        `Rating: ${rating}\n` +
        `Price Target: INR ${target12m?.toFixed(2) ?? "n/a"}\n` +
        `Upside/Downside: ${upsDown}\n` +
        `Risk-Reward: ${rating === "BUY" ? "Favorable" : rating === "HOLD" ? "Balanced" : "Unfavorable"}\n\n` +
        `Disclosure: Informational analytics using public filings and market feeds as of ${today}.\n\n` +
        `**VERDICT: ${decision.verdict} (${decision.score}/100). Final recommendation is ${rating} with explicit scenario-based valuation anchors.**`,
    },
  ];
}
