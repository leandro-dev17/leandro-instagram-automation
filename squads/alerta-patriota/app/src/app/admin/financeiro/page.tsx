"use client";
import { useEffect, useState } from "react";

// Valores mensais por plano
const VALOR_PLANO: Record<string, number> = {
  basico: 12.90,
  patriota: 29.90,
  vip: 59.90,
  elite: 499 / 12, // ~41.58
};

type FinData = {
  mrr: { mrr: number; total_ativas: number };
  receita: { mes_atual: number; mes_anterior: number; total_historico: number };
  inadimplentes: Array<{ id: number; nome: string; email: string; plano: string; updated_at: string }>;
  cancelamentos: { mes_atual: number; mes_anterior: number };
  crescimento: Array<{ dia: string; novos: number }>;
};

type Pagamento = {
  id: number;
  usuario_id: number;
  nome_usuario?: string;
  email_usuario?: string;
  plano?: string;
  valor: number;
  metodo: string;
  status: string;
  mp_payment_id?: string;
  created_at: string;
};

type StatsData = {
  membros: {
    basico: number;
    patriota: number;
    vip: number;
    elite: number;
    ativos: number;
  };
};

const STATUS_COR: Record<string, string> = {
  aprovado: "#22c55e",
  pendente: "#f59e0b",
  recusado: "#ef4444",
  cancelado: "#888",
  reembolsado: "#3b82f6",
};

const PLANO_COR: Record<string, string> = {
  basico: "#888",
  patriota: "#3b82f6",
  vip: "#f97316",
  elite: "#7c3aed",
};

function fmt(v: number) {
  return `R$${(v || 0).toFixed(2).replace(".", ",")}`;
}

