"use client";
import { useEffect, useState, useCallback } from "react";

type Usuario = {
  id: number;
  nome: string;
  email: string;
  telefone?: string;
  plano: string;
  status: string;
  tipo_usuario?: string;
  trial_inicio?: string;
  trial_fim?: string;
  assinatura_inicio?: string;
  created_at: string;
};

const PLANO_COR: Record<string, string> = {
  basico: "#888",
  patriota: "#3b82f6",
  vip: "#f97316",
  elite: "#7c3aed",
};

const STATUS_COR: Record<string, string> = {
  ativo: "#22c55e",
  trial: "#f59e0b",
  cancelado: "#ef4444",
  inadimplente: "#f97316",
};

const STATUS_BG: Record<string, string> = {
  ativo: "rgba(34,197,94,0.12)",
  trial: "rgba(245,158,11,0.12)",
  cancelado: "rgba(239,68,68,0.12)",
  inadimplente: "rgba(249,115,22,0.12)",
};

function fmtData(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR");
}

export default function AdminMembros() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [total, setTotal] = useState(0);
  const [filtroPlano, setFiltroPlano] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [acao, setAcao] = useState<{ id: number; tipo: string } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (filtroPlano) p.set("plano", filtroPlano);
    if (filtroStatus) p.set("status", filtroStatus);
    if (busca.trim()) p.set("busca", busca.trim());
    p.set("limite", "100");
    const res = await fetch(`/api/admin/usuarios?${p}`);
    const d = await res.json();
    setUsuarios(d.usuarios || []);
    setTotal(d.total || 0);
    setLoading(false);
  }, [filtroPlano, filtroStatus, busca]);

  useEffect(() => { carregar(); }, [filtroPlano, filtroStatus]);

  const executarAcao = async (id: number, tipo: string) => {
    setAcao({ id, tipo });
    const ok = confirm(`Confirmar: ${tipo} para este membro?`);
    if (!ok) { setAcao(null); return; }
    await fetch(`/api/admin/usuarios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: tipo }),
    });
    setAcao(null);
    carregar();
  };

  const sel = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "8px 12px",
    color: "#fff",
    fontSize: 13,
    outline: "none",
  } as React.CSSProperties;

  return (
    <div style={{ padding: 24, color: "#fff", fontFamily: "'Inter',sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "#ffd700", marginBottom: 2 }}>👥 Gestão de Membros</h1>
          <p style={{ color: "#444", fontSize: 12 }}>{total} membros encontrados</p>
        </div>
        <button
          onClick={() => window.open("/api/admin/exportar?tipo=membros", "_blank")}
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#aaa", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12 }}
        >
          ⬇️ Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="🔍 Buscar por nome ou e-mail..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onKeyDown={e => e.key === "Enter" && carregar()}
          style={{ ...sel, flex: 1, minWidth: 220, padding: "8px 14px" }}
        />
        <select value={filtroPlano} onChange={e => setFiltroPlano(e.target.value)} style={sel}>
          <option value="">Todos os planos</option>
          {["basico", "patriota", "vip", "elite"].map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={sel}>
          <option value="">Todos os status</option>
          {["ativo", "trial", "inadimplente", "cancelado"].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <button
          onClick={carregar}
          style={{ background: "#ffd700", color: "#0a0a14", fontWeight: 700, padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13 }}
        >
          Filtrar
        </button>
      </div>

      {/* Tabela */}
      {loading ? (
        <p style={{ color: "#555", textAlign: "center", padding: 40 }}>Carregando...</p>
      ) : usuarios.length === 0 ? (
        <p style={{ color: "#555", textAlign: "center", padding: 40 }}>Nenhum membro encontrado.</p>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                {["Nome", "E-mail", "Plano", "Status", "Criado em", "Assinatura desde", "Ações"].map(h => (
                  <th key={h} style={{ padding: "11px 14px", textAlign: "left", color: "#555", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u, i) => (
                <>
                  <tr
                    key={u.id}
                    style={{
                      background: expandido === u.id
                        ? "rgba(255,215,0,0.04)"
                        : i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      cursor: "pointer",
                      transition: "background .15s",
                    }}
                  >
                    <td
                      style={{ padding: "10px 14px", fontWeight: 600, whiteSpace: "nowrap" }}
                      onClick={() => setExpandido(expandido === u.id ? null : u.id)}
                    >
                      <span style={{ marginRight: 6, fontSize: 10, color: "#444" }}>
                        {expandido === u.id ? "▼" : "▶"}
                      </span>
                      {u.nome || "—"}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#888", fontSize: 12 }}>{u.email}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        background: `${PLANO_COR[u.plano] || "#333"}22`,
                        color: PLANO_COR[u.plano] || "#aaa",
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "capitalize",
                      }}>
                        {u.plano || "—"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        background: STATUS_BG[u.status] || "rgba(255,255,255,0.05)",
                        color: STATUS_COR[u.status] || "#aaa",
                        padding: "3px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "capitalize",
                      }}>
                        {u.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#555", fontSize: 12, whiteSpace: "nowrap" }}>{fmtData(u.created_at)}</td>
                    <td style={{ padding: "10px 14px", color: "#555", fontSize: 12, whiteSpace: "nowrap" }}>{fmtData(u.assinatura_inicio)}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {u.status !== "cancelado" ? (
                          <button
                            onClick={() => executarAcao(u.id, "cancelar")}
                            disabled={acao?.id === u.id}
                            style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                          >
                            Cancelar
                          </button>
                        ) : (
                          <button
                            onClick={() => executarAcao(u.id, "reativar")}
                            disabled={acao?.id === u.id}
                            style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                          >
                            Reativar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Linha expandida */}
                  {expandido === u.id && (
                    <tr key={`det-${u.id}`} style={{ background: "rgba(255,215,0,0.02)", borderBottom: "1px solid rgba(255,215,0,0.1)" }}>
                      <td colSpan={7} style={{ padding: "16px 24px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
                          <div>
                            <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>ID</p>
                            <p style={{ fontSize: 13, color: "#ccc" }}>#{u.id}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Telefone</p>
                            <p style={{ fontSize: 13, color: "#ccc" }}>{u.telefone || "—"}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Tipo</p>
                            <p style={{ fontSize: 13, color: "#ccc" }}>{u.tipo_usuario || "regular"}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Trial início</p>
                            <p style={{ fontSize: 13, color: "#ccc" }}>{fmtData(u.trial_inicio)}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Trial fim</p>
                            <p style={{ fontSize: 13, color: "#ccc" }}>{fmtData(u.trial_fim)}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Mudar plano</p>
                            <select
                              defaultValue=""
                              onChange={e => {
                                if (e.target.value) {
                                  fetch(`/api/admin/usuarios/${u.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ acao: "mudar_plano", plano: e.target.value }),
                                  }).then(() => carregar());
                                }
                              }}
                              style={{ background: "#1e1e2e", border: "1px solid rgba(255,255,255,0.1)", color: "#ccc", borderRadius: 6, padding: "5px 10px", fontSize: 12 }}
                            >
                              <option value="">Selecionar...</option>
                              {["basico", "patriota", "vip", "elite"].map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
