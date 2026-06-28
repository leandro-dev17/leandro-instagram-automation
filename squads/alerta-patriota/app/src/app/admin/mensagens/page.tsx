"use client";
import { useState } from "react";

const GRUPOS = [
  { id:"vip",      label:"🔥 VIP Premium",       desc:"Aberto controlado" },
  { id:"elite",    label:"🎖️ Elite Global",      desc:"Seleto" },
];

const TEMPLATES = [
  { label:"🚨 Alerta Urgente",  texto:"🚨 *URGENTE — ALERTA PATRIOTA*\n\n[Descreva o acontecimento urgente aqui]\n\n_Capitão Braga — Deus, Pátria e Família._" },
  { label:"📢 Aviso do Admin",  texto:"📢 *AVISO IMPORTANTE*\n\n[Escreva seu aviso aqui]\n\n_Equipe Alerta Patriota_" },
  { label:"🎉 Promoção",        texto:"🎉 *OFERTA ESPECIAL para membros do grupo!*\n\n[Descreva a oferta aqui]\n\n_Válido por tempo limitado_ · alertapatriota.vercel.app/assinar" },
  { label:"🌙 Boa noite",       texto:"🌙 *Boa noite, patriotas!*\n\nO dia foi intenso. Mas o Capitão Braga está de olho em tudo.\n\nAmanhã, mais informações essenciais chegam no grupo.\n\n_Deus, Pátria e Família — sempre._" },
];

function PreviewWPP({ texto }: { texto: string }) {
  const linhas = texto.split("\n");
  return (
    <div style={{ background:"#1a2a1a", borderRadius:12, padding:14, maxWidth:320, fontFamily:"sans-serif", fontSize:13, lineHeight:1.5 }}>
      <div style={{ background:"#2a4a2a", borderRadius:8, padding:"10px 12px", position:"relative" }}>
        {linhas.map((l, i) => {
          if (!l) return <br key={i} />;
          let texto = l;
          // Bold
          texto = texto.replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
          // Italic
          texto = texto.replace(/_([^_]+)_/g, "<em style='color:#aaa'>$1</em>");
          return <div key={i} dangerouslySetInnerHTML={{ __html: texto }} />;
        })}
        <div style={{ fontSize:10, color:"#555", textAlign:"right", marginTop:6 }}>
          {new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" })} ✓✓
        </div>
      </div>
    </div>
  );
}

export default function AdminMensagens() {
  const [grupo, setGrupo] = useState("vip");
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok?: boolean; erro?: string } | null>(null);
  const [chars, setChars] = useState(0);

  const handleTexto = (v: string) => { setMensagem(v); setChars(v.length); };
  const usarTemplate = (texto: string) => handleTexto(texto);

  const enviar = async () => {
    if (!mensagem.trim()) return;
    // Item 24 (Fase 30): clique disparava direto pro grupo (centenas de assinantes
    // pagantes) sem nenhuma confirmação — um clique acidental ou template errado
    // selecionado virava envio irreversível em massa.
    const grupoLabel = GRUPOS.find(g => g.id === grupo)?.label ?? grupo;
    const confirmado = window.confirm(
      `Enviar esta mensagem agora para o grupo ${grupoLabel}?\n\nEssa ação é imediata e irreversível.`
    );
    if (!confirmado) return;
    setEnviando(true);
    setResultado(null);
    const res = await fetch("/api/admin/mensagem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grupo, mensagem }),
    });
    const d = await res.json();
    setResultado(d);
    if (d.ok) setMensagem("");
    setEnviando(false);
  };

  return (
    <div style={{ padding:24, color:"#fff" }}>
      <h1 style={{ fontSize:22, fontWeight:900, color:"#ffd700", marginBottom:24 }}>📲 Envio Manual de Mensagem</h1>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>
        {/* Editor */}
        <div>
          {/* Grupo */}
          <p style={{ fontSize:11, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Grupo de destino</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
            {GRUPOS.map(g => (
              <button key={g.id} onClick={() => setGrupo(g.id)} style={{
                background: grupo===g.id ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.03)",
                border: grupo===g.id ? "1px solid rgba(255,215,0,0.4)" : "1px solid rgba(255,255,255,0.07)",
                borderRadius:10, padding:"10px 12px", cursor:"pointer", textAlign:"left",
              }}>
                <p style={{ fontSize:13, fontWeight:700, color:grupo===g.id?"#ffd700":"#ccc" }}>{g.label}</p>
                <p style={{ fontSize:10, color:"#555", marginTop:2 }}>{g.desc}</p>
              </button>
            ))}
          </div>

          {/* Templates */}
          <p style={{ fontSize:11, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Templates rápidos</p>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
            {TEMPLATES.map(t => (
              <button key={t.label} onClick={() => usarTemplate(t.texto)} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#aaa", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:11 }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Textarea */}
          <p style={{ fontSize:11, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Mensagem <span style={{ color:"#333" }}>(*negrito* _itálico_)</span></p>
          <textarea
            value={mensagem} onChange={e => handleTexto(e.target.value)}
            placeholder="Digite a mensagem... Use *negrito* e _itálico_ como no WhatsApp."
            rows={10}
            style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"12px 14px", color:"#fff", fontSize:13, resize:"vertical", outline:"none", fontFamily:"monospace", boxSizing:"border-box" }}
          />
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
            <span style={{ fontSize:11, color:"#333" }}>{chars} caracteres</span>
            <button onClick={enviar} disabled={!mensagem.trim() || enviando} style={{
              background: mensagem.trim() ? "#ffd700" : "#1e1e2e",
              color: mensagem.trim() ? "#0a0a14" : "#444",
              fontWeight:900, fontSize:14, padding:"10px 24px", borderRadius:10, border:"none", cursor:mensagem.trim() ? "pointer" : "not-allowed",
            }}>
              {enviando ? "Enviando..." : "📲 Enviar Agora"}
            </button>
          </div>

          {resultado && (
            <div style={{ marginTop:12, padding:"10px 14px", borderRadius:8, background:resultado.ok?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)", border:`1px solid ${resultado.ok?"rgba(34,197,94,0.3)":"rgba(239,68,68,0.3)"}`, fontSize:13, color:resultado.ok?"#22c55e":"#ef4444" }}>
              {resultado.ok ? "✅ Mensagem enviada com sucesso!" : `❌ Erro: ${resultado.erro}`}
            </div>
          )}
        </div>

        {/* Preview */}
        <div>
          <p style={{ fontSize:11, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>Preview no WhatsApp</p>
          <div style={{ background:"#0a1a0a", borderRadius:14, padding:16, minHeight:200 }}>
            {mensagem ? <PreviewWPP texto={mensagem} /> : (
              <p style={{ color:"#2a3a2a", fontSize:13, padding:"20px 0" }}>Digite uma mensagem para ver o preview...</p>
            )}
          </div>
          <div style={{ marginTop:12, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"10px 14px" }}>
            <p style={{ fontSize:11, color:"#555", marginBottom:6 }}>FORMATAÇÃO WHATSAPP</p>
            {[["*texto*","**negrito**"],["_texto_","_itálico_"],["~texto~","~~riscado~~"]].map(([e,d]) => (
              <div key={e} style={{ display:"flex", gap:8, fontSize:12, color:"#444", marginBottom:3 }}>
                <span style={{ fontFamily:"monospace", color:"#666" }}>{e}</span>
                <span>→</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
