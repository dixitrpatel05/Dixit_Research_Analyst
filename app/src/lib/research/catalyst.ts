import {
  CatalystEvent,
  CatalystQuestionAnswer,
  CatalystReport,
  StockSnapshot,
} from "./types";

type NewsMatch = {
  title: string;
  date: string;
  url: string;
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) {
    return null;
  }
  const timestamp = new Date(dateStr).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function withinDays(dateStr: string | null, days: number): boolean {
  const age = daysSince(dateStr);
  return age !== null && age >= 0 && age <= days;
}

function findNewsMatches(
  snapshot: StockSnapshot,
  keywords: RegExp,
  maxAgeDays: number,
): NewsMatch[] {
  return snapshot.recentNews
    .filter((item) => item.date && withinDays(item.date, maxAgeDays) && keywords.test(item.title.toLowerCase()))
    .map((item) => ({
      title: item.title,
      date: item.date ?? todayYmd(),
      url: item.url,
    }));
}

function toDirection(answer: "YES" | "NO", isNegative = false): "Bullish" | "Neutral" | "Cautious" {
  if (answer === "NO") {
    return "Neutral";
  }
  return isNegative ? "Cautious" : "Bullish";
}

function buildQa(params: {
  id: number;
  question: string;
  timeframe: string;
  yes: boolean;
  reasoningYes: string;
  reasoningNo: string;
  evidence: string[];
  sources: string[];
}): CatalystQuestionAnswer {
  return {
    id: params.id,
    question: params.question,
    timeframe: params.timeframe,
    answer: params.yes ? "YES" : "NO",
    reasoning: params.yes ? params.reasoningYes : params.reasoningNo,
    evidence: params.evidence,
    sources: params.sources,
  };
}

function confidenceLabel(score: number): string {
  if (score >= 8.5) {
    return "High confidence from time-bounded and source-tagged evidence.";
  }
  if (score >= 6.5) {
    return "Medium confidence with partial evidence coverage across the 10 checks.";
  }
  if (score >= 5) {
    return "Moderate confidence; mostly secondary signals and limited official confirmation.";
  }
  return "Low confidence; most checks returned NO in current evidence window.";
}

