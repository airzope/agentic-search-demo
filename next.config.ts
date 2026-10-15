import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native addons and runtime-loaded models/SDKs: load with Node's require
  // instead of bundling.
  serverExternalPackages: [
    "node-llama-cpp",
    "@firecrawl/anydoc",
    "ppu-paddle-ocr",
    "ppu-ocv",
    "onnxruntime-node",
    "@napi-rs/canvas",
    "pdfjs-dist",
    "utif2",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "@osdk/client",
    "@osdk/oauth",
    "@osdk/foundry.ontologies",
  ],
};

export default nextConfig;
