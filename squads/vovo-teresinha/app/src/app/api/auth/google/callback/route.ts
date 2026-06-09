import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { signToken, cookieOptions } from "@/lib/auth";
import { enviarEmailBoasVindas } from "@/lib/brevo";

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

  const clearCookies = (res: NextResponse) => {
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_oauth_redirect");
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
    let isNovo = false;

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
        // Cria novo usuário
        const trial_fim = new Date();
        trial_fim.setDate(trial_fim.getDate() + 7);

        const novoUsuario = await sql`
          INSERT INTO usuarios (email, nome, tipo_usuario, google_id, trial_inicio, trial_fim, aceita_whatsapp)
          VALUES (${googleUser.email}, ${googleUser.name}, 'free', ${googleUser.sub}, NOW(), ${trial_fim.toISOString()}, false)
          RETURNING id, email, nome, tipo_usuario
        `;

        usuario = novoUsuario[0];
        isNovo = true;

        // Envia e-mail de boas-vindas em background
        enviarEmailBoasVindas(usuario.email, usuario.nome).catch(() => {});
      }
    }

    // 4. Gerar JWT e definir cookie
    const token = signToken({
      id: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      tipo_usuario: usuario.tipo_usuario,
    });

    const opts = cookieOptions();
    const destino = isNovo ? `${APP_URL}/onboarding` : `${APP_URL}${redirectAfter}`;
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
