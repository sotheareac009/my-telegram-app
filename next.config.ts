import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["telegram", "big-integer"],
};

export default nextConfig;
