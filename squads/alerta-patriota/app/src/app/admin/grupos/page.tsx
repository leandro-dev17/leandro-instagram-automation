"use client";
import { useEffect, useState } from "react";

type Grupo = { id: number; nome: string; plano: string; link_convite: string; group_id_wa: string; max_membros: number; membros_ativos: number; membros_reais: number; ativo: boolean };

const PLANO_EMOJI: Record<string,string> = { vip:"🔥", elite:"🎖️" };

export default function AdminGrupos() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [editando, setEditando] = useState<Partial<Grupo> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/grupos").then(r => r.json()).then(d => { setGrupos(d.grupos || []); setLoading(false); });
  }, []);

  const salvar = async () => {
    if (!editando) return;
    await fetch("/api/admin/grupos", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify(editando) });
    fetch("/api/admin/grupos").then(r => r.json()).then(d => setGrupos(d.grupos || []));
    setEditando(null);
  };

  return (
    <div style={{ padding: 24, color: "#fff" }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24, color: "#ffd700" }}>📱 Grupos WhatsApp</h1>

      {loading ? <p style={{ color: "#555" }}>Carregando...</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          {grupos.map(g => {
            const pct = Math.round((g.membros_ativos / g.max_membros) * 100);
            const corBarra = pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#22c55e";
            return (
              <div key={g.id} style={{ background: "#111122", border: "1px solid #1e1e2e", borderRadius: 16, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <span style={{ fontSize: 24, marginRight: 8 }}>{PLANO_EMOJI[g.plano]}</span>
                    <span style={{ fontWeight: 800, fontSize: 16 }}>{g.nome}</span>
                  </div>
                  <span style={{ background: g.ativo ? "#14532d" : "#7f1d1d", color: "#fff", fontSize: 10, padding: "3px 8px", borderRadius: 999 }}>{g.ativo ? "ATIVO" : "INATIVO"}</span>
                </div>

                {/* Barra de capacidade */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 4 }}>
                    <span>Capacidade</span>
                    <span>{g.membros_ativos}/{g.max_membros} ({pct}%)</span>
                  </div>
                  <div style={{ background: "#1e1e2e", borderRadius: 4, height: 6 }}>
                    <div style={{ background: corBarra, height: 6, borderRadius: 4, width: `${pct}%`, transition: "width .3s" }} />
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#555", marginBottom: 16, lineHeight: 1.8 }}>
                  <div>ID WA: <span style={{ color: "#aaa" }}>{g.group_id_wa || "—"}</span></div>
                  <div>Link: {g.link_convite ? <a href={g.link_convite} target="_blank" rel="noreferrer" style={{ color: "#22c55e" }}>Abrir</a> : <span>—</span>}</div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setEditando({ ...g })} style={{ flex: 1, background: "#1e1e2e", color: "#aaa", border: "1px solid #2e2e4e", borderRadius: 8, padding: "8px", cursor: "pointer", fontSize: 12 }}>✏️ Editar</button>
                  <a href={g.link_convite || "#"} target="_blank" rel="noreferrer" style={{ flex: 1, background: "#14532d", color: "#fff", borderRadius: 8, padding: "8px", textAlign: "center", textDecoration: "none", fontSize: 12 }}>📲 Entrar</a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal edição */}
      {editando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#111122", border: "1px solid #2e2e4e", borderRadius: 16, padding: 28, width: 400 }}>
            <h3 style={{ marginBottom: 20, color: "#ffd700" }}>Editar {editando.nome}</h3>
            {[
              { label: "Link de convite", key: "link_convite" },
              { label: "Group ID WhatsApp", key: "group_id_wa" },
              { label: "Máx. membros", key: "max_membros" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>{f.label}</label>
                <input value={(editando as Record<string,string|number>)[f.key] || ""} onChange={e => setEditando({ ...editando, [f.key]: e.target.value })}
                  style={{ width: "100%", background: "#0d0d1a", border: "1px solid #2e2e4e", borderRadius: 8, padding: "8px 12px", color: "#fff" }} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={salvar} style={{ flex: 1, background: "#ffd700", color: "#0a0a14", fontWeight: 700, padding: 10, borderRadius: 8, border: "none", cursor: "pointer" }}>Salvar</button>
              <button onClick={() => setEditando(null)} style={{ flex: 1, background: "#1e1e2e", color: "#aaa", padding: 10, borderRadius: 8, border: "1px solid #2e2e4e", cursor: "pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
