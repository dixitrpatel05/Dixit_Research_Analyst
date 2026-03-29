const STOPWORDS = new Set([
  "SYMBOL",
  "LAST",
  "WATCHLIST",
  "NSE",
  "BSE",
  "BUY",
  "SELL",
  "HOLD",
  "OPEN",
  "HIGH",
  "LOW",
  "VOLUME",
  "PRICE",
]);

function normalizeSymbol(token: string): string {
  return (token || "")
    .toUpperCase()
    .replace(/^NSE:/, "")
    .replace(/^BSE:/, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function isLikelySymbol(token: string): boolean {
  if (!token || token.length < 2 || token.length > 10) return false;
  if (STOPWORDS.has(token)) return false;
  if (/^\d+$/.test(token)) return false;
  return /^[A-Z][A-Z0-9]{1,9}$/.test(token);
}

function extractSymbolsFromText(text: string): string[] {
  const matches = (text || "").toUpperCase().match(/[A-Z][A-Z0-9:]{1,12}/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const sym = normalizeSymbol(raw);
    if (isLikelySymbol(sym) && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }

  return out;
}

export async function extractSymbolsFromImageClient(file: File): Promise<string[]> {
  const mod = await import("tesseract.js");
  const result = await mod.recognize(file, "eng", {
    logger: () => {
      // Keep silent in UI to avoid noisy console logs.
    },
  });

  const text = result?.data?.text || "";
  return extractSymbolsFromText(text);
}
