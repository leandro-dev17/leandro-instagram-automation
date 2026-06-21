import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { gerarToken, setCookieToken } from "@/lib/auth";

// Rate limit simples por IP — protege contra força bruta de senha
const LIMITE_POR_JANELA = 8;
const JANELA_MS = 15 * 60_000;
const tentativasPorIp = new Map<string, number[]>();

function excedeuLimite(ip: string): boolean {
  const agora = Date.now();
  const historico = (tentativasPorIp.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  historico.push(agora);
  tentativasPorIp.set(ip, historico);
  return historico.length > LIMITE_POR_JANELA;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    if (excedeuLimite(ip)) {
      return NextResponse.json({ erro: "Muitas tentativas. Tente novamente em alguns minutos." }, { status: 429 });
    }

    const { email, senha } = await req.json();

    if (!email || !senha) {
      return NextResponse.json({ erro: "E-mail e senha são obrigatórios" }, { status: 400 });
    }

    const rows = await sql`SELECT * FROM usuarios WHERE email = ${email.toLowerCase()} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ erro: "E-mail ou senha incorretos" }, { status: 401 });
    }

    const usuario = rows[0];
    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaOk) {
      return NextResponse.json({ erro: "E-mail ou senha incorretos" }, { status: 401 });
    }

    const token = gerarToken({ id: usuario.id, email: usuario.email, tipo: usuario.tipo_usuario });

    return NextResponse.json(
      { ok: true, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, plano: usuario.plano, status: usuario.status, tipo_usuario: usuario.tipo_usuario } },
      { headers: setCookieToken(token) }
    );
  } catch (err) {
    console.error("login error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
