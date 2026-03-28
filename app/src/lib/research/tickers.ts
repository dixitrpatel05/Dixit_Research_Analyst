const VALID_SYMBOL = /^[A-Z0-9._-]+$/;

function normalizeOne(raw: string): string | null {
  const candidate = raw.trim().toUpperCase();
  if (!candidate) {
    return null;
  }

  if (candidate.includes(":")) {
    const [exchange, symbol] = candidate.split(":");
    if (!symbol || !VALID_SYMBOL.test(symbol)) {
      return null;
    }

    if (exchange === "NSE") {
      return symbol.endsWith(".NS") ? symbol : `${symbol}.NS`;
    }

    if (exchange === "BSE") {
      return symbol.endsWith(".BO") ? symbol : `${symbol}.BO`;
    }

    return null;
  }

  if (!VALID_SYMBOL.test(candidate)) {
    return null;
  }

  if (candidate.endsWith(".NS") || candidate.endsWith(".BO")) {
    return candidate;
  }

  if (/^[0-9]{6}$/.test(candidate)) {
    return `${candidate}.BO`;
  }

  return `${candidate}.NS`;
}

export function normalizeTradingViewTickers(input: string[]): string[] {
  const normalized = new Set<string>();

  for (const item of input) {
    const value = normalizeOne(item);
    if (value) {
      normalized.add(value);
    }
  }

  return [...normalized];
}
