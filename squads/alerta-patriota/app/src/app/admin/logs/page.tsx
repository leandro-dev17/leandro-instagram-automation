"use client";
import { useEffect, useState } from "react";

type Log = { id: number; agente: string; acao: string; status: string; detalhes: Record<string,unknown>; duracao_ms: number; created_at: string };

const STATUS_COR: Record<string,string> = { sucesso:"#22c55e", erro:"#ef4444", aviso:"#f59e0b" };

export default function AdminLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [filtroAgente, setFiltroAgente] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [expandido, setExpandido] = useState<number | null>(null);

  const carregar = () => {
    const p = new URLSearchParams();
    if (filtroAgente) p.set("agente", filtroAgente);
    if (filtroStatus) p.set("status", filtroStatus);
    fetch(`/api/admin/logs?${p}`).then(r => r.json()).then(d => { setLogs(d.logs || []); setTotal(d.total || 0); });
  };

  useEffect(() => { carregar(); }, [filtroAgente, filtroStatus]);

  return (
    <div style={{ padding: 24, color: "#fff" }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 20, color: "#ffd700" }}>📋 Logs do Sistema</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input placeholder="Filtrar por agente..." value={filtroAgente} onChange={e => setFiltroAgente(e.target.value)}
          style={{ background: "#1e1e2e", border: "1px solid #2e2e4e", borderRadius: 8, padding: "8px 14px", color: "#fff", flex: 1, minWidth: 160 }} />
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          style={{ background: "#1e1e2e", border: "1px solid #2e2e4e", borderRadius: 8, padding: "8px 14px", color: "#fff" }}>
          <option value="">Todos os status</option>
          <option value="sucesso">Sucesso</option>
          <option value="erro">Erro</option>
          <option value="aviso">Aviso</option>
        </select>
        <button onClick={carregar} style={{ background: "#ffd700", color: "#0a0a14", fontWeight: 700, padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer" }}>Filtrar</button>
      </div>

      <p style={{ color: "#555", marginBottom: 16, fontSize: 13 }}>{total} registros encontrados</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {logs.map(l => (
          <div key={l.id} style={{ background: "#111122", border: `1px solid ${l.status === "erro" ? "#3f1212" : "#1e1e2e"}`, borderRadius: 10, overflow: "hidden" }}>
            <div onClick={() => setExpandido(expandido === l.id ? null : l.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer" }}>
              <span style={{ color: STATUS_COR[l.status] || "#fff", fontSize: 10, fontWeight: 700, width: 60, flexShrink: 0 }}>{l.status.toUpperCase()}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#ccc", flex: 1 }}>{l.agente}</span>
              <span style={{ fontSize: 12, color: "#777" }}>{l.acao}</span>
              {l.duracao_ms && <span style={{ fontSize: 11, color: "#444" }}>{l.duracao_ms}ms</span>}
              <span style={{ fontSize: 11, color: "#444", flexShrink: 0 }}>{new Date(l.created_at).toLocaleString("pt-BR")}</span>
              <span style={{ color: "#444" }}>{expandido === l.id ? "▲" : "▼"}</span>
            </div>
            {expandido === l.id && l.detalhes && (
              <div style={{ padding: "0 14px 12px", borderTop: "1px solid #1e1e2e" }}>
                <pre style={{ fontSize: 11, color: "#666", overflow: "auto", marginTop: 8, maxHeight: 200 }}>{JSON.stringify(l.detalhes, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
