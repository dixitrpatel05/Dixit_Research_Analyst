import { NextRequest } from "next/server";

function normalizeBaseUrl(value: string | undefined): string {
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

function getBackendBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.BACKEND_API_URL ||
      process.env.RAILWAY_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "",
  );
}

function buildError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status });
}

async function proxy(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return buildError("Backend API URL is not configured on frontend service.", 500);
  }

  const incoming = new URL(request.url);
  const upstream = new URL(baseUrl);

  // Guard against accidental self-proxy loops from misconfigured backend URL.
  if (incoming.host === upstream.host) {
    return buildError("Backend API URL points to frontend host. Set backend service URL explicitly.", 500);
  }

  const path = pathSegments.join("/");
  const upstreamUrl = `${baseUrl}/api/${path}${incoming.search}`;

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

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Upstream request failed";
    return buildError(`Unable to reach backend API: ${detail}`, 502);
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");
  responseHeaders.delete("connection");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
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
