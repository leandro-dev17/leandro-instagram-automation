"use client";

import { useState, useEffect } from "react";

const CUPONS_VALIDOS: Record<string, number> = {
  VOLTA10: 0.10,
  VOLTA15: 0.15,
  VOLTA20: 0.20,
};

const PLANOS = [
  {
    id: "vip",
    nome: "VIP Premium",
    preco: 9.90,
    precoAnual: 99,
    cor: "#c0392b",
    destaque: false,
    beneficios: ["7 alertas/dia direto no WhatsApp", "Capitão Braga analisa cada notícia", "Alertas urgentes de deputados"],
  },
  {
    id: "elite",
    nome: "Elite Global",
    preco: 19.90,
    precoAnual: 199,
    cor: "#7c3aed",
    destaque: true,
    beneficios: ["8 análises/dia (Brasil + Internacional)", "Prof. Cavalcanti + Dossiê Semanal PDF", "Radar Econômico diário"],
  },
];

export default function AssinarPage() {
  const [ciclo, setCiclo] = useState<"mensal" | "anual">("mensal");
  const [cupom, setCupom] = useState<string | undefined>();
  const [gate, setGate] = useState<string | null>(null); // planoId
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [pix, setPix] = useState<{ qr_code: string; qr_code_base64: string; valor: number } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = p.get("cupom");
    if (c) setCupom(c.toUpperCase());
    if (p.get("ciclo") === "anual") setCiclo("anual");
  }, []);

  function precoFinal(plano: typeof PLANOS[0]) {
    const base = ciclo === "anual" ? plano.precoAnual : plano.preco;
    if (ciclo === "anual" && plano.id === "elite" && cupom && CUPONS_VALIDOS[cupom]) {
      return Math.round(base * (1 - CUPONS_VALIDOS[cupom]) * 100) / 100;
    }
    return base;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const fone = telefone.replace(/\D/g, "");
    if (!nome.trim()) { setErro("Informe seu nome."); return; }
    if (fone.length < 10) { setErro("WhatsApp inválido — informe com DDD."); return; }
    setLoading(true);

    // Salva lead (silencioso)
    fetch("/api/leads/registrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: nome.trim(), telefone: fone, plano: gate, origem: "assinar-gate" }),
    }).catch(() => {});

    try {
      if (ciclo === "anual") {
        const email = prompt("Seu e-mail para receber o acesso:") || "";
        if (!email) { setLoading(false); return; }
        const res = await fetch("/api/assinaturas/criar-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plano: gate, ciclo: "anual", nome: nome.trim(), email, telefone: fone, cupom }),
        });
        const data = await res.json();
        if (data.qr_code) { setPix({ qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, valor: data.valor }); setGate(null); }
        else setErro("Erro ao gerar Pix. Tente novamente.");
      } else {
        const res = await fetch("/api/assinaturas/criar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plano: gate, ciclo: "mensal", telefone: fone }),
        });
        const data = await res.json();
        if (data.checkout_url) window.location.href = data.checkout_url;
        else setErro("Erro ao criar assinatura. Tente novamente.");
      }
    } catch { setErro("Erro de conexão. Tente novamente."); }
    finally { setLoading(false); }
  }

  // ── Pix ──────────────────────────────────────────────────────────────────────
  if (pix) {
    return (
      <div style={S.page}>
        <div style={{ ...S.card, maxWidth: 400, textAlign: "center" }}>
          <p style={{ fontSize: 48 }}>🏦</p>
          <h2 style={{ color: "#ffd700", fontSize: 22, fontWeight: 900, margin: "0 0 8px" }}>Pague via Pix</h2>
          <p style={{ color: "#aaa", fontSize: 14, margin: "0 0 24px" }}>
            R$ <strong style={{ color: "#fff" }}>{pix.valor.toFixed(2).replace(".", ",")}</strong> — acesso anual
          </p>
          {pix.qr_code_base64 && (
            <img src={`data:image/png;base64,${pix.qr_code_base64}`} alt="QR Pix"
              style={{ width: 200, height: 200, margin: "0 auto 16px", display: "block", borderRadius: 8 }} />
          )}
          <div style={{ background: "#0d0d1a", borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <code style={{ color: "#ffd700", fontSize: 10, wordBreak: "break-all" }}>{pix.qr_code}</code>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(pix.qr_code); alert("Copiado!"); }} style={S.btnPrimary}>
            Copiar Código Pix
          </button>
          <p style={{ color: "#555", fontSize: 11, marginTop: 12 }}>Acesso liberado em até 5 minutos após o pagamento.</p>
        </div>
      </div>
    );
  }

  // ── Gate modal ────────────────────────────────────────────────────────────────
  if (gate) {
    return (
      <div style={S.page}>
        <div style={{ ...S.card, maxWidth: 420 }}>

          <p style={{ color: "#c0392b", fontWeight: 900, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", margin: "0 0 16px" }}>
            ⚡ Alerta Patriota
          </p>

          <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 900, lineHeight: 1.3, margin: "0 0 12px" }}>
            Garanta seu acesso direto<br />
            <span style={{ color: "#ffd700" }}>sem depender de algoritmo</span>
          </h2>

          <p style={{ color: "#888", fontSize: 14, lineHeight: 1.6, margin: "0 0 24px" }}>
            A esquerda está organizada. A direita só vence unida —
            coloque seu WhatsApp e entre para a rede direta do Capitão Braga.
          </p>

          <form onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Seu nome"
              value={nome}
              onChange={e => setNome(e.target.value)}
              required
              style={S.input}
            />
            <input
              type="tel"
              placeholder="WhatsApp com DDD"
              value={telefone}
              onChange={e => setTelefone(e.target.value)}
              required
              style={{ ...S.input, marginTop: 10 }}
            />
            {erro && <p style={{ color: "#c0392b", fontSize: 13, margin: "8px 0 0" }}>{erro}</p>}
            <button type="submit" disabled={loading} style={{ ...S.btnPrimary, marginTop: 16, fontSize: 16 }}>
              {loading ? "Aguarde..." : "🇧🇷 ENTRAR PARA A RESISTÊNCIA"}
            </button>
          </form>

          <p style={{ color: "#444", fontSize: 11, textAlign: "center", marginTop: 12 }}>
            🔒 Seus dados são só nossos — sem spam, sem compartilhamento.
          </p>

          <button onClick={() => setGate(null)} style={S.btnLink}>← Voltar</button>
        </div>
      </div>
    );
  }

  // ── Página principal ──────────────────────────────────────────────────────────
  return (
    <div style={{ background: "#0d0d1a", minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>

      {/* Hero */}
      <div style={{ textAlign: "center", padding: "48px 20px 32px" }}>
        <p style={{ color: "#c0392b", fontWeight: 900, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", margin: "0 0 16px" }}>
          🇧🇷 Alerta Patriota
        </p>
        <h1 style={{ color: "#fff", fontSize: 30, fontWeight: 900, lineHeight: 1.25, margin: "0 0 12px", maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
          O que a mídia esconde,{" "}
          <span style={{ color: "#ffd700" }}>o Capitão Braga revela</span>
        </h1>
        <p style={{ color: "#777", fontSize: 14, margin: "0 0 28px" }}>Direto no WhatsApp. Sem filtro. Sem censura.</p>

        {/* Toggle */}
        <div style={{ display: "inline-flex", background: "#1a1a2e", borderRadius: 999, padding: 4, gap: 4 }}>
          {(["mensal", "anual"] as const).map(c => (
            <button
              key={c}
              onClick={() => setCiclo(c)}
              style={{
                padding: "8px 20px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                background: ciclo === c ? "#ffd700" : "transparent",
                color: ciclo === c ? "#0d0d1a" : "#666",
                transition: "all .2s",
              }}
            >
              {c === "mensal" ? "Mensal" : "Anual  🎁 −2 meses"}
            </button>
          ))}
        </div>

        {cupom && CUPONS_VALIDOS[cupom] && (
          <div style={{ marginTop: 12, display: "inline-block", background: "#14532d", border: "1px solid #16a34a", borderRadius: 8, padding: "6px 16px" }}>
            <p style={{ color: "#4ade80", fontSize: 12, fontWeight: 700, margin: 0 }}>
              🎁 Cupom {cupom}: {Math.round(CUPONS_VALIDOS[cupom] * 100)}% off Elite Anual
            </p>
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        {PLANOS.map(plano => {
          const pFinal = precoFinal(plano);
          const temDesconto = pFinal !== plano.precoAnual && ciclo === "anual";
          return (
            <div key={plano.id} style={{
              background: "#111827",
              border: `2px solid ${plano.destaque ? plano.cor : "#1f2937"}`,
              borderRadius: 16,
              padding: "24px 20px",
              position: "relative",
            }}>
              {plano.destaque && (
                <div style={{
                  position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
                  background: plano.cor, color: "#fff", fontSize: 10, fontWeight: 900,
                  padding: "4px 14px", borderRadius: 999, letterSpacing: 1, textTransform: "uppercase",
                }}>
                  Mais completo
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <p style={{ color: "#aaa", fontSize: 12, margin: "0 0 2px", fontWeight: 700 }}>{plano.nome}</p>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ color: "#ffd700", fontSize: 32, fontWeight: 900 }}>
                      R${ciclo === "anual" ? pFinal.toFixed(2).replace(".", ",") : plano.preco.toFixed(2).replace(".", ",")}
                    </span>
                    <span style={{ color: "#555", fontSize: 13 }}>/{ciclo === "anual" ? "ano" : "mês"}</span>
                  </div>
                  {temDesconto && (
                    <p style={{ color: "#555", fontSize: 11, margin: "2px 0 0", textDecoration: "line-through" }}>
                      R${plano.precoAnual}/ano
                    </p>
                  )}
                  {ciclo === "anual" && (
                    <p style={{ color: "#4ade80", fontSize: 11, margin: "2px 0 0" }}>
                      ≈ R${(pFinal / 12).toFixed(2).replace(".", ",")}/mês
                    </p>
                  )}
                </div>
              </div>

              <ul style={{ margin: "0 0 20px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {plano.beneficios.map((b, i) => (
                  <li key={i} style={{ color: "#ccc", fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#ffd700", flexShrink: 0 }}>✓</span>
                    {b}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setGate(plano.id)}
                style={{
                  width: "100%", background: plano.destaque ? plano.cor : "#1f2937",
                  border: `2px solid ${plano.cor}`,
                  color: "#fff", fontWeight: 900, fontSize: 15,
                  padding: "14px 0", borderRadius: 12, cursor: "pointer",
                  transition: "opacity .2s",
                }}
                onMouseOver={e => (e.currentTarget.style.opacity = "0.85")}
                onMouseOut={e => (e.currentTarget.style.opacity = "1")}
              >
                {ciclo === "mensal" ? "Entrar por R$1 →" : "Garantir acesso →"}
              </button>

              {ciclo === "mensal" && (
                <p style={{ color: "#4ade80", fontSize: 11, textAlign: "center", margin: "8px 0 0" }}>
                  7 dias por R$1 — cancele quando quiser
                </p>
              )}
            </div>
          );
        })}

        {/* Prova social mínima */}
        <div style={{ display: "flex", justifyContent: "space-around", padding: "8px 0" }}>
          {[["🇧🇷", "100% patriota"], ["🔒", "Sem contrato"], ["📲", "Acesso imediato"]].map(([icon, txt], i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <p style={{ fontSize: 20, margin: "0 0 4px" }}>{icon}</p>
              <p style={{ color: "#555", fontSize: 11, margin: 0, fontWeight: 700 }}>{txt}</p>
            </div>
          ))}
        </div>

        <p style={{ color: "#333", fontSize: 11, textAlign: "center", margin: "4px 0 0", fontStyle: "italic" }}>
          Deus, Pátria e Família — sempre. — Capitão Braga
        </p>
      </div>
    </div>
  );
}

// ── Estilos reutilizáveis ───────────────────────────────────────────────────────
const S = {
  page: {
    background: "#0d0d1a",
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    fontFamily: "Arial, sans-serif",
  } as React.CSSProperties,

  card: {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 16,
    padding: "32px 24px",
    width: "100%",
  } as React.CSSProperties,

  input: {
    width: "100%",
    background: "#0d0d1a",
    border: "1px solid #374151",
    borderRadius: 10,
    padding: "13px 16px",
    color: "#fff",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
    display: "block",
  } as React.CSSProperties,

  btnPrimary: {
    width: "100%",
    background: "#c0392b",
    color: "#fff",
    fontWeight: 900,
    fontSize: 15,
    padding: "15px 0",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    display: "block",
    textAlign: "center",
    letterSpacing: 0.5,
  } as React.CSSProperties,

  btnLink: {
    background: "transparent",
    border: "none",
    color: "#444",
    fontSize: 12,
    cursor: "pointer",
    marginTop: 16,
    display: "block",
    textAlign: "center",
    width: "100%",
  } as React.CSSProperties,
};
