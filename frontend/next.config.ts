import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The in-app data-check notice is the only persistent indicator. Build and runtime
  // errors still open the dev overlay; this only hides Next's corner badge.
  devIndicators: false,
  async rewrites() {
    const backend = process.env.API_PROXY_TARGET || "http://127.0.0.1:8000";
    return [
      { source: "/v1/:path*", destination: `${backend}/v1/:path*` },
      { source: "/health-api", destination: `${backend}/health` },
    ];
  },
};

export default nextConfig;
