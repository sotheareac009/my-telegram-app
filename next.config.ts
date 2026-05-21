import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["telegram", "big-integer", "archiver"],
  experimental: {
    // Lift the default 1 MB body cap so chat media uploads aren't rejected
    // with HTTP 413. (Documented for Server Actions; route-handler bodies are
    // additionally bounded only by whatever reverse proxy sits in front.)
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  allowedDevOrigins: [
    "vstore-center.com",
    "my-telegram-local.com",
    "tigram.com",
  ],
};

export default nextConfig;
