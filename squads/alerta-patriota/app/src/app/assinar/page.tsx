"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PLANOS = [
  {
    id: "vip",
    nome: "VIP Premium",
    preco: "9,90",
    precoAnual: "99",
    badge: "MAIS COMPLETO",
    cor: "border-red-500",
    corBtn: "bg-red-600 hover:bg-red-500",
    items: [
      "7 entregas/dia (manhã, tarde, noite + extras)",
      "Enquete diária + Resumo da Noite",
      "Alertas urgentes de deputados",
      "Capitão Braga responde suas perguntas",
      "Termômetro da Liberdade semanal",
    ],
  },
  {
    id: "elite",
    nome: "Elite Global",
    preco: "19,90",
    precoAnual: "199",
    badge: "ELITE",
    cor: "border-purple-500",
    corBtn: "bg-purple-700 hover:bg-purple-600",
    items: [
      "8 análises/dia (BR + Internacional)",
      "Prof. Bernardo Cavalcanti exclusivo",
      "Radar Econômico diário",
      "Briefing Internacional matinal",
      "Prof. Cavalcanti responde suas perguntas",
      "Dossiê Semanal em PDF",
      "Análise de Milei, Trump, Elon Musk",
    ],
  },
];

export default function AssinarPage() {
  const [ciclo, setCiclo] = useState<"mensal" | "anual">("mensal");
  const [loading, setLoading] = useState<string | null>(null);
  const [pix, setPix] = useState<{ qr_code: string; qr_code_base64: string; valor: number } | null>(null);
  const router = useRouter();

  async function handleAssinar(planoId: string) {
    setLoading(planoId);
    const cicloFinal = ciclo;

    try {
      // Pix: ciclo anual
      if (cicloFinal === "anual") {
        const nome = prompt("Seu nome completo:") || "Patriota";
        const email = prompt("Seu e-mail:") || "";
        if (!email) { setLoading(null); return; }

        const res = await fetch("/api/assinaturas/criar-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plano: planoId, ciclo: "anual", nome, email }),
        });
        const data = await res.json();
        if (data.qr_code) {
          setPix({ qr_code: data.qr_code, qr_code_base64: data.qr_code_base64, valor: data.valor });
        } else {
          alert("Erro ao gerar Pix. Tente novamente.");
        }
        return;
      }

      // Cartão: ciclo mensal (fluxo original MP)
      const res = await fetch("/api/assinaturas/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: planoId, ciclo: cicloFinal }),
      });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert("Erro ao criar assinatura. Tente novamente.");
      }
    } catch {
      alert("Erro ao processar. Tente novamente.");
    } finally {
      setLoading(null);
    }
  }

  if (pix) {
    return (
      <div style={{ minHeight:"100vh", background:"#0d0d1a", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
        <div style={{ background:"#1a1a2e", border:"1px solid #ffd700", borderRadius:"16px", padding:"40px", maxWidth:"420px", width:"100%", textAlign:"center" }}>
          <div style={{ fontSize:"40px", marginBottom:"12px" }}>🏦</div>
          <h2 style={{ color:"#ffd700", fontSize:"22px", fontWeight:"900", marginBottom:"8px" }}>Pague via Pix</h2>
          <p style={{ color:"#aaa", fontSize:"14px", marginBottom:"24px" }}>
            Valor: <strong style={{ color:"#fff" }}>R$ {pix.valor.toFixed(2).replace(".", ",")}</strong> — acesso anual
          </p>
          {pix.qr_code_base64 && (
            <img src={`data:image/png;base64,${pix.qr_code_base64}`} alt="QR Code Pix"
              style={{ width:"220px", height:"220px", margin:"0 auto 20px", display:"block", borderRadius:"8px" }} />
          )}
          <p style={{ color:"#888", fontSize:"12px", marginBottom:"16px" }}>Copie o código Pix:</p>
          <div style={{ background:"#0d0d1a", border:"1px solid #333", borderRadius:"8px", padding:"12px", marginBottom:"20px" }}>
            <code style={{ color:"#ffd700", fontSize:"11px", wordBreak:"break-all" }}>{pix.qr_code}</code>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(pix.qr_code); alert("Código copiado!"); }}
            style={{ background:"#ffd700", color:"#000", fontWeight:"900", padding:"12px 32px", borderRadius:"8px", border:"none", cursor:"pointer", width:"100%", marginBottom:"12px", fontSize:"16px" }}>
            Copiar Código Pix
          </button>
          <p style={{ color:"#666", fontSize:"12px" }}>Após o pagamento, você receberá o acesso em até 5 minutos.</p>
          <button onClick={() => setPix(null)} style={{ background:"transparent", color:"#666", border:"none", cursor:"pointer", marginTop:"16px", fontSize:"13px" }}>
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">
      {/* Header */}
      <div className="text-center py-12 px-4">
        <p className="text-yellow-400 text-sm font-bold tracking-widest uppercase mb-3">🇧🇷 Alerta Patriota</p>
        <h1 className="text-3xl md:text-5xl font-extrabold mb-4 leading-tight">
          O que a mídia esconde,<br />
          <span className="text-yellow-400">o Capitão Braga revela</span>
        </h1>
        <p className="text-gray-300 text-lg max-w-xl mx-auto">
          Curadoria diária das notícias mais importantes do Brasil — sem filtro, sem censura, direto no seu WhatsApp.
        </p>

        {/* Toggle mensal/anual */}
        <div className="flex items-center justify-center gap-4 mt-8">
          <span className={`text-sm font-medium ${ciclo === "mensal" ? "text-white" : "text-gray-500"}`}>Mensal</span>
          <button
            onClick={() => setCiclo(c => c === "mensal" ? "anual" : "mensal")}
            className={`relative w-14 h-7 rounded-full transition-colors ${ciclo === "anual" ? "bg-yellow-400" : "bg-gray-600"}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${ciclo === "anual" ? "translate-x-7" : "translate-x-0.5"}`} />
          </button>
          <span className={`text-sm font-medium ${ciclo === "anual" ? "text-white" : "text-gray-500"}`}>
            Anual <span className="text-yellow-400 font-bold">2 meses grátis</span>
          </span>
        </div>
      </div>

      {/* Cards de planos */}
      <div className="max-w-3xl mx-auto px-4 pb-16 grid grid-cols-1 md:grid-cols-2 gap-6">
        {PLANOS.map((plano) => {
          const precoExibido = ciclo === "anual" ? `R$${plano.precoAnual}/ano` : `R$${plano.preco}/mês`;

          return (
            <div key={plano.id} className={`relative bg-gray-900 border-2 ${plano.cor} rounded-2xl p-6 flex flex-col`}>
              {plano.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold ${plano.id === "elite" ? "bg-purple-600" : plano.id === "vip" ? "bg-red-600" : "bg-yellow-500 text-gray-900"}`}>
                  {plano.badge}
                </div>
              )}

              <h3 className="text-lg font-bold mt-2 mb-1">{plano.nome}</h3>

              <div className="mb-4">
                <span className="text-3xl font-extrabold text-yellow-400">{precoExibido}</span>
                {ciclo === "mensal" && <p className="text-green-500 text-xs mt-0.5">▸ Experimente 7 dias pagando só R$1</p>}
                {ciclo === "anual" && <p className="text-green-400 text-xs mt-0.5">equivale a R${(Number(plano.precoAnual) / 12).toFixed(2).replace(".", ",")}/mês</p>}
              </div>

              <ul className="space-y-2 flex-1 mb-6">
                {plano.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="text-yellow-400 mt-0.5 shrink-0">✓</span>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleAssinar(plano.id)}
                disabled={loading === plano.id}
                className={`w-full py-3 rounded-xl font-bold text-white transition-colors ${plano.corBtn} disabled:opacity-50`}
              >
                {loading === plano.id ? "Processando..." : "Entrar por R$1"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Prova social */}
      <div className="bg-gray-900 py-12 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-gray-400 text-sm uppercase tracking-widest mb-8">Por que o Alerta Patriota?</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { emoji: "🚨", titulo: "Alertas em Minutos", desc: "Quando Nikolas ou Bolsonaro falam algo importante, você sabe antes de todo mundo" },
              { emoji: "🧠", titulo: "Análise, não só notícia", desc: "O Capitão Braga explica o que está por trás — o que a mídia grande esconde" },
              { emoji: "🇧🇷", titulo: "Comunidade Patriota", desc: "Debate com outros patriotas que pensam como você — sem censura de algoritmo" },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <div className="text-4xl mb-3">{item.emoji}</div>
                <h4 className="font-bold text-white mb-2">{item.titulo}</h4>
                <p className="text-gray-400 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-8 text-gray-600 text-xs px-4">
        <p>Cancele quando quiser • Sem fidelidade • Sem surpresas</p>
        <p className="mt-1 italic">Deus, Pátria e Família — sempre. — Capitão Braga</p>
      </div>
    </div>
  );
}
