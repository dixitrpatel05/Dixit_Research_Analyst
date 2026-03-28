import {
  CatalystEvent,
  CatalystQuestionAnswer,
  CatalystReport,
  FilingItem,
  StockSnapshot,
} from "./types";

type EvidenceItem = {
  title: string;
  date: string;
  source: string;
  url?: string;
  tier: "filing" | "news" | "derived";
};

type QuestionBuildInput = {
  id: number;
  question: string;
  timeframe: string;
  evidence: EvidenceItem[];
  signalWhenYes: "BULLISH" | "BEARISH" | "NEUTRAL";
  yesSummary: string;
  noSummary: string;
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

function normalizeFilingSource(item: FilingItem): string {
  return item.source || `NSE/BSE filing (${item.date})`;
}

function filingEvidence(snapshot: StockSnapshot, regex: RegExp, maxDays: number): EvidenceItem[] {
  return snapshot.recentFilings
    .filter((item) => withinDays(item.date, maxDays) && regex.test(item.title.toLowerCase()))
    .map((item) => ({
      title: item.title,
      date: item.date,
      source: normalizeFilingSource(item),
      url: item.url,
      tier: "filing" as const,
    }));
}

function newsEvidence(snapshot: StockSnapshot, regex: RegExp, maxDays: number): EvidenceItem[] {
  return snapshot.recentNews
    .filter((item) => withinDays(item.date, maxDays) && regex.test(item.title.toLowerCase()))
    .map((item) => ({
      title: item.title,
      date: item.date ?? todayYmd(),
      source: `Financial media (${item.date ?? "date n/a"})`,
      url: item.url,
      tier: "news" as const,
    }));
}

function pickEvidence(snapshot: StockSnapshot, regex: RegExp, maxDays: number): EvidenceItem[] {
  const filings = filingEvidence(snapshot, regex, maxDays);
  const news = newsEvidence(snapshot, regex, maxDays);
  return [...filings, ...news]
    .sort((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier === "filing" ? -1 : 1;
      }
      return a.date < b.date ? 1 : -1;
    })
    .slice(0, 3);
}

function signalFromAnswer(
  hasEvidence: boolean,
  yesSignal: "BULLISH" | "BEARISH" | "NEUTRAL",
): "BULLISH" | "BEARISH" | "NEUTRAL" | "NO SIGNAL" {
  if (!hasEvidence) {
    return "NO SIGNAL";
  }
  return yesSignal;
}

function buildQuestionAnswer(input: QuestionBuildInput): CatalystQuestionAnswer {
  const hasEvidence = input.evidence.length > 0;
  const best = input.evidence[0];

  const reasoning = hasEvidence
    ? `${input.yesSummary} Source: ${best.source}${best.url ? ` (${best.url})` : ""}; Date: ${best.date}. ` +
      `Analytical read-through: ${best.title} is material enough to flag ${input.signalWhenYes.toLowerCase()} bias for near-term price action.`
    : input.noSummary;

  return {
    id: input.id,
    question: input.question,
    answer: hasEvidence ? "YES" : "NO",
    signal: signalFromAnswer(hasEvidence, input.signalWhenYes),
    timeframe: input.timeframe,
    reasoning,
    evidence: input.evidence.map((item) => `${item.date}: ${item.title}`),
    sources: input.evidence.map((item) => item.url).filter((item): item is string => Boolean(item)),
  };
}

function primaryFromAnswers(answers: CatalystQuestionAnswer[]): CatalystQuestionAnswer | null {
  const priority = [1, 4, 2, 5, 3, 6, 7, 9, 10, 8];
  for (const id of priority) {
    const found = answers.find((item) => item.id === id && item.answer === "YES");
    if (found) {
      return found;
    }
  }
  return null;
}

function confidenceFromAnswers(answers: CatalystQuestionAnswer[]): number {
  const yes = answers.filter((item) => item.answer === "YES");
  const filingBacked = yes.filter((item) => item.evidence.some((line) => /filing/i.test(line))).length;
  const score = Math.min(10, Math.max(1, yes.length * 0.7 + filingBacked * 0.9 + 1.5));
  return Math.round(score * 10) / 10;
}

function confidenceLabel(score: number): string {
  if (score >= 8.5) {
    return "High confidence: filing-linked and time-bounded evidence supports catalyst attribution.";
  }
  if (score >= 6.5) {
    return "Medium confidence: multiple checks are YES but some are based on secondary news flow.";
  }
  if (score >= 5) {
    return "Moderate confidence: limited direct filings; catalyst signal is mixed.";
  }
  return "Low confidence: most checks are NO and current move may be technical/sentiment-led.";
}

