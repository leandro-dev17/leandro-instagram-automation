"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const WHATSAPP_GROUP = "https://chat.whatsapp.com/EqQVQUAFOe40ZqWgci3fuv";

export default function BemVindaPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState(1);
  const [pushStatus, setPushStatus] = useState<"idle" | "pedindo" | "ok" | "negado">("idle");
  const [isAluno, setIsAluno] = useState(false);
  const [sexo, setSexo] = useState<"M" | "F">("F");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.dados?.tipo_usuario === "aluna_leandro") {
          setIsAluno(true);
          setSexo(data.dados?.sexo === "M" ? "M" : "F");
        }
      })
      .catch(() => {});

    // Enfileira mensagem de boas-vindas via WhatsApp (silencioso, só envia se tiver número)
    fetch("/api/usuarios/boas-vindas-wpp", { method: "POST" }).catch(() => {});
  }, []);

  async function pedirPermissaoPush() {
    setPushStatus("pedindo");
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        setPushStatus("ok");
      } else {
        setPushStatus("negado");
      }
    } catch {
      setPushStatus("negado");
    }
    // Avança para tela do WhatsApp
    setTimeout(() => setEtapa(2), 1200);
  }

  function irParaReceitas() {
    router.push("/receitas");
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--vovo-creme, #f5e6d3)" }}
    >
      {etapa === 1 && (
        <div className="w-full max-w-sm text-center space-y-6">
          {/* Avatar da Vovó */}
          <div className="text-7xl">👵</div>

          <div>
            <h1 className="text-2xl font-bold leading-snug" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
              {isAluno
                ? sexo === "M" ? "Bem-vindo, aluno! 🏋️💪" : "Bem-vinda, aluna! 🏋️🌸"
                : "Bem-vinda, meu amor! 🌸"}
            </h1>
            <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.7 }}>
              {isAluno
                ? sexo === "M"
                  ? "A vovó ficou tão feliz quando o personal favorito dela me contou que você ia vir! O Personal Leandro preparou receitas especiais só para os alunos dele."
                  : "A vovó ficou tão feliz quando o personal favorito dela me contou que você ia vir! O Personal Leandro preparou receitas especiais só para as alunas dele."
                : "A vovó ficou tão feliz que você chegou! Tenho centenas de receitinhas deliciosas esperando por você."}
            </p>
          </div>

          {isAluno && (
            <div
              className="rounded-2xl p-5 text-left"
              style={{ background: "rgba(39,174,96,0.08)", border: "1px solid rgba(39,174,96,0.2)" }}
            >
              <p className="text-sm font-semibold mb-1" style={{ color: "#27ae60" }}>
                🏋️ Área exclusiva desbloqueada!
              </p>
              <p className="text-sm leading-relaxed" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
                {sexo === "M"
                  ? "\"Você já tem acesso completo a todas as receitas, inclusive as do personal. Nada de assinatura — é presente dele pra você!\""
                  : "\"Você já tem acesso completo a todas as receitas, inclusive as do personal. Nada de assinatura — é presente dele pra você!\""}
              </p>
            </div>
          )}

          {!isAluno && (
          <div
            className="rounded-2xl p-5 text-left"
            style={{ background: "rgba(230,126,34,0.08)", border: "1px solid rgba(230,126,34,0.2)" }}
          >
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--vovo-laranja, #e67e22)" }}>
              💌 Um pedidinho da vovó...
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
              &ldquo;Meu amor, posso te mandar uma receitinha nova toda semana? Prometo que vai ser só coisa boa!&rdquo;
            </p>
          </div>
          )}

          <div className="space-y-3">
            <button
              onClick={pedirPermissaoPush}
              disabled={pushStatus === "pedindo"}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-95"
              style={{
                background: "var(--vovo-laranja, #e67e22)",
                color: "white",
                opacity: pushStatus === "pedindo" ? 0.7 : 1,
              }}
            >
              {pushStatus === "pedindo" ? "Aguarde..." :
               pushStatus === "ok" ? "✅ Sim, manda vovó!" :
               "✨ Sim, manda vovó!"}
            </button>
            <button
              onClick={isAluno ? irParaReceitas : () => setEtapa(2)}
              className="w-full py-3 text-sm"
              style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.5 }}
            >
              {isAluno ? "Ir direto para as receitas" : "Agora não"}
            </button>
          </div>
        </div>
      )}

      {etapa === 2 && (
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="text-5xl">💬</div>

          <div>
            <h1 className="text-2xl font-bold leading-snug" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
              Entre no grupo da Vovó! 🌸
            </h1>
            <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.7 }}>
              No grupo a vovó posta receitinhas novas, dicas e bate um papo com todo mundo. Vem fazer parte da família!
            </p>
          </div>

          {/* Card do grupo */}
          <div
            className="rounded-2xl p-5 flex items-center gap-4"
            style={{ background: "#25D366", color: "white" }}
          >
            <div className="text-4xl">👵</div>
            <div className="text-left flex-1">
              <p className="font-bold text-sm">Grupo da Vovó Teresinha</p>
              <p className="text-xs opacity-80 mt-0.5">Receitas, dicas e muito carinho 💕</p>
            </div>
          </div>

          <div className="space-y-3">
            <a
              href={WHATSAPP_GROUP}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95"
              style={{ background: "#25D366", color: "white", display: "flex" }}
            >
              <span>Entrar no grupo da Vovó</span>
              <span>→</span>
            </a>
            <button
              onClick={irParaReceitas}
              className="w-full py-3 text-sm"
              style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.5 }}
            >
              Depois, quero ver as receitas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
