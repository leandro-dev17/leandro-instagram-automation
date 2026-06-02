import { notFound } from "next/navigation";
import { sql } from "@/lib/db";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function NoticiaCompartilhadaPage({ params }: PageProps) {
  const { token } = await params;

  const rows = await sql`
    SELECT
      lc.id as link_id,
      lc.token,
      n.id as noticia_id,
      n.titulo,
      n.fonte,
      n.url as noticia_url,
      n.resumo_braga,
      n.urgente,
      n.created_at
    FROM links_compartilhamento lc
    JOIN noticias n ON n.id = lc.noticia_id
    WHERE lc.token = ${token}
    LIMIT 1
  `;

  if (rows.length === 0) {
    notFound();
  }

  const noticia = rows[0] as {
    link_id: string;
    token: string;
    noticia_id: string;
    titulo: string;
    fonte: string;
    noticia_url: string | null;
    resumo_braga: string | null;
    urgente: boolean;
    created_at: string;
  };

  await sql`
    UPDATE links_compartilhamento
    SET cliques = cliques + 1
    WHERE token = ${token}
  `;

  const dataFormatada = new Date(noticia.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const paragrafos = (noticia.resumo_braga || "")
    .split(/\n+/)
    .filter((p) => p.trim().length > 0);

  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{noticia.titulo} — Alerta Patriota</title>
        <meta name="description" content={paragrafos[0] || noticia.titulo} />
        <meta property="og:title" content={noticia.titulo} />
        <meta property="og:description" content={paragrafos[0] || ""} />
        <meta property="og:site_name" content="Alerta Patriota" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#0d0d1a", color: "#e8e8e8", fontFamily: "Georgia, serif" }}>
        {/* Header */}
        <header style={{ backgroundColor: "#0a0a15", borderBottom: "2px solid #ffd700", padding: "16px 24px", textAlign: "center" }}>
          <span style={{ fontSize: "22px", fontWeight: "bold", color: "#ffd700", fontFamily: "Arial, sans-serif", letterSpacing: "2px" }}>
            ⚡ ALERTA PATRIOTA
          </span>
          {noticia.urgente && (
            <div style={{ marginTop: "8px" }}>
              <span style={{ backgroundColor: "#c0392b", color: "#fff", fontSize: "11px", fontWeight: "bold", padding: "3px 10px", borderRadius: "2px", letterSpacing: "1px" }}>
                URGENTE
              </span>
            </div>
          )}
        </header>

        {/* Conteúdo */}
        <main style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 24px" }}>
          {/* Meta */}
          <div style={{ marginBottom: "24px" }}>
            <span style={{ color: "#ffd700", fontSize: "13px", fontFamily: "Arial, sans-serif", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px" }}>
              {noticia.fonte}
            </span>
            <span style={{ color: "#555", margin: "0 8px" }}>·</span>
            <span style={{ color: "#666", fontSize: "13px", fontFamily: "Arial, sans-serif" }}>{dataFormatada}</span>
          </div>

          {/* Título */}
          <h1 style={{ color: "#f0f0f0", fontSize: "28px", lineHeight: "1.3", margin: "0 0 32px", fontFamily: "Georgia, serif", fontWeight: "bold" }}>
            {noticia.titulo}
          </h1>

          {/* Linha divisória */}
          <div style={{ borderTop: "1px solid #2a2a3e", marginBottom: "32px" }} />

          {/* Análise */}
          <div style={{ marginBottom: "32px" }}>
            <p style={{ color: "#ffd700", fontSize: "12px", fontWeight: "bold", letterSpacing: "2px", fontFamily: "Arial, sans-serif", marginBottom: "16px" }}>
              ANÁLISE DO CAPITÃO BRAGA
            </p>
            {paragrafos.length > 0 ? (
              paragrafos.map((p, i) => (
                <p key={i} style={{ color: "#d0d0d0", fontSize: "17px", lineHeight: "1.8", margin: "0 0 20px" }}>
                  {p}
                </p>
              ))
            ) : (
              <p style={{ color: "#666", fontSize: "17px", lineHeight: "1.8" }}>Análise disponível para membros.</p>
            )}
          </div>

          {noticia.noticia_url && (
            <div style={{ marginBottom: "32px" }}>
              <a
                href={noticia.noticia_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#ffd700", fontSize: "13px", fontFamily: "Arial, sans-serif" }}
              >
                → Ver notícia original
              </a>
            </div>
          )}

          {/* Paywall CTA */}
          <div style={{ backgroundColor: "#12122a", border: "2px solid #ffd700", borderRadius: "8px", padding: "32px", textAlign: "center", marginTop: "40px" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔒</div>
            <h2 style={{ color: "#ffd700", fontSize: "20px", fontFamily: "Arial, sans-serif", margin: "0 0 12px", fontWeight: "bold" }}>
              Quer receber análises como essa?
            </h2>
            <p style={{ color: "#b0b0b0", fontSize: "15px", margin: "0 0 8px", lineHeight: "1.5" }}>
              3 notícias políticas por dia, direto no WhatsApp.
            </p>
            <p style={{ color: "#b0b0b0", fontSize: "15px", margin: "0 0 28px", lineHeight: "1.5" }}>
              A partir de <strong style={{ color: "#ffd700" }}>R$12,90/mês</strong> — experimente por <strong style={{ color: "#ffd700" }}>R$1 por 7 dias</strong>.
            </p>
            <a
              href={`${APP_URL}/assinar?utm_source=compartilhamento&utm_content=${token}`}
              style={{
                display: "inline-block",
                backgroundColor: "#c0392b",
                color: "#fff",
                padding: "16px 40px",
                textDecoration: "none",
                fontSize: "16px",
                fontWeight: "bold",
                borderRadius: "4px",
                fontFamily: "Arial, sans-serif",
                letterSpacing: "0.5px",
              }}
            >
              COMEÇAR AGORA →
            </a>
            <p style={{ color: "#444", fontSize: "12px", marginTop: "16px", fontFamily: "Arial, sans-serif" }}>
              Cancele quando quiser. Sem fidelidade.
            </p>
          </div>
        </main>

        {/* Footer */}
        <footer style={{ borderTop: "1px solid #1a1a2e", padding: "24px", textAlign: "center", marginTop: "40px" }}>
          <p style={{ color: "#333", fontSize: "12px", fontFamily: "Arial, sans-serif", margin: 0 }}>
            © 2024 Alerta Patriota — Curadoria política conservadora brasileira
          </p>
        </footer>
      </body>
    </html>
  );
}
