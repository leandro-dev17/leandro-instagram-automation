"use client";
import { useEffect, useState } from "react";

type Prompts = {
  braga_vip: string; cavalcanti: string;
};

type Padroes = Record<string, string>;

const LABELS: Record<string, { label: string; cor: string; desc: string }> = {
  braga_vip:      { label:"🔥 Capitão Braga — VIP",       cor:"#dc2626",desc:"5-7 linhas, análise profunda" },
  cavalcanti:     { label:"🎖️ Prof. Cavalcanti — Elite",  cor:"#7c3aed",desc:"5-7 linhas, perspectiva global" },
};

export default function AdminPrompts() {
  const [prompts, setPrompts] = useState<Prompts | null>(null);
  const [padroes, setPadroes] = useState<Padroes>({});
  const [editando, setEditando] = useState<{ chave: string; valor: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/admin/prompts").then(r => r.json()).then(d => { setPrompts(d.prompts); setPadroes(d.padroes || {}); });
  }, []);

  const salvar = async () => {
    if (!editando) return;
    setSalvando(true);
    const res = await fetch("/api/admin/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editando),
    });
    const d = await res.json();
    if (d.ok) {
      setPrompts(prev => prev ? { ...prev, [editando.chave]: editando.valor } : null);
      setMsg("✅ Prompt salvo! Próximas notícias usarão este texto.");
      setEditando(null);
    } else {
      setMsg(`❌ Erro: ${d.erro}`);
    }
    setSalvando(false);
    setTimeout(() => setMsg(""), 4000);
  };

  if (!prompts) return <div style={{ padding:24, color:"#555" }}>Carregando prompts...</div>;

  return (
    <div style={{ padding:24, color:"#fff" }}>
      <h1 style={{ fontSize:22, fontWeight:900, color:"#ffd700", marginBottom:8 }}>🧠 Editor de Prompts das Personas</h1>
      <p style={{ color:"#555", fontSize:13, marginBottom:24 }}>Edite o tom de voz do Capitão Braga e do Prof. Cavalcanti. Mudanças aplicadas imediatamente nas próximas notícias geradas.</p>

      {msg && (
        <div style={{ background:msg.startsWith("✅")?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)", border:`1px solid ${msg.startsWith("✅")?"rgba(34,197,94,0.3)":"rgba(239,68,68,0.3)"}`, borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:13, color:msg.startsWith("✅")?"#22c55e":"#ef4444" }}>
          {msg}
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        {Object.entries(prompts).map(([chave, valor]) => {
          const meta = LABELS[chave];
          const isEditando = editando?.chave === chave;
          return (
            <div key={chave} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${meta?.cor || "#fff"}22`, borderRadius:14, padding:20 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12, gap:12 }}>
                <div>
                  <p style={{ fontSize:14, fontWeight:700, color:meta?.cor || "#fff" }}>{meta?.label || chave}</p>
                  <p style={{ fontSize:11, color:"#444", marginTop:2 }}>{meta?.desc} · {valor.length} caracteres</p>
                </div>
                <button onClick={() => setEditando(isEditando ? null : { chave, valor })}
                  style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#aaa", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:12, flexShrink:0 }}>
                  {isEditando ? "Cancelar" : "✏️ Editar"}
                </button>
              </div>

              {isEditando ? (
                <>
                  <textarea value={editando.valor} onChange={e => setEditando({ ...editando, valor: e.target.value })} rows={8}
                    style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:8, padding:"10px 12px", color:"#fff", fontSize:12, resize:"vertical", outline:"none", fontFamily:"monospace", boxSizing:"border-box", lineHeight:1.6 }} />
                  <div style={{ display:"flex", gap:8, marginTop:10 }}>
                    <button onClick={salvar} disabled={salvando} style={{ background:meta?.cor||"#ffd700", color:"#0a0a14", fontWeight:900, padding:"8px 20px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13 }}>
                      {salvando ? "Salvando..." : "💾 Salvar Prompt"}
                    </button>
                    {/* FASE 24: usava Object.values(LABELS)[0]?.label (string de UI, ex:
                        "🔥 Capitão Braga — VIP") como se fosse o prompt padrão a restaurar —
                        substituía o prompt customizado por um texto sem sentido semântico ao
                        salvar. O prompt padrão real vem de GET /api/admin/prompts → padroes. */}
                    <button onClick={() => setEditando({ chave, valor: padroes[chave] ?? valor })}
                      style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#666", padding:"8px 14px", borderRadius:8, cursor:"pointer", fontSize:12 }}>
                      ↩️ Restaurar padrão
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#666", fontFamily:"monospace", lineHeight:1.6, whiteSpace:"pre-wrap", maxHeight:100, overflow:"hidden", position:"relative" }}>
                  {valor.substring(0, 300)}...
                  <div style={{ position:"absolute", bottom:0, left:0, right:0, height:30, background:"linear-gradient(to bottom, transparent, rgba(0,0,0,0.5))" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop:24, background:"rgba(255,215,0,0.05)", border:"1px solid rgba(255,215,0,0.15)", borderRadius:12, padding:16 }}>
        <p style={{ fontSize:12, color:"#ffd700", fontWeight:700, marginBottom:6 }}>💡 Dicas para um bom prompt</p>
        <ul style={{ fontSize:12, color:"#666", lineHeight:1.8, paddingLeft:16 }}>
          <li>Sempre inclua a frase de assinatura no final (Deus, Pátria e Família / O mundo muda...)</li>
          <li>Especifique o número de linhas desejado</li>
          <li>Diga explicitamente para NÃO copiar o texto original</li>
          <li>Mencione o tom: direto, indignado, analítico, etc.</li>
        </ul>
      </div>
    </div>
  );
}
