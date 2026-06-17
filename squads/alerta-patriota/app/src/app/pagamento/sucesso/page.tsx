"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const STEPS = [
  "Clique no botão verde acima",
  "Abra o WhatsApp e confirme a entrada",
  "Pronto! Comece a receber as notícias",
];

function WppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

function SucessoContent() {
  const params = useSearchParams();
  const [linkGrupo, setLinkGrupo] = useState("#");
  const [plano, setPlano] = useState<"vip" | "elite">("vip");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raw = params.get("plano") || localStorage.getItem("ap_plano") || "vip";
    const p: "vip" | "elite" = raw === "elite" ? "elite" : "vip";
    setPlano(p);
    localStorage.removeItem("ap_plano");
    const links: Record<string, string> = {
      vip: process.env.NEXT_PUBLIC_WPP_LINK_VIP || "#",
      elite: process.env.NEXT_PUBLIC_WPP_LINK_ELITE || "#",
    };
    setLinkGrupo(links[p] || "#");
    setMounted(true);
  }, [params]);

  const isElite = plano === "elite";
  const planoBadge = isElite ? "ELITE GLOBAL" : "VIP PREMIUM";
  const planoEmoji = isElite ? "🎖️" : "🔥";
  const personaNome = isElite ? "Prof. Bernardo Cavalcanti" : "Capitão Braga";
  const personaFrase = isElite
    ? "Bem-vindo à vanguarda do pensamento conservador. Aqui você entende o mundo antes que a mídia distorça."
    : "Bem-vindo à família, patriota. Aqui você vai ficar sabendo de tudo — sem filtro e sem censura. Deus, Pátria e Família — sempre.";

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(20px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity:0; transform:scale(0.5); }
          to   { opacity:1; transform:scale(1); }
        }
        @keyframes glowPulse {
          0%,100% { box-shadow:0 0 0 0 rgba(34,197,94,0.5), 0 8px 32px rgba(34,197,94,0.35); }
          50%      { box-shadow:0 0 0 12px rgba(34,197,94,0), 0 8px 32px rgba(34,197,94,0.5); }
        }
        .anim-badge  { animation: fadeUp 0.4s ease 0.05s both; }
        .anim-check  { animation: scaleIn 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.15s both; }
        .anim-title  { animation: fadeUp 0.45s ease 0.3s both; }
        .anim-sub    { animation: fadeUp 0.45s ease 0.4s both; }
        .anim-btn    { animation: fadeUp 0.45s ease 0.5s both; }
        .anim-steps  { animation: fadeUp 0.45s ease 0.6s both; }
        .anim-quote  { animation: fadeUp 0.45s ease 0.7s both; }
        .btn-wpp     { animation: glowPulse 2.4s ease-in-out 1.2s infinite; }
        .btn-wpp:hover { transform:translateY(-2px) scale(1.02); }
        .btn-wpp:active { transform:scale(0.97); }
        * { box-sizing:border-box; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #080d1a 0%, #0c1525 60%, #080d1a 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "52px 20px 48px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Top accent bar */}
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, height: "3px",
          background: "linear-gradient(90deg, #15803d 0%, #4ade80 50%, #15803d 100%)",
          zIndex: 100,
        }} />

        {/* Background glow */}
        <div style={{
          position: "absolute", top: "-80px", left: "50%", transform: "translateX(-50%)",
          width: "500px", height: "500px", borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(34,197,94,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* BADGE */}
        <div className="anim-badge" style={{ marginBottom: "28px" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "7px",
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: "100px",
            padding: "7px 20px",
            fontSize: "11px", fontWeight: 800, letterSpacing: "2.5px",
            color: "#4ade80", textTransform: "uppercase",
          }}>
            {planoEmoji} {planoBadge} ATIVADO
          </span>
        </div>

        {/* CHECK CIRCLE */}
        <div className="anim-check" style={{ marginBottom: "28px" }}>
          <div style={{
            width: "88px", height: "88px", borderRadius: "50%",
            background: "linear-gradient(135deg, #15803d 0%, #22c55e 100%)",
            boxShadow: "0 0 0 8px rgba(34,197,94,0.12), 0 0 48px rgba(34,197,94,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none"
              stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        {/* TITLE */}
        <div className="anim-title" style={{ textAlign: "center", marginBottom: "10px" }}>
          <h1 style={{
            fontSize: "clamp(34px, 9vw, 52px)",
            fontWeight: 900,
            color: "#f1f5f9",
            margin: 0,
            lineHeight: 1.1,
            letterSpacing: "-0.5px",
          }}>
            BEM-VINDO,{" "}
            <span style={{ color: "#4ade80" }}>PATRIOTA!</span>
          </h1>
        </div>

        {/* SUBTITLE */}
        <div className="anim-sub" style={{ textAlign: "center", marginBottom: "36px" }}>
          <p style={{
            color: "#64748b",
            fontSize: "15px",
            lineHeight: 1.65,
            maxWidth: "340px",
            margin: "0 auto",
          }}>
            Assinatura <strong style={{ color: "#94a3b8" }}>{planoBadge}</strong> ativa.
            Acesse o grupo exclusivo e comece agora.
          </p>
        </div>

        {/* CTA WHATSAPP */}
        <div className="anim-btn" style={{ width: "100%", maxWidth: "360px", marginBottom: "40px" }}>
          {mounted ? (
            <a
              href={linkGrupo}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-wpp"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                width: "100%", padding: "18px 24px",
                background: "linear-gradient(135deg, #15803d 0%, #22c55e 100%)",
                color: "white", fontWeight: 700, fontSize: "16px",
                textDecoration: "none", borderRadius: "14px",
                boxShadow: "0 8px 32px rgba(34,197,94,0.35)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
                cursor: "pointer",
              }}
            >
              <WppIcon />
              Entrar no Grupo {planoBadge}
            </a>
          ) : (
            <div style={{
              width: "100%", padding: "18px 24px",
              background: "rgba(34,197,94,0.15)", borderRadius: "14px",
              color: "#4ade80", textAlign: "center", fontWeight: 700,
            }}>
              Carregando...
            </div>
          )}
        </div>

        {/* DIVIDER */}
        <div className="anim-steps" style={{ width: "100%", maxWidth: "360px", marginBottom: "40px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px",
          }}>
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
            <span style={{ color: "#475569", fontSize: "10px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              Como entrar
            </span>
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "12px", padding: "13px 16px",
              }}>
                <span style={{
                  width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                  background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.25)",
                  color: "#4ade80", fontSize: "12px", fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {i + 1}
                </span>
                <span style={{ color: "#94a3b8", fontSize: "14px", lineHeight: 1.4 }}>{step}</span>
              </div>
            ))}
          </div>
        </div>

        {/* PERSONA QUOTE */}
        <div className="anim-quote" style={{ width: "100%", maxWidth: "360px" }}>
          <div style={{
            background: "rgba(250,204,21,0.04)",
            border: "1px solid rgba(250,204,21,0.12)",
            borderRadius: "16px", padding: "20px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ fontSize: "22px" }}>{isElite ? "🎖️" : "🎯"}</span>
              <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: "13px" }}>{personaNome}</span>
            </div>
            <p style={{
              color: "#64748b", fontSize: "13px", fontStyle: "italic",
              lineHeight: 1.65, margin: 0,
            }}>
              &ldquo;{personaFrase}&rdquo;
            </p>
          </div>
        </div>

        {/* FOOTER NOTE */}
        <p style={{
          marginTop: "32px", color: "#334155", fontSize: "12px",
          textAlign: "center", maxWidth: "280px", lineHeight: 1.5,
        }}>
          Você receberá um e-mail de boas-vindas com o link do grupo em instantes.
        </p>
      </div>
    </>
  );
}

export default function PagamentoSucessoPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#080d1a",
      }}>
        <span style={{ color: "#4ade80", fontSize: "16px", fontWeight: 700 }}>
          Ativando sua assinatura...
        </span>
      </div>
    }>
      <SucessoContent />
    </Suspense>
  );
}
