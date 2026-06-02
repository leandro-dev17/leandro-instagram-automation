"use client";
import { useEffect, useState } from "react";

type AgenteLog = {
  agente: string;
  ultima_execucao: string;
  sucesso_24h: number;
  erro_24h: number;
  ultimo_status: string;
};

type Alerta = {
  id: number;
  tipo: string;
  severidade: string;
  mensagem: string;
  created_at: string;
};

// Lista canônica de agentes conforme spec Fase 6
const AGENTES = [
  { id: "neto-noticias",      nome: "Neto Notícias",              rota: "/api/cron/coletar-noticias",      emoji: "📰" },
  { id: "curador-carlos",     nome: "Curador Carlos",             rota: "/api/cron/curar-noticias",        emoji: "🎯" },
  { id: "bernardo-resumidor", nome: "Bernardo Resumidor",         rota: "/api/cron/resumir-noticias",      emoji: "✍️" },
  { id: "gerador-card",       nome: "Paulo Cards",                rota: null,                              emoji: "🎨" },
  { id: "raquel-radar",       nome: "Raquel Radar",               rota: "/api/cron/radar-politico",        emoji: "📡" },
  { id: "marcio-crise",       nome: "Márcio Crise",               rota: "/api/cron/modo-crise",            emoji: "🚨" },
  { id: "fabio-fomo",         nome: "Fábio FOMO",                 rota: null,                              emoji: "🔥" },
  { id: "tereza-termometro",  nome: "Tereza Termômetro",          rota: "/api/cron/termometro",            emoji: "🌡️" },
  { id: "davi-dossie",        nome: "Davi Dossiê",                rota: null,                              emoji: "📄" },
  { id: "general-alves",      nome: "General Alves CEO",          rota: "/api/cron/relatorio-ceo",         emoji: "👑" },
  { id: "flora-foto",         nome: "Flora Foto (Fiscal)",        rota: "/api/cron/fiscal-cards",          emoji: "🔍" },
  { id: "diana-duplicata",    nome: "Diana Duplicata (Fiscal)",   rota: "/api/cron/fiscal-duplicatas",     emoji: "🔍" },
  { id: "clara-conteudo",     nome: "Clara Conteúdo (Fiscal)",    rota: "/api/cron/fiscal-conteudo",       emoji: "🔍" },
  { id: "wagner-workflow",    nome: "Wagner Workflow (Fiscal)",   rota: "/api/cron/fiscal-workflow",       emoji: "🔍" },
] as const;

// Próxima execução estimada por agente (heurística simples)
const PROXIMA: Record<string, string> = {
  "neto-noticias":      "A cada 3h",
  "curador-carlos":     "A cada 3h",
  "bernardo-resumidor": "A cada 3h",
  "gerador-card":       "GitHub Actions",
  "raquel-radar":       "08h / 20h",
  "marcio-crise":       "Contínuo",
  "fabio-fomo":         "Manual",
  "tereza-termometro":  "12h / 21h",
  "davi-dossie":        "Manual",
  "general-alves":      "07h (diário)",
  "flora-foto":         "A cada 6h",
  "diana-duplicata":    "A cada 6h",
  "clara-conteudo":     "A cada 6h",
  "wagner-workflow":    "A cada 6h",
};

const SEV_COR: Record<string, string> = {
  critico: "#ef4444",
  alto:    "#f59e0b",
  medio:   "#3b82f6",
  baixo:   "#6b7280",
};

function StatusIcon({ status }: { status?: string }) {
  if (!status) return <span style={{ color: "#555" }}>—</span>;
  if (status === "sucesso") return <span style={{ color: "#22c55e", fontWeight: 700 }}>✅ sucesso</span>;
  if (status === "erro")    return <span style={{ color: "#ef4444", fontWeight: 700 }}>❌ erro</span>;
  return <span style={{ color: "#f59e0b", fontWeight: 700 }}>⚠️ {status}</span>;
}

