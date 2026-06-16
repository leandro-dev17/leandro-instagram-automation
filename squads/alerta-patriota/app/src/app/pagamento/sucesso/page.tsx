"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const STEPS = [
  { num: 1, text: "Clique no botão verde abaixo" },
  { num: 2, text: "Abra o WhatsApp e confirme a entrada" },
  { num: 3, text: "Pronto! Você já recebe as notícias" },
];

function SucessoContent() {
  const params = useSearchParams();
  const [linkGrupo, setLinkGrupo] = useState("");
  const [plano, setPlano] = useState("vip");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const p = params.get("plano") || localStorage.getItem("ap_plano") || "vip";
    setPlano(p);
    const links: Record<string, string> = {
      vip: process.env.NEXT_PUBLIC_WPP_LINK_VIP || "#",
      elite: process.env.NEXT_PUBLIC_WPP_LINK_ELITE || "#",
    };
    setLinkGrupo(links[p] || links.vip);
    setMounted(true);
  }, [params]);

  const isElite = plano === "elite";
  const planoBadge = isElite ? "ELITE GLOBAL" : "VIP PREMIUM";
  const personaFoto = isElite ? "/prof-cavalcanti.png" : "/capitao-braga.png";
  const personaNome = isElite ? "Prof. Bernardo Cavalcanti" : "Capitão Braga";
  const personaFrase = isElite
    ? "Bem-vindo à vanguarda do pensamento conservador. Aqui você entende o mundo antes que a mídia distorça. O mundo muda para quem enxerga antes."
    : "Bem-vindo à família, patriota. Aqui você vai ficar sabendo de tudo — sem filtro e sem censura. Deus, Pátria e Família — sempre.";

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse-green {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
          50%       { box-shadow: 0 0 0 18px rgba(34,197,94,0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .fade-up-1 { animation: fadeUp 0.5s ease 0.1s both; }
        .fade-up-2 { animation: fadeUp 0.5s ease 0.25s both; }
        .fade-up-3 { animation: fadeUp 0.5s ease 0.4s both; }
        .fade-up-4 { animation: fadeUp 0.5s ease 0.55s both; }
        .fade-up-5 { animation: fadeUp 0.5s ease 0.7s both; }
        .scale-in  { animation: scaleIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.05s both; }
        .btn-wpp   { animation: pulse-green 2s ease-in-out 1.2s infinite; }
        .badge-shimmer {
          background: linear-gradient(90deg, #facc15 0%, #fef08a 40%, #facc15 60%, #ca8a04 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
      `}</style>

      <div
        style={{ background: "linear-gradient(160deg, #0a0a1a 0%, #0f172a 50%, #0a0a1a 100%)" }}
        className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden"
      >
        {/* Decorative glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-10 pointer-events-none"
          style={{ background: "radial-gradient(ellipse, #facc15 0%, transparent 70%)" }} />

        {/* Badge do plano */}
        <div className="scale-in mb-6">
          <span className="inline-flex items-center gap-2 bg-yellow-400/10 border border-yellow-400/40 rounded-full px-5 py-1.5 text-xs font-bold tracking-widest uppercase badge-shimmer">
            {isElite ? "🎖️" : "🔥"} {planoBadge} ATIVADO
          </span>
        </div>

        {/* Check circle */}
        <div className="scale-in mb-6">
          <div className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #16a34a, #22c55e)", boxShadow: "0 0 40px rgba(34,197,94,0.4)" }}>
            <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        {/* Título */}
        <div className="fade-up-1 text-center mb-3">
          <h1 className="text-4xl sm:text-5xl font-black text-yellow-400 tracking-tight leading-tight"
            style={{ fontFamily: "var(--font-bebas, 'Bebas Neue', sans-serif)", letterSpacing: "0.05em" }}>
            BEM-VINDO, PATRIOTA!
          </h1>
        </div>

        {/* Subtítulo */}
        <div className="fade-up-2 text-center mb-8 max-w-md">
          <p className="text-gray-300 text-base sm:text-lg leading-relaxed">
            Sua assinatura foi ativada. Entre agora no grupo e comece a receber as notícias que a mídia esconde.
          </p>
        </div>

        {/* CTA WhatsApp */}
        <div className="fade-up-3 w-full max-w-sm mb-8">
          {mounted && (
            <a
              href={linkGrupo}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-wpp flex items-center justify-center gap-3 w-full rounded-2xl font-bold text-lg text-white py-5 transition-transform hover:scale-105 active:scale-95"
              style={{ background: "linear-gradient(135deg, #16a34a, #22c55e)", boxShadow: "0 4px 24px rgba(34,197,94,0.35)" }}
            >
              <svg className="w-7 h-7 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.555 4.116 1.524 5.847L.057 23.882a.5.5 0 00.614.625l6.218-1.633A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.792 9.792 0 01-5.044-1.396l-.362-.215-3.692.97.986-3.603-.236-.372A9.818 9.818 0 012.182 12C2.182 6.562 6.562 2.182 12 2.182S21.818 6.562 21.818 12 17.438 21.818 12 21.818z"/>
              </svg>
              Entrar no Grupo WhatsApp
            </a>
          )}
        </div>

        {/* Passos */}
        <div className="fade-up-4 w-full max-w-sm mb-8">
          <p className="text-xs font-bold tracking-widest text-gray-500 uppercase text-center mb-4">Como entrar</p>
          <div className="flex flex-col gap-3">
            {STEPS.map((s) => (
              <div key={s.num} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <span className="w-7 h-7 rounded-full bg-yellow-400/20 border border-yellow-400/40 text-yellow-400 text-xs font-black flex items-center justify-center flex-shrink-0">
                  {s.num}
                </span>
                <span className="text-gray-300 text-sm">{s.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quote Capitão Braga / Prof Cavalcanti */}
        <div className="fade-up-5 w-full max-w-sm">
          <div className="rounded-2xl p-5 border"
            style={{
              background: "linear-gradient(135deg, rgba(250,204,21,0.06), rgba(250,204,21,0.02))",
              borderColor: "rgba(250,204,21,0.2)",
            }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-yellow-400/20 border border-yellow-400/30 flex items-center justify-center text-lg flex-shrink-0">
                {isElite ? "🎖️" : "🎯"}
              </div>
              <span className="text-yellow-400 font-bold text-sm">{personaNome}</span>
            </div>
            <p className="text-gray-300 text-sm italic leading-relaxed">
              &ldquo;{personaFrase}&rdquo;
            </p>
          </div>
        </div>

        {/* Rodapé */}
        <p className="mt-8 text-gray-600 text-xs text-center max-w-xs">
          Você também receberá um e-mail de boas-vindas com o link do grupo.
        </p>
      </div>
    </>
  );
}

export default function PagamentoSucessoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a1a" }}>
        <div className="text-yellow-400 text-lg font-bold animate-pulse">Carregando...</div>
      </div>
    }>
      <SucessoContent />
    </Suspense>
  );
}
