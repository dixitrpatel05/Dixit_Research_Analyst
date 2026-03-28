function normalizeBaseUrl(value) {
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

function detectBackendBaseUrl() {
  const direct =
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.RAILWAY_BACKEND_URL;
  if (direct) {
    return normalizeBaseUrl(direct);
  }

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
  if (railwayDomain) {
    return normalizeBaseUrl(railwayDomain);
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:8000";
  }

  return "";
}

const backendBaseUrl = detectBackendBaseUrl();

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (!backendBaseUrl) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${backendBaseUrl.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
