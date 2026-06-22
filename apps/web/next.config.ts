import type { NextConfig } from "next";

const backend = process.env.INTERNAL_API_BASE_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/health", destination: `${backend}/health` },
      { source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }
    ];
  }
};

export default nextConfig;
