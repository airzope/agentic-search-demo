import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native addons: load with Node's require instead of bundling.
  serverExternalPackages: ["node-llama-cpp", "@firecrawl/anydoc"],
};

export default nextConfig;
