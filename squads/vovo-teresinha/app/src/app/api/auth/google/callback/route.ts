import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { signToken, cookieOptions } from "@/lib/auth";
import { criarCheckoutMP } from "@/lib/mercadopago";
import { PLANOS, type PlanoId } from "@/lib/planos";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

type GoogleUser = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const savedState = req.cookies.get("google_oauth_state")?.value;
  const redirectAfter = req.cookies.get("google_oauth_redirect")?.value || "/receitas";
  const planoParam = req.cookies.get("google_oauth_plano")?.value;
  const plano = planoParam && PLANOS[planoParam as keyof typeof PLANOS] ? (planoParam as PlanoId) : null;
  const ref = req.cookies.get("google_oauth_ref")?.value || "";

  const clearCookies = (res: NextResponse) => {
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_oauth_redirect");
    res.cookies.delete("google_oauth_plano");
    res.cookies.delete("google_oauth_ref");
    return res;
  };

  // Erros ou state inválido
  if (error || !code || !state || state !== savedState) {
    const res = NextResponse.redirect(`${APP_URL}/login?erro=google_falhou`);
    return clearCookies(res);
  }

  try {
    // 1. Trocar code por access_token
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${APP_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const res = NextResponse.redirect(`${APP_URL}/login?erro=google_falhou`);
      return clearCookies(res);
    }

    const { access_token } = await tokenRes.json();

    // 2. Buscar informações do usuário no Google
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userRes.ok) {
      const res = NextResponse.redirect(`${APP_URL}/login?erro=google_falhou`);
      return clearCookies(res);
    }

    const googleUser: GoogleUser = await userRes.json();

    if (!googleUser.email_verified) {
      const res = NextResponse.redirect(`${APP_URL}/login?erro=email_nao_verificado`);
      return clearCookies(res);
    }

    // 3. Encontrar ou criar usuário no banco
    let usuario = null;

    // Busca por google_id primeiro
    const porGoogleId = await sql`
      SELECT id, email, nome, tipo_usuario FROM usuarios WHERE google_id = ${googleUser.sub} LIMIT 1
    `;

    if (porGoogleId.length > 0) {
      usuario = porGoogleId[0];
    } else {
      // Busca por e-mail (pode ser conta existente)
      const porEmail = await sql`
        SELECT id, email, nome, tipo_usuario FROM usuarios WHERE email = ${googleUser.email} LIMIT 1
      `;

      if (porEmail.length > 0) {
        // Vincula google_id à conta existente
        usuario = porEmail[0];
        await sql`UPDATE usuarios SET google_id = ${googleUser.sub} WHERE id = ${usuario.id}`;
      } else {
        // Conta nova: nunca cria acesso sem plano escolhido e sem pagamento.
        // Sem plano na sessão do OAuth, manda escolher antes de criar qualquer conta.
        if (!plano) {
          const res = NextResponse.redirect(`${APP_URL}/cadastro?erro=escolha_plano`);
          return clearCookies(res);
        }

        const novoUsuario = await sql`
          INSERT INTO usuarios (email, nome, tipo_usuario, google_id, aceita_whatsapp)
          VALUES (${googleUser.email}, ${googleUser.name}, 'free', ${googleUser.sub}, false)
          RETURNING id, email, nome, tipo_usuario
        `;

        usuario = novoUsuario[0];
      }
    }

    // 4. Gerar JWT e definir cookie
    const token = signToken({
      id: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      tipo_usuario: usuario.tipo_usuario,
    });

    // Usuário sem assinatura ativa (novo ou que ficou "free" de uma tentativa anterior que falhou
    // no checkout): redireciona direto pro checkout do Mercado Pago, nunca pro app.
    let destino = `${APP_URL}${redirectAfter}`;
    if (plano && usuario.tipo_usuario === "free") {
      try {
        destino = await criarCheckoutMP(usuario.id, usuario.email, plano, ref);
      } catch (err) {
        console.error("google/callback: erro ao criar checkout MP", err);
        const res = NextResponse.redirect(`${APP_URL}/cadastro?erro=checkout_falhou`);
        return clearCookies(res);
      }
    }

    const opts = cookieOptions();
    const res = NextResponse.redirect(destino);

    res.cookies.set(opts.name, token, {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      maxAge: opts.maxAge,
      path: opts.path,
    });

    return clearCookies(res);
  } catch (err) {
    console.error("google/callback error", err);
    const res = NextResponse.redirect(`${APP_URL}/login?erro=google_falhou`);
    return clearCookies(res);
  }
}
