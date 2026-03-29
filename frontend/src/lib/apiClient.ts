function normalizeBaseUrl(value: string | undefined | null): string {
  if (!value || !value.trim()) {
    return "";
  }

  const raw = value.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("localhost") || raw.startsWith("127.0.0.1")) {
    return `http://${raw}`;
  }

  return `https://${raw}`;
}

function apiCandidates(path: string): string[] {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const candidates: string[] = [`/api${safePath}`];

  const publicBase = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_API_URL || "",
  );
  if (publicBase) {
    candidates.push(`${publicBase}/api${safePath}`);
  }

  return Array.from(new Set(candidates));
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const candidates = apiCandidates(path);
  let fallbackResponse: Response | null = null;
  let lastError: unknown = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const url = candidates[i];
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response;
      }

      if (!fallbackResponse) {
        fallbackResponse = response;
      }

      const shouldRetry = i < candidates.length - 1 && [404, 502, 503, 504].includes(response.status);
      if (!shouldRetry) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (i === candidates.length - 1) {
        break;
      }
    }
  }

  if (fallbackResponse) {
    return fallbackResponse;
  }

  throw lastError instanceof Error ? lastError : new Error("API request failed");
}
