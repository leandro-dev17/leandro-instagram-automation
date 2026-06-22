import { sql } from "@/lib/db";
import { notFound } from "next/navigation";

type Props = { params: { id: string } };

export async function generateMetadata({ params }: Props) {
  try {
    const rows = await sql`SELECT titulo FROM noticias WHERE id = ${params.id} LIMIT 1`;
    if (!rows.length) return { title: "Alerta Patriota" };
    return {
      title: `${rows[0].titulo} — Alerta Patriota`,
      description: "Leia a análise completa do Capitão Braga. Sem filtro, sem censura.",
      openGraph: {
        title: rows[0].titulo,
        description: "Análise exclusiva do Capitão Braga — Alerta Patriota",
        images: ["/logo.png"],
      },
    };
  } catch { return { title: "Alerta Patriota" }; }
}

export default async function NoticiaPage({ params }: Props) {
  let noticia: Record<string, string> | null = null;
  try {
    const rows = await sql`
      SELECT id, titulo, fonte, url, resumo_braga, urgente, created_at
      FROM noticias WHERE id = ${params.id} LIMIT 1
    `;
    if (rows.length) noticia = rows[0] as Record<string, string>;
  } catch { notFound(); }

  if (!noticia) notFound();

  // Teaser: apenas as 2 primeiras frases do resumo
  const resumoCompleto = noticia.resumo_braga || "";
  const frases = resumoCompleto.split(/(?<=[.!?])\s+/);
  const teaser = frases.slice(0, 2).join(" ");
  const temMais = frases.length > 2;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
  const dataFormatada = new Date(noticia.created_at).toLocaleDateString("pt-BR", {
    day: "numeric", month: "long", year: "numeric"
  });

  return (
    <>
      <style>{`
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        body { background:#0a0a14; color:#fff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
        a { color:#ffd700; }
      `}</style>

      <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#12080a,#0a0a14)" }}>

        {/* Header */}
        <div style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"14px 20px", display:"flex", alignItems:"center", gap:12 }}>
          <img src="/logo.png" alt="Logo" style={{ width:36, height:36, borderRadius:"50%", border:"1.5px solid #ffd700", objectFit:"cover" }} />
          <div>
            <p style={{ fontWeight:900, fontSize:14, color:"#ffd700" }}>ALERTA PATRIOTA</p>
            <p style={{ fontSize:10, color:"#444" }}>Sem filtro · Sem censura</p>
          </div>
        </div>

        <div style={{ maxWidth:680, margin:"0 auto", padding:"32px 20px 60px" }}>

          {/* Badge urgente */}
          {noticia.urgente === "true" && (
            <span style={{ display:"inline-block", background:"#7f1d1d", color:"#fca5a5", fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:999, marginBottom:16, letterSpacing:1 }}>
              🚨 URGENTE
            </span>
          )}

          {/* Fonte e data */}
          <p style={{ fontSize:12, color:"#444", marginBottom:10 }}>
            {noticia.fonte} · {dataFormatada}
          </p>

          {/* Título */}
          <h1 style={{ fontSize:"clamp(22px,5vw,32px)", fontWeight:900, lineHeight:1.25, marginBottom:24, color:"#fff" }}>
            {noticia.titulo}
          </h1>

          {/* Capitão Braga */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, padding:"12px 14px", background:"rgba(255,215,0,0.06)", borderRadius:10, border:"1px solid rgba(255,215,0,0.15)" }}>
            <img src="/capitao-braga.png" alt="Capitão Braga" style={{ width:40, height:40, borderRadius:"50%", objectFit:"cover", objectPosition:"top", flexShrink:0 }} />
            <div>
              <p style={{ fontSize:12, fontWeight:700, color:"#ffd700" }}>Capitão Roberto Braga</p>
              <p style={{ fontSize:10, color:"#555" }}>Ex-militar · Análise exclusiva</p>
            </div>
          </div>

          {/* Análise — teaser */}
          <div style={{ fontSize:16, lineHeight:1.8, color:"#ccc", marginBottom:temMais ? 0 : 32 }}>
            <p>{teaser}</p>
          </div>

          {/* Paywall */}
          {temMais && (
            <div style={{ marginTop:24 }}>
              {/* Gradiente de fade */}
              <div style={{ height:60, background:"linear-gradient(to bottom, transparent, #0a0a14)", marginBottom:0, pointerEvents:"none" }} />

              {/* Bloqueio */}
              <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"28px 24px", textAlign:"center", backdropFilter:"blur(10px)" }}>
                <div style={{ fontSize:32, marginBottom:12 }}>🔒</div>
                <h2 style={{ fontSize:18, fontWeight:900, marginBottom:8, color:"#fff" }}>
                  Análise completa no grupo VIP
                </h2>
                <p style={{ fontSize:14, color:"#666", marginBottom:24, lineHeight:1.6 }}>
                  O Capitão Braga tem muito mais a dizer sobre isso.<br />
                  Entre no grupo e receba análises assim 3x por dia.
                </p>

                <a href={`${appUrl}/assinar`} style={{
                  display:"block", background:"linear-gradient(90deg,#ffd700,#ff9500)", color:"#0a0a14",
                  fontWeight:900, fontSize:16, padding:"14px 20px", borderRadius:12, textDecoration:"none",
                  marginBottom:10,
                }}>
                  📲 Entrar por R$1
                </a>

                <p style={{ fontSize:11, color:"#333" }}>
                  Primeiros 7 dias por R$1 · Cancele quando quiser
                </p>

                <div style={{ display:"flex", justifyContent:"center", gap:24, marginTop:20, flexWrap:"wrap" }}>
                  {[
                    { emoji:"🇧🇷", label:"Básico", preco:"R$12,90/mês" },
                    { emoji:"⚡", label:"Patriota", preco:"R$29,90/mês" },
                    { emoji:"🔥", label:"VIP", preco:"R$59,90/mês" },
                  ].map(p => (
                    <a key={p.label} href={`${appUrl}/assinar?plano=${p.label.toLowerCase()}`} style={{ textDecoration:"none" }}>
                      <div style={{ textAlign:"center" }}>
                        <span style={{ fontSize:20 }}>{p.emoji}</span>
                        <p style={{ fontSize:11, color:"#ffd700", fontWeight:700 }}>{p.label}</p>
                        <p style={{ fontSize:10, color:"#444" }}>{p.preco}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Link original */}
          {noticia.url && (
            <p style={{ marginTop:24, fontSize:12, color:"#333", textAlign:"center" }}>
              Fonte original: <a href={noticia.url} target="_blank" rel="noopener noreferrer">{noticia.fonte}</a>
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"16px 20px", textAlign:"center" }}>
          <p style={{ fontSize:11, color:"#222", fontStyle:"italic" }}>"Deus, Pátria e Família — sempre." — Capitão Braga</p>
        </div>
      </div>
    </>
  );
}
