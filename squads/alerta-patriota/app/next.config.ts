import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { allowedOrigins: ["alertapatriota.vercel.app"] } },
  typescript: { ignoreBuildErrors: true },
  turbopack: {},
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
