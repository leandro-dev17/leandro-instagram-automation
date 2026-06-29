import type { NextConfig } from "next";

// Fase 34 (backlog seg/infra, item 3): confirmado via grep que o app não carrega script/iframe
// externo nenhum (checkout do Mercado Pago é só PIX/PreApproval via API server-side, sem SDK/Brick
// no client) — a única dependência externa real é a fonte do Google usada em admin/layout.tsx
// (@import direto de fonts.googleapis.com, não é o next/font embutido). 'unsafe-inline' em
// script/style é necessário porque o projeto não usa nonce (Next.js injeta script de hydration
// inline, e o layout do admin usa um <style> inline) — ainda bloqueia qualquer <script src>
// de domínio externo, que é o vetor real de XSS/supply-chain que esta CSP existe para fechar.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

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
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
