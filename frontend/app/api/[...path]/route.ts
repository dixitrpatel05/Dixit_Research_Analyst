import { NextRequest } from "next/server";

function normalizeBaseUrl(value: string | undefined): string {
  if (!value || !value.trim()) {
    return "";
  }

  const raw = value.trim().replace(/^['\"]|['\"]$/g, "").replace(/\/$/, "");
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("localhost") || raw.startsWith("127.0.0.1")) {
    return `http://${raw}`;
  }

  return `https://${raw}`;
}

function getBackendBaseUrls(): string[] {
  const rawValues = [
    process.env.BACKEND_API_URL,
    process.env.RAILWAY_BACKEND_URL,
    process.env.NEXT_PUBLIC_API_URL,
  ];

  const out: string[] = [];
  for (const value of rawValues) {
    if (!value) continue;
    const parts = value.split(/[\s,;]+/).filter(Boolean);
    for (const part of parts) {
      const normalized = normalizeBaseUrl(part);
      if (normalized && !out.includes(normalized)) {
        out.push(normalized);
      }
    }
  }
  return out;
}

function buildError(
  message: string,
  status = 500,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(extraHeaders || {});
  return Response.json({ error: message }, { status, headers });
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const candidates = getBackendBaseUrls();
  if (!candidates.length) {
    return buildError("Backend API URL is not configured on frontend service.", 500, {
      "x-proxy-error": "missing-backend-url",
    });
  }

  const incoming = new URL(request.url);

  const path = pathSegments.join("/");

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = request.body;
    (init as RequestInit & { duplex?: "half" }).duplex = "half";
  }

  const tried: string[] = [];
  let lastNetworkError = "";

  for (const baseUrl of candidates) {
    let upstream: URL;
    try {
      upstream = new URL(baseUrl);
    } catch {
      continue;
    }

    // Guard against accidental self-proxy loops from misconfigured backend URL.
    if (incoming.host === upstream.host) {
      continue;
    }

    const upstreamUrl = `${baseUrl}/api/${path}${incoming.search}`;
    tried.push(upstream.host);

    try {
      const upstreamResponse = await fetch(upstreamUrl, init);

      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("transfer-encoding");
      responseHeaders.delete("connection");
      responseHeaders.set("x-proxy-target", upstream.host);

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      lastNetworkError = error instanceof Error ? error.message : "Upstream request failed";
      continue;
    }
  }

  if (!tried.length) {
    return buildError("Backend API URL points to frontend host. Set backend service URL explicitly.", 500, {
      "x-proxy-error": "self-proxy-blocked",
    });
  }

  return buildError(`Unable to reach backend API: ${lastNetworkError || "network error"}`, 502, {
    "x-proxy-error": "upstream-unreachable",
    "x-proxy-tried": tried.join(","),
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handler(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path || []);
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  return handler(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handler(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handler(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handler(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handler(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return handler(request, context);
}
