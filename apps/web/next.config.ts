import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Allow up to 3 minutes for board chat — sequential chair inference
    // on lane-limited providers (Featherless cost:2 models) can take 60-90s.
    proxyTimeout: 180_000,
  },
};

export default nextConfig;
