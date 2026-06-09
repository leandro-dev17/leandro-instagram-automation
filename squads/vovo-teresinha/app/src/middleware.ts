import { NextRequest, NextResponse } from "next/server";

async function getSessionFromRequest(req: NextRequest) {
  const cookieName = process.env.COOKIE_NAME || "vovo-session";
  const token = req.cookies.get(cookieName)?.value;
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verifica assinatura HMAC-SHA256 via Web Crypto API (compatível com Edge Runtime)
    const secret = process.env.JWT_SECRET;
    if (!secret) return null; // JWT_SECRET obrigatório

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sig = Uint8Array.from(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      enc.encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return null;

    const decoded = JSON.parse(
      atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (decoded.exp && decoded.exp < Date.now() / 1000) return null;
    return decoded as { id: number; email: string; tipo_usuario: string; nome: string };
  } catch {
    return null;
  }
}

const PROTECTED_ROUTES = [
  "/receitas",
  "/favoritos",
  "/geladeira",
  "/lista-compras",
  "/personal",
  "/perfil",
  "/renda-extra",
  "/bem-vinda",
  "/alterar-senha",
  "/plano-semanal",
  "/assinar",
];

const ADMIN_ROUTES = ["/admin"];

const AUTH_ROUTES = ["/login", "/cadastro", "/esqueci-senha", "/redefinir-senha"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await getSessionFromRequest(req);

  const isProtected = PROTECTED_ROUTES.some((r) => pathname.startsWith(r));
  const isAdmin = ADMIN_ROUTES.some((r) => pathname.startsWith(r));
  const isAuth = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (isAdmin) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.tipo_usuario !== "admin") {
      return NextResponse.redirect(new URL("/receitas", req.url));
    }
    return NextResponse.next();
  }

  if (isProtected) {
    if (!session) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  if (isAuth && session) {
    return NextResponse.redirect(new URL("/receitas", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/receitas/:path*",
    "/favoritos/:path*",
    "/geladeira/:path*",
    "/lista-compras/:path*",
    "/bem-vinda/:path*",
    "/personal/:path*",
    "/perfil/:path*",
    "/renda-extra/:path*",
    "/alterar-senha",
    "/plano-semanal/:path*",
    "/assinar",
    "/onboarding/:path*",
    "/admin/:path*",
    "/login",
    "/cadastro",
    "/esqueci-senha",
    "/redefinir-senha",
  ],
};
