import { INSTITUTIONAL_FACTOR_WEIGHTS, RESEARCH_PARAMETERS } from "./config";
import { ParameterVerdict, StockSnapshot, VerdictLabel } from "./types";

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function toVerdict(score: number): VerdictLabel {
  if (score >= 67) {
    return "Bullish";
  }
  if (score >= 45) {
    return "Neutral";
  }
  return "Cautious";
}

function pctText(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function numText(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function valueOrDefault(value: number | null, fallback: number): number {
  return value === null || Number.isNaN(value) ? fallback : value;
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) {
    return null;
  }
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

function freshnessToScore(days: number | null): number {
  if (days === null) {
    return 45;
  }
  if (days <= 30) {
    return 92;
  }
  if (days <= 90) {
    return 80;
  }
  if (days <= 180) {
    return 62;
  }
  return 40;
}

export function evaluateParameters(snapshot: StockSnapshot): ParameterVerdict[] {
  const pe = snapshot.trailingPE ?? snapshot.forwardPE;
  const valuationScore = pe === null ? 50 : clamp(100 - (pe - 15) * 2.5);

  const growthScore = clamp(valueOrDefault(snapshot.revenueGrowth, 0) * 100 + 50);

  const profitabilityScore =
    snapshot.profitMargins === null
      ? 50
      : clamp(snapshot.profitMargins * 250 + 30);

  const balanceSheetScore =
    snapshot.debtToEquity === null
      ? 50
      : clamp(95 - snapshot.debtToEquity * 0.45);

  const cashFlowSignal =
    snapshot.freeCashflow !== null
      ? snapshot.freeCashflow
      : snapshot.operatingCashflow;
  const cashFlowScore =
    cashFlowSignal === null
      ? 50
      : cashFlowSignal > 0
        ? 78
        : 32;

  const momentumScore =
    snapshot.fiftyTwoWeekChange === null
      ? 50
      : clamp(snapshot.fiftyTwoWeekChange * 120 + 50);

  const volatilityScore =
    snapshot.beta === null ? 50 : clamp(100 - Math.abs(snapshot.beta - 1) * 45);

  const liquidityRatio =
    snapshot.currentRatio ?? snapshot.quickRatio;
  const liquidityScore =
    liquidityRatio === null ? 50 : clamp(liquidityRatio * 45 + 10);

  const analystConfidenceScore =
    snapshot.recommendationMean === null
      ? 50
      : clamp(100 - (snapshot.recommendationMean - 1) * 26);

  const earningsQualityScore =
    snapshot.earningsGrowth === null
      ? 50
      : clamp(snapshot.earningsGrowth * 100 + 50);

  const filingFreshnessScore = freshnessToScore(daysSince(snapshot.latestFilingDate));
  const insiderFreshnessScore = freshnessToScore(
    daysSince(snapshot.latestInsiderTransactionDate),
  );
  const filingAndInsiderFreshness = Math.round(
    (filingFreshnessScore + insiderFreshnessScore) / 2,
  );

  const weightedCoreScore = Math.round(
    valuationScore * INSTITUTIONAL_FACTOR_WEIGHTS.valuation +
      growthScore * INSTITUTIONAL_FACTOR_WEIGHTS.growth +
      profitabilityScore * INSTITUTIONAL_FACTOR_WEIGHTS.profitability +
      balanceSheetScore * INSTITUTIONAL_FACTOR_WEIGHTS.balanceSheet +
      cashFlowScore * INSTITUTIONAL_FACTOR_WEIGHTS.cashFlow +
      momentumScore * INSTITUTIONAL_FACTOR_WEIGHTS.momentum +
      volatilityScore * INSTITUTIONAL_FACTOR_WEIGHTS.volatility +
      liquidityScore * INSTITUTIONAL_FACTOR_WEIGHTS.liquidity +
      analystConfidenceScore * INSTITUTIONAL_FACTOR_WEIGHTS.analystConfidence +
      earningsQualityScore * INSTITUTIONAL_FACTOR_WEIGHTS.earningsQuality,
  );

  const scoreMap = {
    wallStreetLens: {
      score: Math.round((weightedCoreScore + filingAndInsiderFreshness) / 2),
      reason: `Institutional blend + data freshness score`,
    },
    financialBreakdown: {
      score: Math.round(
        (growthScore + profitabilityScore + cashFlowScore + filingFreshnessScore) / 4,
      ),
      reason: `5Y trend composite with latest filing recency`,
    },
    moatStrength: {
      score: Math.round((profitabilityScore + momentumScore + growthScore) / 3),
      reason: `Margin durability + growth leadership`,
    },
    valuationBankingStyle: {
      score: valuationScore,
      reason: `P/E: ${numText(pe)}`,
    },
    riskStack: {
      score: Math.round((balanceSheetScore + volatilityScore + filingFreshnessScore) / 3),
      reason: `Debt + volatility + regulatory disclosure freshness`,
    },
    growthPotential: {
      score: growthScore,
      reason: `Revenue growth: ${pctText(snapshot.revenueGrowth)}`,
    },
    institutionalView: {
      score: Math.round(
        (weightedCoreScore + liquidityScore + analystConfidenceScore + filingAndInsiderFreshness) /
          4,
      ),
      reason: `Weighted quality, liquidity and confidence view`,
    },
    bullBearBalance: {
      score: Math.round((momentumScore + valuationScore + balanceSheetScore) / 3),
      reason: `Trend vs valuation vs risk balance`,
    },
    earningsBreakdown: {
      score: Math.round((earningsQualityScore + filingFreshnessScore) / 2),
      reason: `Earnings growth + latest reporting recency`,
    },
    buyDecision: {
      score: Math.round(
        (weightedCoreScore * 0.75 + filingAndInsiderFreshness * 0.25),
      ),
      reason: `Institutional weighted conviction + freshness filter`,
    },
  };

  return RESEARCH_PARAMETERS.map((parameter) => {
    const result = scoreMap[parameter.key];
    const roundedScore = Math.round(result.score);
    return {
      key: parameter.key,
      label: parameter.label,
      score: roundedScore,
      verdict: toVerdict(roundedScore),
      reason: result.reason,
    };
  });
}

export function scoreToOverallVerdict(score: number): VerdictLabel {
  return toVerdict(score);
}
