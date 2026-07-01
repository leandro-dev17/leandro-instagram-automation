import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { gerarToken } from "@/lib/auth";

async function fazerLogin(formData: FormData) {
  "use server";
  const email = formData.get("email") as string;
  const senha = formData.get("senha") as string;
  if (!email || !senha) return;

  // Rate limit: 5 tentativas por IP em 10 minutos (reutiliza assinaturas_rate_limit).
  // Falha silenciosa — mesmo comportamento de credencial errada, sem revelar ao atacante.
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  const tentativas = await sql`
    SELECT COUNT(*)::int AS total FROM assinaturas_rate_limit
    WHERE ip = ${ip} AND rota = 'login' AND created_at > NOW() - INTERVAL '10 minutes'
  `.catch(() => [{ total: 0 }]);
  await sql`INSERT INTO assinaturas_rate_limit (ip, rota) VALUES (${ip}, 'login')`.catch(() => {});
  if ((tentativas[0]?.total ?? 0) >= 5) return;

  try {
    const rows = await sql`SELECT * FROM usuarios WHERE email = ${email.toLowerCase()} LIMIT 1`;
    if (rows.length === 0) {
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('lisa-login', 'tentativa_login', 'erro', ${JSON.stringify({ ip, motivo: "email_nao_encontrado" })})`.catch(() => {});
      return;
    }
    const usuario = rows[0];
    const ok = await bcrypt.compare(senha, usuario.senha_hash);
    if (!ok || usuario.tipo_usuario !== "admin") {
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('lisa-login', 'tentativa_login', 'erro', ${JSON.stringify({ ip, motivo: ok ? "nao_e_admin" : "senha_incorreta" })})`.catch(() => {});
      return;
    }
    const token = gerarToken({ id: usuario.id, email: usuario.email, tipo: usuario.tipo_usuario });
    const cookieName = process.env.COOKIE_NAME || "alerta-patriota-session";
    const cookieStore = await cookies();
    cookieStore.set(cookieName, token, { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60, path: "/" });
  } catch { return; }
  redirect("/admin");
}

export default function LoginPage() {
  return (
    <div style={{ minHeight:"100vh", background:"#0a0a14", display:"flex", alignItems:"center", justifyContent:"center", padding:"20px" }}>
      <style>{`
        input { width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:11px 14px; color:#fff; font-size:14px; outline:none; font-family:inherit; box-sizing:border-box; }
        input:focus { border-color:rgba(255,215,0,0.5); }
        .login-btn { width:100%; background:#ffd700; color:#0a0a14; font-weight:900; font-size:15px; padding:13px; border-radius:10px; border:none; cursor:pointer; font-family:inherit; }
        .login-btn:hover { background:#ffe033; }
      `}</style>
      <div style={{ width:"100%", maxWidth:"380px" }}>
        <div style={{ textAlign:"center", marginBottom:"28px" }}>
          <img src="/logo.png" alt="Alerta Patriota" style={{ width:"72px", height:"72px", borderRadius:"50%", border:"2px solid #ffd700", objectFit:"cover" }} />
          <h1 style={{ color:"#ffd700", fontSize:"18px", fontWeight:900, marginTop:"10px", letterSpacing:"1px" }}>ALERTA PATRIOTA</h1>
          <p style={{ color:"#444", fontSize:"11px", marginTop:"3px" }}>Painel Administrativo</p>
        </div>
        <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"16px", padding:"28px" }}>
          <form action={fazerLogin}>
            <div style={{ marginBottom:"14px" }}>
              <label style={{ display:"block", color:"#555", fontSize:"11px", marginBottom:"6px", textTransform:"uppercase", letterSpacing:".8px" }}>E-mail</label>
              <input type="email" name="email" required autoComplete="email" />
            </div>
            <div style={{ marginBottom:"20px" }}>
              <label style={{ display:"block", color:"#555", fontSize:"11px", marginBottom:"6px", textTransform:"uppercase", letterSpacing:".8px" }}>Senha</label>
              <input type="password" name="senha" required autoComplete="current-password" />
            </div>
            <button type="submit" className="login-btn">Entrar</button>
          </form>
        </div>
      </div>
    </div>
  );
}
