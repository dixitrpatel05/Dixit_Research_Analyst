import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_TICKERS } from "@/lib/research/config";
import { researchTickers } from "@/lib/research/service";
import { normalizeTradingViewTickers } from "@/lib/research/tickers";

const imageRowSchema = z.object({
  symbol: z.string().min(1),
  price: z.number().positive().optional(),
});

const bodySchema = z.object({
  tickers: z.array(z.string().min(1)).max(MAX_TICKERS).optional(),
  imageRows: z.array(imageRowSchema).max(MAX_TICKERS).optional(),
}).superRefine((value, ctx) => {
  const tickerCount = value.tickers?.length ?? 0;
  const imageCount = value.imageRows?.length ?? 0;
  if (tickerCount + imageCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either tickers or imageRows.",
      path: ["tickers"],
    });
  }
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = bodySchema.parse(json);
    const inputSymbols = [
      ...(parsed.tickers ?? []),
      ...((parsed.imageRows ?? []).map((item) => item.symbol)),
    ];

    const normalized = normalizeTradingViewTickers(inputSymbols);

    if (normalized.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid tickers found. Use TradingView tickers like NSE:RELIANCE or BSE:500325.",
        },
        { status: 400 },
      );
    }

    if (normalized.length > MAX_TICKERS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_TICKERS} tickers allowed per request.` },
        { status: 400 },
      );
    }

    const referencePricesRaw: Record<string, number> = {};
    for (const row of parsed.imageRows ?? []) {
      if (typeof row.price !== "number") {
        continue;
      }
      const normalizedSymbol = normalizeTradingViewTickers([row.symbol])[0];
      if (normalizedSymbol) {
        referencePricesRaw[normalizedSymbol] = row.price;
      }
    }

    const rows = await researchTickers(normalized, referencePricesRaw);
    return NextResponse.json({
      asOf: new Date().toISOString(),
      source: "Yahoo Finance public endpoints",
      rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
