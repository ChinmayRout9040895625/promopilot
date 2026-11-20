import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin the workspace root so Next does not pick up lockfiles from parent folders.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
