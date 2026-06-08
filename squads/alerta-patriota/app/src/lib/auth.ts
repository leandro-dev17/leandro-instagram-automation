import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import type { Usuario } from "@/lib/db";

const JWT_SECRET = process.env.JWT_SECRET || "alerta-patriota-secret";
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

export function setCookieToken(token: string): Record<string, string> {
  return {
    "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
  };
}

export function clearCookie(): Record<string, string> {
  return {
    "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  };
}

export function verificarCronSecret(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // CRON_SECRET obrigatório — sem ele, bloqueia tudo
  return auth === `Bearer ${secret}`;
}
