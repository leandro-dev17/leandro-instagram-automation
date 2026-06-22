"use client";
import { useEffect, useState } from "react";

type Noticia = { id: number; titulo: string; fonte: string; url: string; categoria: string; urgente: boolean; global: boolean; postada_vip: boolean; postada_elite: boolean; tem_resumo_braga: boolean; tem_resumo_cavalcanti: boolean; created_at: string };

export default function AdminNoticias() {
  const [noticias, setNoticias] = useState<Noticia[]>([]);
  const [filtroStatus, setFiltroStatus] = useState("");
  const [editando, setEditando] = useState<{id:number;resumo_braga?:string;resumo_cavalcanti?:string;urgente?:boolean}|null>(null);

  const carregar = () => {
    const p = filtroStatus ? `?status=${filtroStatus}` : "";
    fetch(`/api/admin/noticias${p}`).then(r => r.json()).then(d => setNoticias(d.noticias || []));
  };

  useEffect(() => { carregar(); }, [filtroStatus]);

  const salvar = async () => {
    if (!editando) return;
    await fetch("/api/admin/noticias", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify(editando) });
    setEditando(null);
    carregar();
  };

  const pub = (n: Noticia) => {
    const total = 2;
    const ok = [n.postada_vip, n.postada_elite].filter(Boolean).length;
    return `${ok}/${total}`;
  };

  return (
    <div style={{ padding: 24, color: "#fff" }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 20, color: "#ffd700" }}>📰 Central de Conteúdo</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {["", "pendente", "publicada"].map(s => (
          <button key={s} onClick={() => setFiltroStatus(s)}
            style={{ background: filtroStatus === s ? "#ffd700" : "#1e1e2e", color: filtroStatus === s ? "#0a0a14" : "#aaa", border: "1px solid #2e2e4e", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: filtroStatus === s ? 700 : 400 }}>
            {s === "" ? "Todas" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {noticias.map(n => (
          <div key={n.id} style={{ background: "#111122", border: `1px solid ${n.urgente ? "#7f1d1d" : "#1e1e2e"}`, borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  {n.urgente && <span style={{ background: "#7f1d1d", color: "#fff", fontSize: 9, padding: "2px 6px", borderRadius: 999, fontWeight: 700 }}>URGENTE</span>}
                  {n.global && <span style={{ background: "#1e3a5f", color: "#60a5fa", fontSize: 9, padding: "2px 6px", borderRadius: 999, fontWeight: 700 }}>GLOBAL</span>}
                  <span style={{ color: "#555", fontSize: 10 }}>{n.fonte}</span>
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, lineHeight: 1.4 }}>{n.titulo}</p>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["V", n.postada_vip], ["E", n.postada_elite]].map(([l, ok]) => (
                    <span key={String(l)} style={{ fontSize: 10, color: ok ? "#22c55e" : "#333", fontWeight: 700 }}>{String(l)}{ok ? "✓" : "✗"}</span>
                  ))}
                  <span style={{ fontSize: 10, color: n.tem_resumo_braga ? "#22c55e" : "#666", marginLeft: 8 }}>Braga {n.tem_resumo_braga ? "✓" : "✗"}</span>
                  <span style={{ fontSize: 10, color: n.tem_resumo_cavalcanti ? "#a855f7" : "#666" }}>Cavalcanti {n.tem_resumo_cavalcanti ? "✓" : "✗"}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEditando({ id: n.id, urgente: n.urgente })}
                  style={{ background: "#1e1e2e", color: "#aaa", border: "1px solid #2e2e4e", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>✏️ Editar</button>
                {n.url && <a href={n.url} target="_blank" rel="noreferrer" style={{ background: "#0a1a2e", color: "#60a5fa", border: "1px solid #1e3a5f", borderRadius: 6, padding: "4px 10px", fontSize: 11, textAlign: "center", textDecoration: "none" }}>🔗 Ver</a>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 20 }}>
          <div style={{ background: "#111122", border: "1px solid #2e2e4e", borderRadius: 16, padding: 24, width: "100%", maxWidth: 600 }}>
            <h3 style={{ marginBottom: 16, color: "#ffd700" }}>Editar Notícia #{editando.id}</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13 }}>
              <input type="checkbox" checked={editando.urgente || false} onChange={e => setEditando({...editando, urgente: e.target.checked})} />
              Marcar como Urgente
            </label>
            <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Resumo Capitão Braga</label>
            <textarea value={editando.resumo_braga || ""} onChange={e => setEditando({...editando, resumo_braga: e.target.value})} rows={4}
              placeholder="Deixe vazio para manter o atual"
              style={{ width: "100%", background: "#0d0d1a", border: "1px solid #2e2e4e", borderRadius: 8, padding: "8px 12px", color: "#fff", marginBottom: 12, resize: "vertical" }} />
            <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Resumo Prof. Cavalcanti</label>
            <textarea value={editando.resumo_cavalcanti || ""} onChange={e => setEditando({...editando, resumo_cavalcanti: e.target.value})} rows={4}
              placeholder="Deixe vazio para manter o atual"
              style={{ width: "100%", background: "#0d0d1a", border: "1px solid #2e2e4e", borderRadius: 8, padding: "8px 12px", color: "#fff", marginBottom: 16, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={salvar} style={{ flex: 1, background: "#ffd700", color: "#0a0a14", fontWeight: 700, padding: 10, borderRadius: 8, border: "none", cursor: "pointer" }}>Salvar</button>
              <button onClick={() => setEditando(null)} style={{ flex: 1, background: "#1e1e2e", color: "#aaa", padding: 10, borderRadius: 8, border: "1px solid #2e2e4e", cursor: "pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
