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
  const explicit =
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.RAILWAY_BACKEND_URL;
  if (explicit) {
    return normalizeBaseUrl(explicit);
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
