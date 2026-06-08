import { NextRequest, NextResponse } from "next/server";

// Middleware leve — sem imports de Node.js incompatíveis com Edge Runtime
// A verificação real de JWT acontece nas API routes e pages via requireAdmin()

const COOKIE_NAME = process.env.COOKIE_NAME || "alerta-patriota-session";

// Rotas que não precisam de cookie
const ROTAS_PUBLICAS = [
  "/",
  "/assinar",
  "/login",
  "/cadastro",
  "/pagamento",
  "/teste",
  "/elite",
  "/api/auth",
  "/api/webhook",
  // "/api/admin/setup", -- removido: setup agora requer autenticação admin
  "/api/assinaturas",
];

function ehRotaPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(r + "/") || pathname.startsWith(r + "?"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Permite rotas públicas sem verificação
  if (ehRotaPublica(pathname)) {
    return NextResponse.next();
  }

  // Rotas admin — verifica apenas se o cookie existe (a verificação JWT real ocorre na API)
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|\\.png|\\.jpg|\\.jpeg|\\.svg|\\.webp|\\.ico).*)",
  ],
};
