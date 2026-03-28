import { PDFFont, PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { StockResearchRow, StockSnapshot, TimeSeriesPoint } from "./types";

const LEFT = 50;
const TOP = 780;
const LINE_HEIGHT = 18;
const FONT_SIZE = 11;
const MAX_CHARS = 96;

type TextLine = {
  text: string;
  isSpacer?: boolean;
};

function formatLargeNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  return value.toFixed(0);
}

function wrapLine(text: string, maxChars = MAX_CHARS): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) {
        lines.push(current);
      }
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function wrapRichText(text: string, maxChars = MAX_CHARS): TextLine[] {
  const paragraphs = text.split("\n");
  const output: TextLine[] = [];
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      output.push({ text: "", isSpacer: true });
      continue;
    }
    const wrapped = wrapLine(trimmed, maxChars);
    wrapped.forEach((line) => output.push({ text: line }));
  }
  return output;
}

function wrapLineByWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  font: PDFFont,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      flush();
    }

    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const ch of word) {
      const next = `${chunk}${ch}`;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        chunk = next;
      } else {
        lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }

  flush();
  return lines;
}

function drawSectionCard(page: PDFPage, x: number, y: number, width: number, height: number) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.85, 0.89, 0.92),
    borderWidth: 1,
    color: rgb(0.98, 0.99, 1),
  });
}

function drawKeyMetrics(page: PDFPage, snapshot: StockSnapshot, x: number, y: number) {
  const metrics = [
    ["Trailing P/E", snapshot.trailingPE === null ? "n/a" : snapshot.trailingPE.toFixed(2)],
    ["Forward P/E", snapshot.forwardPE === null ? "n/a" : snapshot.forwardPE.toFixed(2)],
    ["Revenue Growth", snapshot.revenueGrowth === null ? "n/a" : `${(snapshot.revenueGrowth * 100).toFixed(1)}%`],
    ["Earnings Growth", snapshot.earningsGrowth === null ? "n/a" : `${(snapshot.earningsGrowth * 100).toFixed(1)}%`],
    ["Profit Margin", snapshot.profitMargins === null ? "n/a" : `${(snapshot.profitMargins * 100).toFixed(1)}%`],
    ["Debt / Equity", snapshot.debtToEquity === null ? "n/a" : snapshot.debtToEquity.toFixed(2)],
    ["ROE", snapshot.returnOnEquity === null ? "n/a" : `${(snapshot.returnOnEquity * 100).toFixed(1)}%`],
    ["Latest Filing", snapshot.latestFilingDate ?? "n/a"],
  ];

  let cy = y;
  for (const [label, value] of metrics) {
    page.drawText(label, {
      x,
      y: cy,
      size: 9,
      color: rgb(0.31, 0.37, 0.43),
    });
    page.drawText(value, {
      x: x + 110,
      y: cy,
      size: 9,
      color: rgb(0.1, 0.16, 0.23),
    });
    cy -= 13;
  }
}

function drawScenarioTable(page: PDFPage, row: StockResearchRow, x: number, y: number, width: number) {
  const basePrice = row.closePrice ?? row.referencePrice ?? 0;
  const scoreEdge = (row.overallScore - 50) / 100;
  const bull = basePrice * (1.18 + Math.max(0, scoreEdge));
  const base = basePrice * (1.08 + scoreEdge * 0.5);
  const bear = basePrice * (0.88 + scoreEdge * 0.2);

  const rows = [
    ["Bull", `${Math.round((bull / Math.max(basePrice, 1) - 1) * 100)}%`, bull.toFixed(2)],
    ["Base", `${Math.round((base / Math.max(basePrice, 1) - 1) * 100)}%`, base.toFixed(2)],
    ["Bear", `${Math.round((bear / Math.max(basePrice, 1) - 1) * 100)}%`, bear.toFixed(2)],
  ];

  page.drawText("Scenario Grid (12M)", {
    x,
    y,
    size: 10,
  });

  let cy = y - 14;
  page.drawText("Case", { x, y: cy, size: 9 });
  page.drawText("Return", { x: x + 70, y: cy, size: 9 });
  page.drawText("Implied Value", { x: x + 145, y: cy, size: 9 });

  cy -= 12;
  page.drawLine({
    start: { x, y: cy + 8 },
    end: { x: x + width, y: cy + 8 },
    thickness: 1,
    color: rgb(0.84, 0.88, 0.92),
  });

  for (const [caseName, ret, value] of rows) {
    page.drawText(caseName, { x, y: cy, size: 9 });
    page.drawText(ret, { x: x + 70, y: cy, size: 9 });
    page.drawText(value, { x: x + 145, y: cy, size: 9 });
    cy -= 12;
  }
}