function overallDirection(answers: CatalystQuestionAnswer[]): "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" {
  const yes = answers.filter((item) => item.answer === "YES");
  const bull = yes.filter((item) => item.signal === "BULLISH").length;
  const bear = yes.filter((item) => item.signal === "BEARISH").length;
  if (bull === 0 && bear === 0) {
    return "NEUTRAL";
  }
  if (bull >= bear + 2) {
    return "BULLISH";
  }
  if (bear >= bull + 2) {
    return "BEARISH";
  }
  if (bull === bear) {
    return "MIXED";
  }
  return bull > bear ? "BULLISH" : "BEARISH";
}

export function buildCatalystInsight(snapshot: StockSnapshot): {
  score: number;
  summary: string[];
  events: CatalystEvent[];
  report: CatalystReport;
} {
  const q1 = buildQuestionAnswer({
    id: 1,
    question: "Order wins or business expansion in last 14 days?",
    timeframe: "14 days",
    evidence: pickEvidence(
      snapshot,
      /(order win|letter of award|\bloa\b|contract|mou|partnership|strategic partnership|business expansion)/,
      14,
    ),
    signalWhenYes: "BULLISH",
    yesSummary: "YES: order/business expansion evidence found within the defined window.",
    noSummary:
      "NO: No order win, contract award, or partnership announcement found in exchange filings or verified news sources within the 14-day window.",
  });

  const q2Base = pickEvidence(
    snapshot,
    /(bulk deal|block deal|\bfii\b|\bdii\b|mutual fund|institutional buy|institutional sell|stake change)/,
    30,
  );
  const q2Derived: EvidenceItem[] = withinDays(snapshot.latestInsiderTransactionDate, 30)
    ? [
        {
          title: `Insider net shares: ${snapshot.insiderNetShares ?? 0}`,
          date: snapshot.latestInsiderTransactionDate ?? todayYmd(),
          source: `Insider disclosure (${snapshot.latestInsiderTransactionDate ?? todayYmd()})`,
          tier: "derived" as const,
        },
      ]
    : [];
  const q2Evidence = [...q2Base, ...q2Derived].slice(0, 3);
  const q2Signal = (snapshot.insiderNetShares ?? 0) < 0 ? "BEARISH" : "BULLISH";
  const q2 = buildQuestionAnswer({
    id: 2,
    question: "Institutional/smart-money activity in last 30 days?",
    timeframe: "30 days",
    evidence: q2Evidence,
    signalWhenYes: q2Signal,
    yesSummary: "YES: institutional/insider flow signal detected in the 30-day window.",
    noSummary:
      "NO: No bulk deals, block deals, or significant institutional flow detected in NSE/BSE-linked evidence for the 30-day window.",
  });

  const q3 = buildQuestionAnswer({
    id: 3,
    question: "Brokerage upgrades/target revisions in last 7 days?",
    timeframe: "7 days",
    evidence: pickEvidence(
      snapshot,
      /(target price|upgrade|overweight|initiates coverage|buy rating|outperform|downgrade)/,
      7,
    ),
    signalWhenYes: "BULLISH",
    yesSummary: "YES: brokerage action signal detected in the 7-day window.",
    noSummary:
      "NO: No brokerage upgrade, initiation, or target-price revision detected in the 7-day window across tracked coverage signals.",
  });

  const q4 = buildQuestionAnswer({
    id: 4,
    question: "Earnings surprise signal in last 14 days?",
    timeframe: "14 days",
    evidence: [
      ...pickEvidence(
        snapshot,
        /(q1|q2|q3|q4|results|ebitda|pat|beat estimates|margin expansion|earnings beat|earnings miss)/,
        14,
      ),
      ...(withinDays(snapshot.latestFilingDate, 14)
        ? [
            {
              title: `Recent exchange filing timestamp with earnings growth ${((snapshot.earningsGrowth ?? 0) * 100).toFixed(1)}%`,
              date: snapshot.latestFilingDate ?? todayYmd(),
              source: `NSE/BSE filing (${snapshot.latestFilingDate ?? todayYmd()})`,
              tier: "filing" as const,
            },
          ]
        : []),
    ].slice(0, 3),
    signalWhenYes: (snapshot.earningsGrowth ?? 0) >= 0 ? "BULLISH" : "BEARISH",
    yesSummary: "YES: earnings/event update detected with fresh filing alignment.",
    noSummary:
      "NO: No quarterly earnings release or operational update found within the 14-day window.",
  });

  const q5 = buildQuestionAnswer({
    id: 5,
    question: "Insider/promoter action in last 3 months?",
    timeframe: "3 months",
    evidence: [
      ...pickEvidence(
        snapshot,
        /(promoter buying|promoter selling|open market purchase|sast|insider trading|pledge|stake increase|stake sale)/,
        90,
      ),
      ...(withinDays(snapshot.latestInsiderTransactionDate, 90)
        ? [
            {
              title: `Insider net shares ${snapshot.insiderNetShares ?? 0}`,
              date: snapshot.latestInsiderTransactionDate ?? todayYmd(),
              source: `Insider disclosure (${snapshot.latestInsiderTransactionDate ?? todayYmd()})`,
              tier: "derived" as const,
            },
          ]
        : []),
    ].slice(0, 3),
    signalWhenYes: (snapshot.insiderNetShares ?? 0) < 0 ? "BEARISH" : "BULLISH",
    yesSummary: "YES: promoter/insider action is visible in the 3-month lookback.",
    noSummary:
      "NO: No promoter or insider buying/selling disclosed in SEBI/BSE-linked evidence within the 3-month window.",
  });

  const q6 = buildQuestionAnswer({
    id: 6,
    question: "Corporate action announced (bonus/split/dividend/buyback)?",
    timeframe: "latest board window",
    evidence: pickEvidence(
      snapshot,
      /(board meeting|bonus|stock split|dividend|buyback|record date|ex-date|rights issue)/,
      120,
    ),
    signalWhenYes: "NEUTRAL",
    yesSummary: "YES: board/corporate-action trigger is present in available disclosures.",
    noSummary:
      "NO: No corporate action announcement or board notice related to split/bonus/dividend/buyback was found in current evidence.",
  });

  const q7 = buildQuestionAnswer({
    id: 7,
    question: "M&A or fundraising announced/approved in last 30 days?",
    timeframe: "30 days",
    evidence: pickEvidence(
      snapshot,
      /(acquisition|merger|demerger|asset sale|\bqip\b|preferential issue|fund raising|fundraising|rights issue|ncd|debenture)/,
      30,
    ),
    signalWhenYes: "NEUTRAL",
    yesSummary: "YES: strategic transaction/fundraising indicator is present in the defined window.",
    noSummary:
      "NO: No M&A transaction, strategic acquisition, or fundraising announcement found within the 30-day window.",
  });

  const q8 = buildQuestionAnswer({
    id: 8,
    question: "Sectoral or macro tailwind in last 30 days?",
    timeframe: "30 days",
    evidence: pickEvidence(
      snapshot,
      /(pli|subsidy|import duty|government approval|policy|budget allocation|tariff|regulation)/,
      30,
    ),
    signalWhenYes: "NEUTRAL",
    yesSummary: "YES: sector-policy/macro tailwind reference found in recent items.",
    noSummary:
      "NO: No direct sector-specific policy or macro tailwind identified in the 30-day window for this company.",
  });

  const q9Evidence = pickEvidence(
    snapshot,
    /(usfda|eir|show cause|sebi|income tax|gst demand|import alert|clearance|probe|notice|summons)/,
    180,
  );
  const q9Negative = q9Evidence.some((item) =>
    /(show cause|income tax|gst demand|import alert|probe|summons|notice)/i.test(item.title),
  );
  const q9 = buildQuestionAnswer({
    id: 9,
    question: "Regulatory action or clearance since last earnings?",
    timeframe: "latest available",
    evidence: q9Evidence,
    signalWhenYes: q9Negative ? "BEARISH" : "BULLISH",
    yesSummary: q9Negative
      ? "YES: adverse regulatory mention detected; treat as risk flag until clarified."
      : "YES: regulatory clearance/approval-style mention detected.",
    noSummary:
      "NO: No significant regulatory approval or adverse regulatory action found in available disclosures.",
  });

  const q10Evidence = pickEvidence(
    snapshot,
    /(resignation|appointment|change).*(ceo|md|cfo|auditor|director)|(ceo|md|cfo|auditor|director).*(resignation|appointment|change)/,
    30,
  );
  const q10RedFlag = q10Evidence.some((item) => /(auditor|cfo).*(resignation|exit)|resignation.*(auditor|cfo)/i.test(item.title));
  const q10 = buildQuestionAnswer({
    id: 10,
    question: "Management or auditor changes in last 30 days?",
    timeframe: "30 days",
    evidence: q10Evidence,
    signalWhenYes: q10RedFlag ? "BEARISH" : "NEUTRAL",
    yesSummary: q10RedFlag
      ? "YES: leadership/auditor change detected with potential governance concern."
      : "YES: management change detected; monitor for transition risk.",
    noSummary:
      "NO: No management or auditor change disclosed in exchange-linked evidence within the 30-day window.",
  });

  const answers: CatalystQuestionAnswer[] = [q1, q2, q3, q4, q5, q6, q7, q8, q9, q10];
  const yesAnswers = answers.filter((item) => item.answer === "YES");
  const noAnswers = answers.filter((item) => item.answer === "NO");

  const primary = primaryFromAnswers(answers);
  const direction = overallDirection(answers);
  const confidenceScore = confidenceFromAnswers(answers);

  const redFlags = answers
    .filter((item) => item.signal === "BEARISH" && item.answer === "YES")
    .map((item) => `Q${item.id}: ${item.question}`);

  const finalSynthesis =
    yesAnswers.length === 0
      ? "Result: No material news/events found. Move is likely technical."
      : `${direction}: Primary catalyst is Q${primary?.id ?? "?"} with ${yesAnswers.length}/10 checks marked YES. ` +
        `${redFlags.length > 0 ? `Red flags: ${redFlags.join("; ")}.` : "No major red flags detected in YES set."}`;

  const primaryCatalyst = primary
    ? {
        reason: `Q${primary.id} — ${primary.question}`,
        details: primary.reasoning,
        source: primary.sources[0] ?? "NSE/BSE filing reference not directly available in feed",
        date: primary.evidence[0]?.slice(0, 10) ?? (snapshot.closeDate ?? todayYmd()),
      }
    : {
        reason: "No material catalyst",
        details:
          "No fundamental catalyst or verified event was detected in defined lookback windows; current move is likely technical/sentiment-led.",
        source: "No qualifying source",
        date: todayYmd(),
      };

  const secondaryFactors = yesAnswers
    .filter((item) => primary?.id !== item.id)
    .slice(0, 3)
    .map((item) => `Q${item.id} [${item.signal}] ${item.reasoning}`);

  if (secondaryFactors.length === 0) {
    secondaryFactors.push("No secondary catalyst passed YES thresholds.");
  }

  const institutionalActivity = [q2, q5].map(
    (item) => `Q${item.id} [${item.answer}] [${item.signal}] ${item.reasoning}`,
  );

  const analystAction = [q3].map(
    (item) => `Q${item.id} [${item.answer}] [${item.signal}] ${item.reasoning}`,
  );

  const bullishSignals = yesAnswers.filter((item) => item.signal === "BULLISH").length;
  const bearishSignals = yesAnswers.filter((item) => item.signal === "BEARISH").length;
  const catalystScore = Math.max(0, Math.min(100, 50 + bullishSignals * 9 - bearishSignals * 12 + yesAnswers.length * 2));

  const events: CatalystEvent[] = yesAnswers.slice(0, 6).map((item) => ({
    type: `Q${item.id}`,
    title: item.reasoning,
    date: item.evidence[0]?.slice(0, 10) ?? (snapshot.closeDate ?? todayYmd()),
    direction:
      item.signal === "BULLISH"
        ? "Bullish"
        : item.signal === "BEARISH"
          ? "Cautious"
          : "Neutral",
    confidence: Math.min(95, 55 + item.evidence.length * 12),
    source: item.sources[0] ?? "Filing/news evidence",
    sourceType: item.id <= 2 || item.id === 4 || item.id === 6 || item.id === 9 ? "exchange" : item.id === 3 ? "broker" : "news",
    verified: item.sources.length > 0,
    url: item.sources[0],
  }));

  const executiveSummary =
    yesAnswers.length === 0
      ? `${snapshot.symbol}: no material event was confirmed across the 10-question catalyst checklist. Directional bias remains neutral and move may be technical.`
      : `${snapshot.symbol}: ${yesAnswers.length}/10 checks are YES with primary trigger Q${primary?.id ?? "?"}. Directional signal is ${direction} and confidence is ${confidenceScore}/10 based on evidence quality.`;

  const summary: string[] = [
    `Executive: ${executiveSummary}`,
    `Primary Catalyst: ${primaryCatalyst.reason}`,
    `YES/NO Tally: YES ${yesAnswers.length} | NO ${noAnswers.length} | Direction: ${direction}`,
    `Confidence: ${confidenceScore}/10 (${confidenceLabel(confidenceScore)})`,
  ];

  const report: CatalystReport = {
    executiveSummary,
    primaryCatalyst,
    secondaryFactors,
    institutionalActivity,
    analystAction,
    confidenceScore,
    confidenceRationale: confidenceLabel(confidenceScore),
    questionAnswers: answers,
    finalSynthesis,
    dataQualityNote:
      "Checklist uses available Yahoo-linked filing/news evidence and strict lookback filters. Missing evidence is marked NO by design (no hallucination).",
  };

  return {
    score: catalystScore,
    summary,
    events,
    report,
  };
}
