import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["telegram", "big-integer"],
  allowedDevOrigins: ["vstore-center.com", "my-telegram-local.com"],
};

export default nextConfig;