export function buildCatalystInsight(snapshot: StockSnapshot): {
  score: number;
  summary: string[];
  events: CatalystEvent[];
  report: CatalystReport;
} {
  const q1News = findNewsMatches(
    snapshot,
    /(order win|letter of award|\bloa\b|contract|new order|partnership|expansion)/,
    14,
  );
  const q1Yes = q1News.length > 0;

  const q2News = findNewsMatches(
    snapshot,
    /(bulk deal|block deal|\bfii\b|\bdii\b|mutual fund bought|stake increase)/,
    30,
  );
  const q2Yes = q2News.length > 0 || (withinDays(snapshot.latestInsiderTransactionDate, 30) && (snapshot.insiderNetShares ?? 0) !== 0);

  const q3News = findNewsMatches(
    snapshot,
    /(target price|upgrade|overweight|initiates coverage|buy rating|outperform)/,
    7,
  );
  const q3Yes = q3News.length > 0;

  const q4News = findNewsMatches(
    snapshot,
    /(results|\bpat\b|ebitda|beat estimates|margin jump|profit jump|q1|q2|q3|q4)/,
    14,
  );
  const q4Yes = q4News.length > 0 || (withinDays(snapshot.latestFilingDate, 14) && (snapshot.earningsGrowth ?? 0) > 0.08);

  const q5News = findNewsMatches(
    snapshot,
    /(promoter buying|open market purchase|increases stake|insider buying|insider selling|pledge invocation)/,
    90,
  );
  const q5Yes = q5News.length > 0 || (withinDays(snapshot.latestInsiderTransactionDate, 90) && (snapshot.insiderNetShares ?? 0) !== 0);

  const q6News = findNewsMatches(
    snapshot,
    /(board meeting|bonus|stock split|dividend|buyback|record date|ex-date)/,
    90,
  );
  const q6Yes = q6News.length > 0;

  const q7News = findNewsMatches(
    snapshot,
    /(acquisition|merger|\bqip\b|preferential issue|fund rais(ing|e)|announced|approved)/,
    90,
  );
  const q7Yes = q7News.length > 0;

  const q8News = findNewsMatches(
    snapshot,
    /(pli scheme|subsidy|import duty|government approval|policy|tailwind)/,
    30,
  );
  const q8Yes = q8News.length > 0;

  const q9News = findNewsMatches(
    snapshot,
    /(usfda|\beir\b|show cause notice|\bsebi\b|income tax search|import alert|clearance)/,
    120,
  );
  const q9Yes = q9News.length > 0;
  const q9Negative = q9News.some((item) => /(show cause|income tax search|import alert|notice)/i.test(item.title));

  const q10News = findNewsMatches(
    snapshot,
    /(resignation|appointment).*(ceo|md|cfo|auditor)|(ceo|md|cfo|auditor).*(resignation|appointment)/,
    30,
  );
  const q10Yes = q10News.length > 0;

  const qa: CatalystQuestionAnswer[] = [
    buildQa({
      id: 1,
      question: "Order wins or business expansion in last 14 days?",
      timeframe: "14 days",
      yes: q1Yes,
      reasoningYes: "Matched order/contract/partnership keywords in time-bounded news evidence.",
      reasoningNo: "No time-bounded order/LOA/contract signal found in current data feed.",
      evidence: q1News.slice(0, 2).map((item) => `${item.date}: ${item.title}`),
      sources: q1News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 2,
      question: "Institutional or smart-money activity in last 30 days?",
      timeframe: "30 days",
      yes: q2Yes,
      reasoningYes: "Detected insider/institutional flow indicator inside defined window.",
      reasoningNo: "No block/bulk/FII/DII or insider flow confirmation inside 30 days.",
      evidence: [
        ...(withinDays(snapshot.latestInsiderTransactionDate, 30)
          ? [`${snapshot.latestInsiderTransactionDate}: insider net shares ${snapshot.insiderNetShares ?? 0}`]
          : []),
        ...q2News.slice(0, 1).map((item) => `${item.date}: ${item.title}`),
      ],
      sources: q2News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 3,
      question: "Brokerage upgrades/target revisions in last 7 days?",
      timeframe: "7 days",
      yes: q3Yes,
      reasoningYes: "Upgrade/target-price language detected within 7-day window.",
      reasoningNo: "No recent verified brokerage upgrade/target-price cue in current feed.",
      evidence: q3News.slice(0, 2).map((item) => `${item.date}: ${item.title}`),
      sources: q3News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 4,
      question: "Earnings surprise signal in last 14 days?",
      timeframe: "14 days",
      yes: q4Yes,
      reasoningYes: "Recent results-related signal and/or filing freshness with positive earnings trend found.",
      reasoningNo: "No qualified earnings-beat signal found inside 14-day filter.",
      evidence: [
        ...(withinDays(snapshot.latestFilingDate, 14) ? [`${snapshot.latestFilingDate}: latest filing timestamp`] : []),
        ...q4News.slice(0, 1).map((item) => `${item.date}: ${item.title}`),
      ],
      sources: q4News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 5,
      question: "Insider/promoter action in last 3 months?",
      timeframe: "3 months",
      yes: q5Yes,
      reasoningYes: "Insider/promoter activity present in filings/news within 3 months.",
      reasoningNo: "No promoter/insider action confirmation in the 3-month window.",
      evidence: [
        ...(withinDays(snapshot.latestInsiderTransactionDate, 90)
          ? [`${snapshot.latestInsiderTransactionDate}: insider net shares ${snapshot.insiderNetShares ?? 0}`]
          : []),
        ...q5News.slice(0, 1).map((item) => `${item.date}: ${item.title}`),
      ],
      sources: q5News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 6,
      question: "Corporate action announced (bonus/split/dividend/buyback)?",
      timeframe: "latest available",
      yes: q6Yes,
      reasoningYes: "Corporate-action terms found in relevant news lines.",
      reasoningNo: "No concrete corporate-action announcement detected in current feed.",
      evidence: q6News.slice(0, 2).map((item) => `${item.date}: ${item.title}`),
      sources: q6News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 7,
      question: "M&A or fundraising announced/approved?",
      timeframe: "latest available",
      yes: q7Yes,
      reasoningYes: "M&A/fund-raise language detected in announcement/news evidence.",
      reasoningNo: "No announced/approved M&A or fundraising signal found.",
      evidence: q7News.slice(0, 2).map((item) => `${item.date}: ${item.title}`),
      sources: q7News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 8,
      question: "Sector or macro tailwind in last 30 days?",
      timeframe: "30 days",
      yes: q8Yes,
      reasoningYes: "Policy/tailwind keyword match found in sector-related news.",
      reasoningNo: "No direct sector-policy tailwind linkage found in 30-day window.",
      evidence: q8News.slice(0, 2).map((item) => `${item.date}: ${item.title}`),
      sources: q8News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 9,
      question: "Regulatory action/clearance signal present?",
      timeframe: "latest available",
      yes: q9Yes,
      reasoningYes: q9Negative
        ? "Regulatory mention found with potentially adverse wording."
        : "Regulatory mention found with non-adverse wording.",
      reasoningNo: "No regulatory trigger keywords detected in current source window.",
      evidence: q9News.slice(0, 2).map((item) => `${item.date}: ${item.title}`),
      sources: q9News.slice(0, 2).map((item) => item.url),
    }),
    buildQa({
      id: 10,
      question: "Management change (CEO/MD/CFO/Auditor) in last 30 days?",
      timeframe: "30 days",
      yes: q10Yes,
      reasoningYes: "Management-change wording detected in recent items.",
      reasoningNo: "No management change signal in 30-day scan window.",
      evidence: q10News.slice(0, 2).map((item) => `${item.date}: ${item.title}`),
      sources: q10News.slice(0, 2).map((item) => item.url),
    }),
  ];

  const yesAnswers = qa.filter((item) => item.answer === "YES");
  const noAnswers = qa.filter((item) => item.answer === "NO");

  const weightedYesScore = Math.round(
    qa.reduce((acc, item) => {
      if (item.answer === "NO") {
        return acc;
      }
      const weight = item.id <= 4 ? 11 : item.id <= 7 ? 8 : 6;
      return acc + weight;
    }, 0),
  );
  const catalystScore = Math.max(0, Math.min(100, weightedYesScore));

  const confidenceScore = Math.round(
    Math.max(1, Math.min(10, (yesAnswers.length / 10) * 7 + (snapshot.latestFilingDate ? 2 : 0.7))) *
      10,
  ) / 10;

  const primaryYes = yesAnswers[0] ?? null;
  const executiveSummary = primaryYes
    ? `${snapshot.symbol}: ${yesAnswers.length}/10 catalyst checks are YES. Strongest confirmed trigger is Q${primaryYes.id} (${primaryYes.question.toLowerCase()}) in the defined timeframe.`
    : `${snapshot.symbol}: all 10 catalyst checks are NO in current data window; move likely technical unless fresh exchange disclosures appear.`;

  const primaryCatalyst = primaryYes
    ? {
        reason: `Q${primaryYes.id}: ${primaryYes.question}`,
        details: primaryYes.reasoning,
        source: primaryYes.sources[0] ?? "No URL captured in current feed",
        date: primaryYes.evidence[0]?.slice(0, 10) ?? (snapshot.closeDate ?? todayYmd()),
      }
    : {
        reason: "No material catalyst detected",
        details: "No material news/events found. Move is likely technical.",
        source: "No qualifying evidence in current scan window",
        date: todayYmd(),
      };

  const secondaryFactors = yesAnswers
    .slice(1, 4)
    .map((item) => `Q${item.id} YES: ${item.reasoning}`);
  if (secondaryFactors.length === 0) {
    secondaryFactors.push("No additional secondary catalyst passed YES criteria.");
  }

  const institutionalActivity = qa
    .filter((item) => item.id === 2 || item.id === 5)
    .map((item) => `Q${item.id} ${item.answer}: ${item.reasoning}`);

  const analystAction = qa
    .filter((item) => item.id === 3)
    .map((item) => `Q${item.id} ${item.answer}: ${item.reasoning}`);

  const events: CatalystEvent[] = yesAnswers.slice(0, 6).map((item) => ({
    type: `Q${item.id} catalyst`,
    title: item.reasoning,
    date: item.evidence[0]?.slice(0, 10) ?? (snapshot.closeDate ?? todayYmd()),
    direction: toDirection(item.answer, item.id === 9 && q9Negative),
    confidence: Math.min(95, 55 + item.evidence.length * 15),
    source: item.sources[0] ?? "Yahoo linked news",
    sourceType: item.id <= 2 || item.id === 4 || item.id === 6 || item.id === 9 ? "exchange" : item.id === 3 ? "broker" : "news",
    verified: item.sources.length > 0,
    url: item.sources[0],
  }));

  const finalSynthesis =
    yesAnswers.length > 0
      ? `YES catalysts found: ${yesAnswers.map((item) => `Q${item.id}`).join(", ")}. Prioritize Q1/Q4/Q2 evidence over lower-tier signals.`
      : "Result: No material news/events found. Move is likely technical.";

  const summary: string[] = [
    `Executive: ${executiveSummary}`,
    `Primary: ${primaryCatalyst.reason}`,
    `YES/NO tally: YES ${yesAnswers.length} | NO ${noAnswers.length}`,
    `Confidence: ${confidenceScore}/10 (${confidenceLabel(confidenceScore)}).`,
  ];

  const report: CatalystReport = {
    executiveSummary,
    primaryCatalyst,
    secondaryFactors,
    institutionalActivity,
    analystAction,
    confidenceScore,
    confidenceRationale: confidenceLabel(confidenceScore),
    questionAnswers: qa,
    finalSynthesis,
    dataQualityNote:
      "Current runtime uses Yahoo-linked market/news feeds and filing timestamps. Official NSE/BSE search endpoints are not directly queried in this build; unanswered checks default to NO.",
  };

  return {
    score: catalystScore,
    summary,
    events,
    report,
  };
}
