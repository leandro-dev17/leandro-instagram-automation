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
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [acaoMassa, setAcaoMassa] = useState("");
  const [executandoMassa, setExecutandoMassa] = useState(false);

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
    setSelecionados([]);
  }, [filtroPlano, filtroStatus, busca]);

  useEffect(() => { carregar(); }, [filtroPlano, filtroStatus]);

  const executarAcao = async (id: number, tipo: string, extra?: Record<string, string>) => {
    setAcao({ id, tipo });
    await fetch(`/api/admin/usuarios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: tipo, ...extra }),
    });
    setAcao(null);
    carregar();
  };

  const confirmarEExecutar = async (id: number, tipo: string) => {
    const ok = confirm(`Confirmar: ${tipo} para este membro?`);
    if (!ok) return;
    await executarAcao(id, tipo);
  };

  const excluirDados = async (id: number) => {
    if (!window.confirm("Anonimizar permanentemente os dados pessoais deste usuário (LGPD)? Essa ação não pode ser desfeita.")) return;
    await executarAcao(id, "excluir_dados");
  };

  const executarMassa = async () => {
    // FASE 30: ação em massa (cancela/reativa todos de uma vez — cada uma cancela no
    // Mercado Pago e remove/readiciona ao grupo WhatsApp) era a única ação destrutiva do
    // painel sem confirm() nem trava de duplo-clique, e a mais perigosa (afeta N usuários
    // de uma vez). `executandoMassa` bloqueia clique repetido enquanto o lote roda.
    if (!acaoMassa || !selecionados.length || executandoMassa) return;
    const ok = confirm(`Confirmar "${acaoMassa}" para ${selecionados.length} membro(s) selecionado(s)? Esta ação afeta todos de uma vez (Mercado Pago + grupo WhatsApp) e não pode ser desfeita automaticamente.`);
    if (!ok) return;
    setExecutandoMassa(true);
    try {
      for (const id of selecionados) await executarAcao(id, acaoMassa);
    } finally {
      setExecutandoMassa(false);
    }
    setAcaoMassa("");
  };

  const toggleSel = (id: number) => setSelecionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleTodos = () => setSelecionados(selecionados.length === usuarios.length ? [] : usuarios.map(u => u.id));

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
          {["vip", "elite"].map(p => (
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

      {/* Barra de ação em massa */}
      {selecionados.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)", borderRadius: 10, padding: "10px 14px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#ffd700", fontWeight: 700 }}>{selecionados.length} selecionados</span>
          <select value={acaoMassa} onChange={e => setAcaoMassa(e.target.value)}
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "5px 10px", color: "#fff", fontSize: 12 }}>
            <option value="">Ação em massa...</option>
            <option value="cancelar">Cancelar todos</option>
            <option value="reativar">Reativar todos</option>
          </select>
          <button onClick={executarMassa} disabled={!acaoMassa || executandoMassa} style={{ background: acaoMassa && !executandoMassa ? "#ef4444" : "#1e1e2e", color: "#fff", fontWeight: 700, padding: "5px 14px", borderRadius: 6, border: "none", cursor: acaoMassa && !executandoMassa ? "pointer" : "not-allowed", fontSize: 12 }}>{executandoMassa ? "Aplicando..." : "Aplicar"}</button>
          <button onClick={() => setSelecionados([])} disabled={executandoMassa} style={{ color: "#555", background: "transparent", border: "none", cursor: executandoMassa ? "not-allowed" : "pointer", fontSize: 11 }}>Limpar seleção</button>
        </div>
      )}

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
                <th style={{ padding: "11px 14px", width: 36 }}>
                  <input type="checkbox" checked={selecionados.length === usuarios.length && usuarios.length > 0} onChange={toggleTodos} />
                </th>
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
                        : selecionados.includes(u.id) ? "rgba(255,215,0,0.04)"
                        : i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      transition: "background .15s",
                    }}
                  >
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <input type="checkbox" checked={selecionados.includes(u.id)} onChange={() => toggleSel(u.id)} />
                    </td>
                    <td
                      style={{ padding: "10px 14px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
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
                            onClick={() => confirmarEExecutar(u.id, "cancelar")}
                            disabled={acao?.id === u.id}
                            style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                          >
                            Cancelar
                          </button>
                        ) : (
                          <button
                            onClick={() => confirmarEExecutar(u.id, "reativar")}
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
                      <td colSpan={8} style={{ padding: "16px 24px" }}>
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
                                if (e.target.value) executarAcao(u.id, "mudar_plano", { plano: e.target.value });
                              }}
                              style={{ background: "#1e1e2e", border: "1px solid rgba(255,255,255,0.1)", color: "#ccc", borderRadius: 6, padding: "5px 10px", fontSize: 12 }}
                            >
                              <option value="">Selecionar...</option>
                              {["vip", "elite"].map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </div>
                          {u.status !== "excluido" && (
                            <div>
                              <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>LGPD</p>
                              <button
                                onClick={() => excluirDados(u.id)}
                                title="Anonimizar dados pessoais (LGPD)"
                                style={{ background: "rgba(255,255,255,0.05)", color: "#888", border: "1px solid rgba(255,255,255,0.1)", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                              >
                                🗑️ Excluir dados
                              </button>
                            </div>
                          )}
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
