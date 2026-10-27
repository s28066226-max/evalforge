import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Files read at runtime with fs, which the bundler can't see: the published results and the
  // arena's retrieval corpus.
  outputFileTracingIncludes: {
    "/*": ["./data/published.json"],
    "/api/arena": ["./datasets/northwind/**/*"],
  },
};

export default nextConfig;