function exportarCSV(pagamentos: Pagamento[]) {
  const header = ["ID", "Usuário", "E-mail", "Plano", "Valor", "Método", "Status", "MP ID", "Data"];
  const linhas = pagamentos.map(p => [
    p.id,
    p.nome_usuario || "",
    p.email_usuario || "",
    p.plano || "",
    (p.valor || 0).toFixed(2),
    p.metodo || "",
    p.status || "",
    p.mp_payment_id || "",
    new Date(p.created_at).toLocaleString("pt-BR"),
  ]);
  const csv = [header, ...linhas].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pagamentos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminFinanceiro() {
  const [fin, setFin] = useState<FinData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/financeiro").then(r => r.json()),
      fetch("/api/admin/stats").then(r => r.json()),
      fetch("/api/admin/financeiro/pagamentos?limite=30").then(r => r.json()).catch(() => ({ pagamentos: [] })),
    ]).then(([f, s, p]) => {
      setFin(f);
      setStats(s);
      setPagamentos(p.pagamentos || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ padding: 24, color: "#555", textAlign: "center" }}>Carregando...</div>;
  if (!fin) return <div style={{ padding: 24, color: "#ef4444" }}>Erro ao carregar dados financeiros.</div>;

  const mrr = Number(fin.mrr?.mrr || 0);
  const mesAtual = Number(fin.receita?.mes_atual || 0);
  const mesAnt = Number(fin.receita?.mes_anterior || 0);
  const varPct = mesAnt > 0 ? (((mesAtual - mesAnt) / mesAnt) * 100).toFixed(1) : null;
  const anualProjetado = mrr * 12;
  const maxCres = Math.max(...(fin.crescimento || []).map(d => Number(d.novos)), 1);

  // MRR calculado por plano via stats
  const mrrPlanos = stats ? (
    (stats.membros.basico || 0) * VALOR_PLANO.basico +
    (stats.membros.patriota || 0) * VALOR_PLANO.patriota +
    (stats.membros.vip || 0) * VALOR_PLANO.vip +
    (stats.membros.elite || 0) * VALOR_PLANO.elite
  ) : mrr;

  return (
    <div style={{ padding: 24, color: "#fff", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: "#ffd700" }}>💰 Painel Financeiro</h1>
        <button
          onClick={() => exportarCSV(pagamentos)}
          style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.25)", color: "#ffd700", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
        >
          ⬇️ Exportar CSV
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { l: "MRR Total",          v: fmt(mrrPlanos),         c: "#ffd700", i: "💰" },
          { l: "Receita Anual Proj.", v: fmt(anualProjetado),    c: "#22c55e", i: "📊" },
          { l: "Este Mês",           v: fmt(mesAtual),           c: "#3b82f6", i: "📆" },
          { l: "Variação MoM",       v: varPct != null ? `${varPct}%` : "—", c: varPct != null && Number(varPct) >= 0 ? "#22c55e" : "#ef4444", i: "📈" },
          { l: "Assinaturas Ativas", v: String(fin.mrr?.total_ativas || 0), c: "#22c55e", i: "✅" },
          { l: "Inadimplentes",      v: String(fin.inadimplentes?.length || 0), c: "#f59e0b", i: "⚠️" },
        ].map((k, idx) => (
          <div key={idx} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{k.i} {k.l}</div>
            <p style={{ fontSize: 22, fontWeight: 900, color: k.c }}>{k.v}</p>
          </div>
        ))}
      </div>

      {/* MRR por plano */}
      {stats && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Assinaturas Ativas por Plano</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            {(["basico", "patriota", "vip", "elite"] as const).map(p => {
              const qtd = stats.membros[p] || 0;
              const contrib = qtd * VALOR_PLANO[p];
              return (
                <div key={p} style={{ background: `${PLANO_COR[p]}11`, border: `1px solid ${PLANO_COR[p]}33`, borderRadius: 10, padding: "12px 14px" }}>
                  <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{p}</p>
                  <p style={{ fontSize: 20, fontWeight: 900, color: PLANO_COR[p] }}>{qtd}</p>
                  <p style={{ fontSize: 11, color: "#444", marginTop: 2 }}>= {fmt(contrib)}/mês</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gráfico de crescimento */}
      {(fin.crescimento?.length || 0) > 0 && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>👥 Novos Membros — Últimos 30 Dias</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 70 }}>
            {fin.crescimento.slice(-30).map((d, i) => {
              const h = Math.max(4, Math.round((Number(d.novos) / maxCres) * 70));
              const isHoje = i === fin.crescimento.slice(-30).length - 1;
              return (
                <div
                  key={i}
                  title={`${new Date(d.dia).toLocaleDateString("pt-BR")}: ${d.novos} novos`}
                  style={{ flex: 1, height: h, background: isHoje ? "#22c55e" : "rgba(34,197,94,0.3)", borderRadius: "2px 2px 0 0", minWidth: 4, cursor: "pointer" }}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "#333" }}>
            <span>{fin.crescimento.length > 0 ? new Date(fin.crescimento[0]?.dia).toLocaleDateString("pt-BR") : ""}</span>
            <span style={{ color: "#22c55e" }}>Hoje: {fin.crescimento[fin.crescimento.length - 1]?.novos || 0} novos</span>
          </div>
        </div>
      )}

      {/* Tabela de pagamentos */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>
            💳 Últimos 30 Pagamentos
          </h3>
          <span style={{ fontSize: 11, color: "#333" }}>{pagamentos.length} registros</span>
        </div>
        {pagamentos.length === 0 ? (
          <p style={{ color: "#555", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Nenhum pagamento registrado.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  {["Usuário", "Plano", "Valor", "Método", "Status", "Data"].map(h => (
                    <th key={h} style={{ padding: "9px 12px", textAlign: "left", color: "#555", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((p, i) => (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.nome_usuario || `#${p.usuario_id}`}</div>
                      {p.email_usuario && <div style={{ fontSize: 11, color: "#555" }}>{p.email_usuario}</div>}
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      {p.plano && (
                        <span style={{ background: `${PLANO_COR[p.plano] || "#333"}22`, color: PLANO_COR[p.plano] || "#aaa", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>
                          {p.plano}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", fontWeight: 700, color: "#ffd700" }}>{fmt(Number(p.valor))}</td>
                    <td style={{ padding: "9px 12px", color: "#777", fontSize: 12 }}>{p.metodo || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{ color: STATUS_COR[p.status] || "#888", fontWeight: 600, fontSize: 12 }}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px", color: "#555", fontSize: 12, whiteSpace: "nowrap" }}>
                      {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inadimplentes */}
      {(fin.inadimplentes?.length || 0) > 0 && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 14, padding: 20 }}>
          <h3 style={{ fontSize: 11, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
            ⚠️ Inadimplentes ({fin.inadimplentes.length})
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Nome", "E-mail", "Plano", "Desde"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#555", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fin.inadimplentes.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                    <td style={{ padding: "8px 12px" }}>{u.nome}</td>
                    <td style={{ padding: "8px 12px", color: "#888" }}>{u.email}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ color: PLANO_COR[u.plano] || "#aaa", fontWeight: 700 }}>{u.plano}</span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "#555", fontSize: 12 }}>
                      {new Date(u.updated_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
