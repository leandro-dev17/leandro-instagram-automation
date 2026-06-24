import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { gerarToken, setCookieToken } from "@/lib/auth";

// Rate limit simples por IP — evita spam de contas trial
const LIMITE_POR_JANELA = 5;
const JANELA_MS = 10 * 60_000;
const cadastrosPorIp = new Map<string, number[]>();

function excedeuLimite(ip: string): boolean {
  const agora = Date.now();
  const historico = (cadastrosPorIp.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  historico.push(agora);
  cadastrosPorIp.set(ip, historico);
  return historico.length > LIMITE_POR_JANELA;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    if (excedeuLimite(ip)) {
      return NextResponse.json({ erro: "Muitas tentativas. Tente novamente em alguns minutos." }, { status: 429 });
    }

    const { nome, email, senha, telefone, aceitaTermos } = await req.json();

    if (!nome || !email || !senha) {
      return NextResponse.json({ erro: "Nome, e-mail e senha são obrigatórios" }, { status: 400 });
    }
    // LGPD: cadastro sem aceite explícito dos termos/política de privacidade não tem base
    // legal para tratamento dos dados — bloqueado no backend, não só na UI.
    if (aceitaTermos !== true) {
      return NextResponse.json({ erro: "É necessário aceitar os Termos de Uso e a Política de Privacidade" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ erro: "E-mail inválido" }, { status: 400 });
    }
    if (senha.length < 6) {
      return NextResponse.json({ erro: "Senha deve ter no mínimo 6 caracteres" }, { status: 400 });
    }

    // FASE 23: checava o e-mail com a capitalização exata enviada pelo cliente, mas o
    // INSERT abaixo sempre normaliza para minúsculas — "Foo@Bar.com" passava aqui mesmo já
    // existindo como "foo@bar.com", e o INSERT então quebrava com erro de UNIQUE constraint
    // não tratado (500 genérico) em vez do 409 "E-mail já cadastrado".
    const existe = await sql`SELECT id FROM usuarios WHERE email = ${email.toLowerCase()} LIMIT 1`;
    if (existe.length > 0) {
      return NextResponse.json({ erro: "E-mail já cadastrado" }, { status: 409 });
    }

    const senha_hash = await bcrypt.hash(senha, 10);
    const trialFim = new Date();
    trialFim.setDate(trialFim.getDate() + 7);

    const rows = await sql`
      INSERT INTO usuarios (nome, email, senha_hash, telefone, status, trial_inicio, trial_fim, aceite_termos_em, aceite_termos_ip)
      VALUES (${nome}, ${email.toLowerCase()}, ${senha_hash}, ${telefone || null}, 'trial', NOW(), ${trialFim.toISOString()}, NOW(), ${ip})
      RETURNING id, nome, email, tipo_usuario, status, plano
    `;

    const usuario = rows[0];
    const token = gerarToken({ id: usuario.id, email: usuario.email, tipo: usuario.tipo_usuario });

    return NextResponse.json({ ok: true, usuario }, { headers: setCookieToken(token) });
  } catch (err) {
    console.error("cadastro error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
