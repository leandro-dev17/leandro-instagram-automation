import jwt from "jsonwebtoken";
import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import type { Usuario } from "@/lib/db";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET não definida — configure o .env.local");
}
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = process.env.COOKIE_NAME || "alerta-patriota-session";

export function gerarToken(payload: { id: number; email: string; tipo: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verificarToken(token: string): { id: number; email: string; tipo: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string; tipo: string };
  } catch {
    return null;
  }
}

export async function getUsuarioLogado(): Promise<Usuario | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const payload = verificarToken(token);
    if (!payload) return null;

    const rows = await sql`SELECT * FROM usuarios WHERE id = ${payload.id} LIMIT 1`;
    return (rows[0] as Usuario) || null;
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<Usuario> {
  const usuario = await getUsuarioLogado();
  if (!usuario || usuario.tipo_usuario !== "admin") {
    throw new Error("Acesso negado");
  }
  return usuario;
}

const COOKIE_SECURE = process.env.NODE_ENV === "production" ? "; Secure" : "";

export function setCookieToken(token: string): Record<string, string> {
  return {
    "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${COOKIE_SECURE}`,
  };
}

export function clearCookie(): Record<string, string> {
  return {
    "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${COOKIE_SECURE}`,
  };
}

// Comparação em tempo constante — evita que um atacante meça a latência da resposta
// para descobrir o secret caractere por caractere (timing attack).
function compararSegredo(auth: string | null, esperado: string): boolean {
  if (!auth) return false;
  const a = Buffer.from(auth);
  const b = Buffer.from(`Bearer ${esperado}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verificarCronSecret(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // CRON_SECRET obrigatório — sem ele, bloqueia tudo
  return compararSegredo(auth, secret);
}

// FASE 21: claude-resolver e claude-revisor têm permissão de escrita no GitHub (commit
// direto na main) e de redeploy no Vercel — um blast radius muito maior que os ~60 crons
// de leitura que compartilham CRON_SECRET. Segredo próprio reduz o risco de um vazamento
// do CRON_SECRET (usado em toda chamada de cron) virar commit arbitrário no repositório.
// Faz fallback para CRON_SECRET apenas se CLAUDE_AUTOFIX_SECRET ainda não foi configurado.
export function verificarSegredoAutofix(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const dedicado = process.env.CLAUDE_AUTOFIX_SECRET;
  if (dedicado) return compararSegredo(auth, dedicado);
  return verificarCronSecret(req);
}
