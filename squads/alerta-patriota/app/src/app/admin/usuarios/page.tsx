"use client";
import { useEffect, useState, useCallback } from "react";

type Usuario = { id: number; nome: string; email: string; telefone: string; plano: string; status: string; tipo_usuario: string; created_at: string };

const PLANO_COR: Record<string,string> = { vip:"#dc2626", elite:"#7c3aed" };
const STATUS_COR: Record<string,string> = { ativo:"#22c55e", trial:"#3b82f6", inadimplente:"#f59e0b", cancelado:"#ef4444" };

export default function AdminUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [total, setTotal] = useState(0);
  const [filtroPlano, setFiltroPlano] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [acaoMassa, setAcaoMassa] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (filtroPlano) p.set("plano", filtroPlano);
    if (filtroStatus) p.set("status", filtroStatus);
    if (busca) p.set("busca", busca);
    const res = await fetch(`/api/admin/usuarios?${p}`);
    const d = await res.json();
    setUsuarios(d.usuarios || []);
    setTotal(d.total || 0);
    setLoading(false);
    setSelecionados([]);
  }, [filtroPlano, filtroStatus, busca]);

  useEffect(() => { carregar(); }, [filtroPlano, filtroStatus]);

  const executarAcao = async (id: number, tipo: string, extra?: Record<string,string>) => {
    await fetch(`/api/admin/usuarios/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ acao:tipo, ...extra }) });
    carregar();
  };

  const excluirDados = async (id: number) => {
    if (!window.confirm("Anonimizar permanentemente os dados pessoais deste usuário (LGPD)? Essa ação não pode ser desfeita.")) return;
    await executarAcao(id, "excluir_dados");
  };

  const executarMassa = async () => {
    if (!acaoMassa || !selecionados.length) return;
    for (const id of selecionados) await executarAcao(id, acaoMassa);
    setAcaoMassa("");
  };

  const toggleSel = (id: number) => setSelecionados(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  const toggleTodos = () => setSelecionados(selecionados.length===usuarios.length ? [] : usuarios.map(u=>u.id));

  return (
    <div style={{ padding:24, color:"#fff" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <h1 style={{ fontSize:22, fontWeight:900, color:"#ffd700" }}>👥 Gestão de Membros</h1>
        <button onClick={() => window.open("/api/admin/exportar?tipo=membros","_blank")} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#aaa", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:12 }}>⬇️ Exportar CSV</button>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <input placeholder="🔍 Buscar por nome ou e-mail..." value={busca} onChange={e => setBusca(e.target.value)}
          onKeyDown={e => e.key==="Enter" && carregar()}
          style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 14px", color:"#fff", flex:1, minWidth:200, outline:"none", fontSize:13 }} />
        <select value={filtroPlano} onChange={e => setFiltroPlano(e.target.value)}
          style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", color:"#fff", fontSize:13 }}>
          <option value="">Todos os planos</option>
          {["vip","elite"].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", color:"#fff", fontSize:13 }}>
          <option value="">Todos os status</option>
          {["ativo","trial","inadimplente","cancelado"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={carregar} style={{ background:"#ffd700", color:"#0a0a14", fontWeight:700, padding:"8px 16px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13 }}>Filtrar</button>
      </div>

      {selecionados.length > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, background:"rgba(255,215,0,0.08)", border:"1px solid rgba(255,215,0,0.2)", borderRadius:10, padding:"10px 14px", flexWrap:"wrap" }}>
          <span style={{ fontSize:13, color:"#ffd700", fontWeight:700 }}>{selecionados.length} selecionados</span>
          <select value={acaoMassa} onChange={e => setAcaoMassa(e.target.value)}
            style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, padding:"5px 10px", color:"#fff", fontSize:12 }}>
            <option value="">Ação em massa...</option>
            <option value="cancelar">Cancelar todos</option>
            <option value="reativar">Reativar todos</option>
          </select>
          <button onClick={executarMassa} disabled={!acaoMassa} style={{ background:acaoMassa?"#ef4444":"#1e1e2e", color:"#fff", fontWeight:700, padding:"5px 14px", borderRadius:6, border:"none", cursor:acaoMassa?"pointer":"not-allowed", fontSize:12 }}>Aplicar</button>
          <button onClick={() => setSelecionados([])} style={{ color:"#555", background:"transparent", border:"none", cursor:"pointer", fontSize:11 }}>Limpar seleção</button>
        </div>
      )}

      <p style={{ color:"#333", marginBottom:12, fontSize:12 }}>{total} membros encontrados</p>

      {loading ? <p style={{ color:"#555" }}>Carregando...</p> : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"rgba(255,255,255,0.04)" }}>
                <th style={{ padding:"10px", width:36 }}>
                  <input type="checkbox" checked={selecionados.length===usuarios.length&&usuarios.length>0} onChange={toggleTodos} />
                </th>
                {["Nome","E-mail","Plano","Status","Desde","Ações"].map(h => (
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", color:"#555", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u, i) => (
                <tr key={u.id} style={{ background:selecionados.includes(u.id)?"rgba(255,215,0,0.04)":i%2===0?"rgba(255,255,255,0.01)":"transparent", borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
                  <td style={{ padding:"8px 10px", textAlign:"center" }}>
                    <input type="checkbox" checked={selecionados.includes(u.id)} onChange={() => toggleSel(u.id)} />
                  </td>
                  <td style={{ padding:"8px 12px", fontWeight:600 }}>{u.nome}</td>
                  <td style={{ padding:"8px 12px", color:"#777", fontSize:11 }}>{u.email}</td>
                  <td style={{ padding:"8px 12px" }}>
                    <span style={{ background:`${PLANO_COR[u.plano]||"#333"}22`, color:PLANO_COR[u.plano]||"#fff", padding:"2px 8px", borderRadius:999, fontSize:10, fontWeight:700 }}>{u.plano||"—"}</span>
                  </td>
                  <td style={{ padding:"8px 12px" }}>
                    <span style={{ color:STATUS_COR[u.status]||"#fff", fontWeight:600, fontSize:11 }}>{u.status}</span>
                  </td>
                  <td style={{ padding:"8px 12px", color:"#444", fontSize:11 }}>{new Date(u.created_at).toLocaleDateString("pt-BR")}</td>
                  <td style={{ padding:"8px 12px" }}>
                    <div style={{ display:"flex", gap:4 }}>
                      {u.status!=="cancelado"
                        ? <button onClick={() => executarAcao(u.id,"cancelar")} style={{ background:"rgba(239,68,68,0.15)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.3)", padding:"3px 8px", borderRadius:5, cursor:"pointer", fontSize:10 }}>Cancelar</button>
                        : <button onClick={() => executarAcao(u.id,"reativar")} style={{ background:"rgba(34,197,94,0.15)", color:"#22c55e", border:"1px solid rgba(34,197,94,0.3)", padding:"3px 8px", borderRadius:5, cursor:"pointer", fontSize:10 }}>Reativar</button>
                      }
                      <select onChange={e => { if(e.target.value){executarAcao(u.id,"mudar_plano",{plano:e.target.value});e.target.value="";}}}
                        style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#666", borderRadius:5, padding:"3px 4px", fontSize:10 }}>
                        <option value="">↑ Plano</option>
                        {["vip","elite"].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      {u.status!=="excluido" && (
                        <button onClick={() => excluirDados(u.id)} title="Anonimizar dados pessoais (LGPD)" style={{ background:"rgba(255,255,255,0.05)", color:"#666", border:"1px solid rgba(255,255,255,0.1)", padding:"3px 8px", borderRadius:5, cursor:"pointer", fontSize:10 }}>🗑️ Excluir dados</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