export default function AdminAgentes() {
  const [logs, setLogs] = useState<Record<string, AgenteLog>>({});
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [executando, setExecutando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ agente: string; dados: unknown } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/agentes")
      .then(r => r.json())
      .then(d => {
        const map: Record<string, AgenteLog> = {};
        (d.agentes || []).forEach((a: AgenteLog) => { map[a.agente] = a; });
        setLogs(map);
        setAlertas(d.alertas || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const executar = async (agente: typeof AGENTES[number]) => {
    if (!agente.rota) {
      alert(`${agente.nome} é executado externamente (GitHub Actions) — sem rota direta.`);
      return;
    }
    if (!confirm(`Executar ${agente.nome} agora?`)) return;
    setExecutando(agente.id);
    setResultado(null);
    try {
      const res = await fetch("/api/admin/agentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rota: agente.rota }),
      });
      const data = await res.json();
      setResultado({ agente: agente.nome, dados: data });
    } catch {
      setResultado({ agente: agente.nome, dados: { erro: "Falha de rede" } });
    }
    setExecutando(null);
  };

  return (
    <div style={{ padding: 24, color: "#fff", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: "#ffd700", marginBottom: 4 }}>🤖 Painel de Agentes</h1>
        <p style={{ color: "#555", fontSize: 12 }}>{AGENTES.length} agentes monitorados</p>
      </div>

      {/* Alertas não resolvidos */}
      {alertas.length > 0 && (
        <div style={{
          background: "#180a0a",
          border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 20,
        }}>
          <h3 style={{ color: "#ef4444", marginBottom: 12, fontSize: 13, fontWeight: 700 }}>
            🚨 {alertas.length} Alerta(s) Não Resolvido(s)
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alertas.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{
                  background: SEV_COR[a.severidade] || "#888",
                  color: "#fff",
                  fontSize: 9,
                  padding: "2px 7px",
                  borderRadius: 999,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}>
                  {a.severidade}
                </span>
                <span style={{ fontSize: 13, color: "#ccc", flex: 1 }}>{a.mensagem}</span>
                <span style={{ fontSize: 11, color: "#444", whiteSpace: "nowrap" }}>
                  {new Date(a.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resultado da execução */}
      {resultado && (
        <div style={{
          background: "#0a180a",
          border: "1px solid rgba(34,197,94,0.3)",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ color: "#22c55e", fontSize: 13, fontWeight: 700 }}>
              ✅ Resultado — {resultado.agente}
            </h3>
            <button
              onClick={() => setResultado(null)}
              style={{ background: "#1e1e2e", color: "#aaa", border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 11 }}
            >
              Fechar
            </button>
          </div>
          <pre style={{ fontSize: 11, color: "#888", overflow: "auto", maxHeight: 200 }}>
            {JSON.stringify(resultado.dados, null, 2)}
          </pre>
        </div>
      )}

      {/* Grid de agentes */}
      {loading ? (
        <p style={{ color: "#555", textAlign: "center", padding: 40 }}>Carregando...</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {AGENTES.map(ag => {
            const log = logs[ag.id];
            const temErro = log?.ultimo_status === "erro";
            return (
              <div
                key={ag.id}
                style={{
                  background: temErro ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.03)",
                  border: temErro ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 12,
                  padding: "16px 18px",
                  transition: "border-color .2s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{ag.emoji}</span>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 14, color: "#ddd" }}>{ag.nome}</p>
                      <p style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>{ag.id}</p>
                    </div>
                  </div>
                  <StatusIcon status={log?.ultimo_status} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
                    <p style={{ fontSize: 10, color: "#444", marginBottom: 2 }}>Última exec.</p>
                    <p style={{ fontSize: 12, color: "#888" }}>
                      {log?.ultima_execucao
                        ? new Date(log.ultima_execucao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </p>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
                    <p style={{ fontSize: 10, color: "#444", marginBottom: 2 }}>Próxima</p>
                    <p style={{ fontSize: 12, color: "#888" }}>{PROXIMA[ag.id] || "—"}</p>
                  </div>
                </div>

                {log && (
                  <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 11, color: "#22c55e" }}>✓ {log.sucesso_24h || 0} sucesso</span>
                    <span style={{ fontSize: 11, color: log.erro_24h > 0 ? "#ef4444" : "#555" }}>
                      ✗ {log.erro_24h || 0} erro(s)
                    </span>
                    <span style={{ fontSize: 11, color: "#333" }}>nas últimas 24h</span>
                  </div>
                )}

                <button
                  onClick={() => executar(ag)}
                  disabled={executando === ag.id || !ag.rota}
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: 8,
                    border: ag.rota ? "1px solid rgba(255,215,0,0.2)" : "1px solid rgba(255,255,255,0.06)",
                    background: executando === ag.id
                      ? "#1e1e2e"
                      : ag.rota
                        ? "rgba(255,215,0,0.08)"
                        : "rgba(255,255,255,0.02)",
                    color: executando === ag.id
                      ? "#555"
                      : ag.rota
                        ? "#ffd700"
                        : "#444",
                    cursor: ag.rota && executando !== ag.id ? "pointer" : "not-allowed",
                    fontSize: 12,
                    fontWeight: 600,
                    transition: "all .15s",
                  }}
                >
                  {executando === ag.id
                    ? "⏳ Executando..."
                    : ag.rota
                      ? "▶ Executar agora"
                      : "Execução externa"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