function drawLineChart(params: {
  page: PDFPage;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  points: TimeSeriesPoint[];
}) {
  const { page, x, y, width, height, title, points } = params;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.84, 0.88, 0.92),
    borderWidth: 1,
    color: rgb(0.98, 0.99, 1),
  });

  page.drawText(title, {
    x: x + 8,
    y: y + height - 14,
    size: 9,
  });

  if (points.length < 2) {
    page.drawText("Insufficient series", {
      x: x + 10,
      y: y + height / 2,
      size: 9,
      color: rgb(0.5, 0.56, 0.62),
    });
    return;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];

    const x1 = x + 12 + ((i - 1) / (points.length - 1)) * (width - 24);
    const x2 = x + 12 + (i / (points.length - 1)) * (width - 24);
    const y1 = y + 14 + ((prev.value - min) / span) * (height - 30);
    const y2 = y + 14 + ((next.value - min) / span) * (height - 30);

    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: 1.6,
      color: rgb(0.07, 0.42, 0.65),
    });
  }

  page.drawText(formatLargeNumber(min), {
    x: x + 8,
    y: y + 3,
    size: 8,
    color: rgb(0.4, 0.46, 0.52),
  });
  page.drawText(formatLargeNumber(max), {
    x: x + width - 60,
    y: y + 3,
    size: 8,
    color: rgb(0.4, 0.46, 0.52),
  });
}

function drawBarChart(params: {
  page: PDFPage;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  points: TimeSeriesPoint[];
}) {
  const { page, x, y, width, height, title, points } = params;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.84, 0.88, 0.92),
    borderWidth: 1,
    color: rgb(0.99, 0.99, 0.97),
  });

  page.drawText(title, {
    x: x + 8,
    y: y + height - 14,
    size: 9,
  });

  if (points.length === 0) {
    page.drawText("No financial series", {
      x: x + 10,
      y: y + height / 2,
      size: 9,
      color: rgb(0.5, 0.56, 0.62),
    });
    return;
  }

  const maxAbs = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  const barWidth = Math.max(8, (width - 20) / points.length - 6);

  points.forEach((point, index) => {
    const heightRatio = Math.abs(point.value) / maxAbs;
    const barHeight = heightRatio * (height - 35);
    const bx = x + 10 + index * (barWidth + 6);
    const by = y + 12;

    page.drawRectangle({
      x: bx,
      y: by,
      width: barWidth,
      height: barHeight,
      color: point.value >= 0 ? rgb(0.06, 0.54, 0.39) : rgb(0.73, 0.18, 0.1),
    });

    page.drawText(point.label, {
      x: bx,
      y: y + 2,
      size: 7,
      color: rgb(0.36, 0.42, 0.49),
    });
  });
}

