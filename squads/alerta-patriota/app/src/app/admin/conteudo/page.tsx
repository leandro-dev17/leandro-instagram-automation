"use client";
import { useEffect, useState } from "react";

type Noticia = {
  id: number;
  titulo: string;
  fonte: string;
  urgente: boolean;
  global: boolean;
  postada_vip: boolean;
  postada_elite: boolean;
  tem_resumo_braga: boolean;
  tem_resumo_cavalcanti: boolean;
  created_at: string;
};

type PostWhatsApp = {
  id: number;
  grupo_id: number;
  noticia_id: number;
  conteudo: string;
  tipo: string;
  status: string;
  enviado_at: string;
};

const TABS = ["Notícias coletadas", "Fila de publicação", "Histórico"] as const;
type Tab = typeof TABS[number];

function BadgeGrupo({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 10, padding: "2px 7px", borderRadius: 999,
      background: ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.08)",
      color: ok ? "#22c55e" : "#555",
      border: `1px solid ${ok ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.06)"}`,
    }}>
      {ok ? "✅" : "❌"} {label}
    </span>
  );
}

export default function AdminConteudo() {
  const [tab, setTab] = useState<Tab>("Notícias coletadas");
  const [noticias, setNoticias] = useState<Noticia[]>([]);
  const [historico, setHistorico] = useState<PostWhatsApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [publicando, setPublicando] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregarNoticias = async (status?: string) => {
    setLoading(true);
    const p = new URLSearchParams({ limite: "20" });
    if (status) p.set("status", status);
    const res = await fetch(`/api/admin/noticias?${p}`);
    const d = await res.json();
    setNoticias(d.noticias || []);
    setLoading(false);
  };

  const carregarHistorico = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/mensagens?limite=30");
    const d = await res.json();
    setHistorico(d.mensagens || d.posts || []);
    setLoading(false);
  };

  useEffect(() => {
    setMsg(null);
    if (tab === "Notícias coletadas") carregarNoticias();
    else if (tab === "Fila de publicação") carregarNoticias("pendente");
    else carregarHistorico();
  }, [tab]);

  const publicarAgora = async (id: number) => {
    setPublicando(id);
    setMsg(null);
    try {
      // Chama via rota admin (sem expor secret no frontend)
      const res = await fetch("/api/admin/publicar-agora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticia_id: id }),
      });
      const d = await res.json();
      if (d.ok !== false) {
        setMsg({ tipo: "ok", texto: `Publicação iniciada para notícia #${id}` });
        carregarNoticias(tab === "Fila de publicação" ? "pendente" : undefined);
      } else {
        setMsg({ tipo: "erro", texto: d.erro || "Erro ao publicar" });
      }
    } catch {
      setMsg({ tipo: "erro", texto: "Erro de rede" });
    }
    setPublicando(null);
  };

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "9px 18px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: tab === t ? 700 : 400,
    background: tab === t ? "rgba(255,215,0,0.12)" : "transparent",
    color: tab === t ? "#ffd700" : "#555",
    borderBottom: tab === t ? "2px solid #ffd700" : "2px solid transparent",
    transition: "all .15s",
  });

  return (
    <div style={{ padding: 24, color: "#fff", fontFamily: "'Inter',sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: "#ffd700", marginBottom: 18 }}>📰 Central de Conteúdo</h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* Feedback */}
      {msg && (
        <div style={{
          marginBottom: 14, padding: "10px 16px", borderRadius: 8, fontSize: 13,
          background: msg.tipo === "ok" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
          border: `1px solid ${msg.tipo === "ok" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          color: msg.tipo === "ok" ? "#22c55e" : "#ef4444",
        }}>
          {msg.tipo === "ok" ? "✅" : "❌"} {msg.texto}
        </div>
      )}

      {loading ? (
        <p style={{ color: "#555", textAlign: "center", padding: 40 }}>Carregando...</p>
      ) : (

        /* ───────── TAB: Notícias coletadas ───────── */
        (tab === "Notícias coletadas" || tab === "Fila de publicação") ? (
          noticias.length === 0 ? (
            <p style={{ color: "#555", textAlign: "center", padding: 40 }}>Nenhuma notícia encontrada.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {noticias.map(n => (
                <div key={n.id} style={{
                  background: "rgba(255,255,255,0.03)",
                  border: n.urgente ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 12,
                  padding: "14px 18px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        {n.urgente && (
                          <span style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
                            🚨 URGENTE
                          </span>
                        )}
                        {n.global && (
                          <span style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6", padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
                            🌍 GLOBAL
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "#444" }}>{n.fonte}</span>
                        <span style={{ fontSize: 11, color: "#333" }}>·</span>
                        <span style={{ fontSize: 11, color: "#333" }}>{new Date(n.created_at).toLocaleString("pt-BR")}</span>
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#ddd", lineHeight: 1.4 }}>{n.titulo}</p>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", minWidth: 160 }}>
                      {/* Status de resumos */}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 10, color: n.tem_resumo_braga ? "#22c55e" : "#444" }}>
                          {n.tem_resumo_braga ? "✅" : "⏳"} Braga
                        </span>
                        <span style={{ fontSize: 10, color: n.tem_resumo_cavalcanti ? "#22c55e" : "#444" }}>
                          {n.tem_resumo_cavalcanti ? "✅" : "⏳"} Cavalcanti
                        </span>
                      </div>
                      {/* Status de publicação por grupo */}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <BadgeGrupo ok={n.postada_vip} label="VIP" />
                        <BadgeGrupo ok={n.postada_elite} label="Elite" />
                      </div>
                      {/* Botão publicar */}
                      {(!n.postada_vip || !n.postada_elite) && (
                        <button
                          onClick={() => publicarAgora(n.id)}
                          disabled={publicando === n.id}
                          style={{
                            background: publicando === n.id ? "#1e1e2e" : "rgba(255,215,0,0.12)",
                            color: publicando === n.id ? "#555" : "#ffd700",
                            border: "1px solid rgba(255,215,0,0.25)",
                            padding: "5px 14px",
                            borderRadius: 7,
                            cursor: publicando === n.id ? "not-allowed" : "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {publicando === n.id ? "Publicando..." : "▶ Publicar agora"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )

        /* ───────── TAB: Histórico ───────── */
        ) : (
          historico.length === 0 ? (
            <p style={{ color: "#555", textAlign: "center", padding: 40 }}>Nenhuma mensagem no histórico.</p>
          ) : (
            <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                    {["Grupo", "Notícia #", "Tipo", "Status", "Enviado em", "Preview"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#555", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historico.map((p, i) => (
                    <tr key={p.id} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "9px 14px", color: "#aaa" }}>#{p.grupo_id}</td>
                      <td style={{ padding: "9px 14px", color: "#555", fontSize: 12 }}>{p.noticia_id ? `#${p.noticia_id}` : "—"}</td>
                      <td style={{ padding: "9px 14px" }}>
                        <span style={{ background: "rgba(255,255,255,0.06)", color: "#888", padding: "2px 8px", borderRadius: 999, fontSize: 11 }}>
                          {p.tipo}
                        </span>
                      </td>
                      <td style={{ padding: "9px 14px" }}>
                        <span style={{ color: p.status === "enviado" ? "#22c55e" : p.status === "erro" ? "#ef4444" : "#f59e0b", fontWeight: 600, fontSize: 12 }}>
                          {p.status}
                        </span>
                      </td>
                      <td style={{ padding: "9px 14px", color: "#555", fontSize: 12, whiteSpace: "nowrap" }}>
                        {p.enviado_at ? new Date(p.enviado_at).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td style={{ padding: "9px 14px", color: "#666", fontSize: 11, maxWidth: 240 }}>
                        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.conteudo ? p.conteudo.slice(0, 80) + (p.conteudo.length > 80 ? "…" : "") : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )
      )}
    </div>
  );
}
