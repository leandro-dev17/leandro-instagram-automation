import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { allowedOrigins: ["*"] } },
  typescript: { ignoreBuildErrors: true },
  turbopack: {},
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