export async function buildResearchPdfBase64(
  row: StockResearchRow,
  snapshot: StockSnapshot,
): Promise<string> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

  let y = TOP;

  page.drawRectangle({
    x: 0,
    y: 810,
    width: 595,
    height: 32,
    color: rgb(0.06, 0.25, 0.42),
  });
  page.drawText("Institutional Research Report", {
    x: LEFT,
    y: 821,
    size: 11,
    font: titleFont,
    color: rgb(1, 1, 1),
  });

  page.drawText(`Research Report: ${row.companyName} (${row.ticker})`, {
    x: LEFT,
    y,
    size: 16,
    font: titleFont,
    color: rgb(0.05, 0.1, 0.2),
  });

  y -= LINE_HEIGHT * 2;
  page.drawText(`Close: ${row.closePrice ?? "N/A"} ${row.currency} | Date: ${row.closeDate ?? "N/A"}`, {
    x: LEFT,
    y,
    size: FONT_SIZE,
    font: bodyFont,
  });

  y -= LINE_HEIGHT;
  drawSectionCard(page, LEFT, y - 130, 495, 130);
  page.drawLine({
    start: { x: LEFT + 288, y: y - 126 },
    end: { x: LEFT + 288, y: y - 2 },
    thickness: 1,
    color: rgb(0.87, 0.9, 0.93),
  });
  page.drawText("Catalyst Snapshot", {
    x: LEFT + 8,
    y: y - 12,
    size: 11,
    font: titleFont,
    color: rgb(0.07, 0.18, 0.32),
  });

  let cy = y - 28;
  const summaryLines = row.catalystSummary
    .slice(0, 4)
    .flatMap((line) => wrapLineByWidth(`- ${line}`, 268, 8.5, bodyFont))
    .slice(0, 10);
  for (const line of summaryLines) {
    page.drawText(line, {
      x: LEFT + 10,
      y: cy,
      size: 8.5,
      font: bodyFont,
      color: rgb(0.12, 0.2, 0.28),
    });
    cy -= 10;
  }

  const rankedCatalysts = row.topCatalysts.slice(0, 2);
  const rx = LEFT + 300;
  let ry = y - 28;
  for (const event of rankedCatalysts) {
    if (ry < y - 114) {
      break;
    }
    page.drawText(`${event.type}: ${event.direction} (${event.confidence})`, {
      x: rx,
      y: ry,
      size: 8.5,
      font: titleFont,
    });
    ry -= 10;
    for (const part of wrapLineByWidth(event.title, 176, 8, bodyFont).slice(0, 4)) {
      if (ry < y - 118) {
        break;
      }
      page.drawText(part, {
        x: rx,
        y: ry,
        size: 8,
        font: bodyFont,
        color: rgb(0.25, 0.32, 0.39),
      });
      ry -= 9;
    }
    ry -= 3;
  }

  y -= 146;

  page.drawText("Catalyst & Price Action Report", {
    x: LEFT,
    y,
    size: 11,
    font: titleFont,
  });
  y -= 14;

  const reportLines = [
    `1. Executive Summary: ${row.catalystReport.executiveSummary}`,
    `2. Primary Catalyst: ${row.catalystReport.primaryCatalyst.reason} | ${row.catalystReport.primaryCatalyst.details}`,
    `   Source: ${row.catalystReport.primaryCatalyst.source} | Date: ${row.catalystReport.primaryCatalyst.date}`,
    `3. YES/NO Checklist:`,
  ];

  const questionLines =
    row.catalystReport.questionAnswers.length > 0
      ? row.catalystReport.questionAnswers.map(
          (item) =>
            `   Q${item.id} [${item.answer}] [${item.signal}] ${item.question} (${item.timeframe}) - ${item.reasoning}`,
        )
      : [
          `   Q-checks unavailable for this run.`,
        ];

  reportLines.push(...questionLines);
  reportLines.push(
    `4. Final Synthesis: ${row.catalystReport.finalSynthesis}`,
    `5. Confidence: ${row.catalystReport.confidenceScore}/10 - ${row.catalystReport.confidenceRationale}`,
    `6. Data Note: ${row.catalystReport.dataQualityNote}`,
  );

  for (const text of reportLines) {
    const wrapped = wrapLineByWidth(text, 495, 8.5, bodyFont);
    for (const line of wrapped) {
      if (y < 180) {
        break;
      }
      page.drawText(line, {
        x: LEFT,
        y,
        size: 8.5,
        font: bodyFont,
      });
      y -= 10;
    }
    y -= 2;
  }

  y -= 6;
  drawSectionCard(page, LEFT, y - 120, 250, 120);
  page.drawText("Key Metrics Snapshot", {
    x: LEFT + 8,
    y: y - 12,
    size: 10,
    font: titleFont,
  });
  drawKeyMetrics(page, snapshot, LEFT + 8, y - 26);

  drawSectionCard(page, LEFT + 265, y - 120, 280, 120);
  drawScenarioTable(page, row, LEFT + 274, y - 20, 250);

  y -= 140;

  if (row.narratives.length > 0) {
    const summaryLines = wrapLine(row.narratives[0].content, 70).slice(0, 7);
    page.drawText("Executive Summary", {
      x: LEFT,
      y,
      size: 12,
      font: titleFont,
    });
    y -= 14;
    for (const line of summaryLines) {
      page.drawText(line, {
        x: LEFT,
        y,
        size: 9,
        font: bodyFont,
      });
      y -= 12;
    }
    y -= 8;
  }

  if (row.referencePrice !== null) {
    page.drawText(
      `Watchlist image reference: ${row.referencePrice.toFixed(2)} | Drift vs live: ${row.referencePriceDiffPct ?? "n/a"}%`,
      {
        x: LEFT,
        y,
        size: FONT_SIZE,
        font: bodyFont,
      },
    );
    y -= LINE_HEIGHT;
  }

  page.drawText(`Overall Verdict: ${row.overallVerdict} (${row.overallScore}/100)`, {
    x: LEFT,
    y,
    size: FONT_SIZE,
    font: bodyFont,
  });

  y -= LINE_HEIGHT;
  page.drawText(
    `Latest filing: ${snapshot.latestFilingDate ?? "n/a"} | Latest insider activity: ${snapshot.latestInsiderTransactionDate ?? "n/a"}`,
    {
      x: LEFT,
      y,
      size: FONT_SIZE,
      font: bodyFont,
    },
  );

  y -= LINE_HEIGHT * 1.4;
  drawLineChart({
    page,
    x: LEFT,
    y: y - 100,
    width: 260,
    height: 100,
    title: "Price Trend (Latest 120D)",
    points: snapshot.priceHistory,
  });

  drawBarChart({
    page,
    x: LEFT + 275,
    y: y - 100,
    width: 270,
    height: 100,
    title: "Revenue 5Y",
    points: snapshot.revenueHistory,
  });

  y -= 120;
  drawBarChart({
    page,
    x: LEFT,
    y: y - 100,
    width: 260,
    height: 100,
    title: "Net Income 5Y",
    points: snapshot.netIncomeHistory,
  });

  drawBarChart({
    page,
    x: LEFT + 275,
    y: y - 100,
    width: 270,
    height: 100,
    title: "Free Cash Flow 5Y",
    points: snapshot.freeCashflowHistory,
  });

  y -= 120;

  page.drawText("10-Parameter Verdict Breakdown", {
    x: LEFT,
    y,
    size: 13,
    font: titleFont,
  });

  y -= LINE_HEIGHT;
  for (const item of row.parameterVerdicts) {
    const sentence = `${item.label}: ${item.verdict} (${item.score}/100) - ${item.reason}`;
    const lines = wrapLine(sentence);
    for (const line of lines) {
      if (y < 80) {
        break;
      }
      page.drawText(line, {
        x: LEFT,
        y,
        size: FONT_SIZE,
        font: bodyFont,
      });
      y -= LINE_HEIGHT;
    }
  }

  let narrativePage = pdf.addPage([595, 842]);
  let ny = TOP;
  narrativePage.drawRectangle({
    x: 0,
    y: 810,
    width: 595,
    height: 32,
    color: rgb(0.1, 0.23, 0.36),
  });
  narrativePage.drawText("Full Narrative Research (10 Prompts)", {
    x: LEFT,
    y: 821,
    size: 15,
    font: titleFont,
    color: rgb(1, 1, 1),
  });

  ny -= 32;

  ny -= LINE_HEIGHT * 1.6;
  for (const section of row.narratives) {
    const sectionLines = wrapRichText(section.content, 98);
    const estimatedHeight = LINE_HEIGHT * (sectionLines.length + 2);
    if (ny - estimatedHeight < 70) {
      narrativePage = pdf.addPage([595, 842]);
      ny = TOP;
      narrativePage.drawRectangle({
        x: 0,
        y: 810,
        width: 595,
        height: 32,
        color: rgb(0.1, 0.23, 0.36),
      });
      narrativePage.drawText("Full Narrative Research (Contd.)", {
        x: LEFT,
        y: 821,
        size: 13,
        font: titleFont,
        color: rgb(1, 1, 1),
      });
      ny -= 32;
    }

    narrativePage.drawText(section.title, {
      x: LEFT,
      y: ny,
      size: 12,
      font: titleFont,
      color: rgb(0.07, 0.14, 0.28),
    });
    ny -= LINE_HEIGHT;

    for (const line of sectionLines) {
      if (line.isSpacer) {
        ny -= 8;
        continue;
      }
      narrativePage.drawText(line.text, {
        x: LEFT,
        y: ny,
        size: FONT_SIZE,
        font: bodyFont,
      });
      ny -= LINE_HEIGHT;
    }
    ny -= 6;
  }

  if (ny < 120) {
    narrativePage = pdf.addPage([595, 842]);
    ny = TOP;
  }

  narrativePage.drawText("Data Sources", {
    x: LEFT,
    y: ny,
    size: 12,
    font: titleFont,
  });
  ny -= LINE_HEIGHT;

  for (const source of row.sourceUrls) {
    const lines = wrapLine(source, 90);
    for (const line of lines) {
      if (ny < 60) {
        break;
      }
      narrativePage.drawText(line, {
        x: LEFT,
        y: ny,
        size: FONT_SIZE,
        font: bodyFont,
        color: rgb(0, 0.25, 0.7),
      });
      ny -= LINE_HEIGHT;
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes).toString("base64");
}
