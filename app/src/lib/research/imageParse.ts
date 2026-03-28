export interface ParsedWatchlistRow {
  symbol: string;
  price: number;
}

const NOISE = new Set(["SYMBOL", "LAST", "LTP", "CHG", "CHANGE", "VOLUME", "WS"]);

function normalizeSymbolToken(token: string): string {
  return token
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "")
    .replace(/0/g, "O");
}

function normalizePriceToken(token: string): number | null {
  const cleaned = token.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  if (!cleaned) {
    return null;
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value > 2_000_000) {
    return null;
  }

  return value;
}

function tokenize(rawText: string): string[] {
  return rawText
    .replace(/[•|]/g, " ")
    .replace(/[\u2022\u25CF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function parseWatchlistText(rawText: string): ParsedWatchlistRow[] {
  const rows: ParsedWatchlistRow[] = [];
  const seen = new Set<string>();

  const lines = rawText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  // Pass 1: line-based extraction for clean OCR rows.
  for (const originalLine of lines) {
    const line = originalLine
      .replace(/[•|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const match = line.match(/([A-Z][A-Z0-9._-]{1,20})\s+([0-9][0-9,]*(?:\.[0-9]+)?)/i);
    if (!match) {
      continue;
    }

    const symbol = normalizeSymbolToken(match[1]);
    if (symbol.length < 3 || NOISE.has(symbol)) {
      continue;
    }

    const price = normalizePriceToken(match[2]);
    if (price === null || seen.has(symbol)) {
      continue;
    }

    seen.add(symbol);
    rows.push({ symbol, price });
  }

  // Pass 2: token-window extraction for noisy OCR where line structure is broken.
  const tokens = tokenize(rawText);
  for (let i = 0; i < tokens.length; i += 1) {
    const symbol = normalizeSymbolToken(tokens[i]);
    if (!symbol || symbol.length < 3 || NOISE.has(symbol) || seen.has(symbol)) {
      continue;
    }

    if (!/^[A-Z][A-Z0-9._-]{1,20}$/.test(symbol)) {
      continue;
    }

    let price: number | null = null;
    for (let j = i + 1; j < Math.min(tokens.length, i + 7); j += 1) {
      price = normalizePriceToken(tokens[j]);
      if (price !== null) {
        break;
      }
    }

    if (price === null) {
      continue;
    }

    seen.add(symbol);
    rows.push({ symbol, price });
  }

  return rows;
}
