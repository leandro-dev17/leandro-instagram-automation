"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PagamentoSucesso() {
  const router = useRouter();
  const [segundos, setSegundos] = useState(10);
  const [premium, setPremium] = useState(false);

  useEffect(() => {
    // Verificar a cada 2s se o webhook já ativou o premium
    const checar = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          const tipo = data.dados?.tipo_usuario;
          if (tipo === "premium" || tipo === "aluna_leandro" || tipo === "admin") {
            setPremium(true);
          }
        }
      } catch { /* ignora */ }
    };

    checar();
    const poll = setInterval(checar, 2500);

    const contador = setInterval(() => {
      setSegundos((s) => {
        if (s <= 1) {
          router.push("/receitas");
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      clearInterval(poll);
      clearInterval(contador);
    };
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <div className="text-6xl mb-4 transition-all">{premium ? "🎉" : "⏳"}</div>

      <h1 className="text-2xl font-bold mb-3" style={{ color: "var(--vovo-marrom)" }}>
        {premium ? "Assinatura ativada! 💕" : "Processando seu pagamento..."}
      </h1>

      <p className="text-sm mb-6 max-w-xs" style={{ color: "var(--vovo-marrom-mid)" }}>
        {premium
          ? "Sua assinatura foi ativada! Aproveite as receitinhas da Vovó Teresinha."
          : "Recebemos seu pagamento! Estamos ativando seu acesso. Isso leva apenas alguns segundinhos 💕"}
      </p>

      {!premium && (
        <div className="flex items-center gap-2 mb-5">
          <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--vovo-rosa)", animationDelay: "0ms" }} />
          <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--vovo-rosa)", animationDelay: "150ms" }} />
          <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--vovo-rosa)", animationDelay: "300ms" }} />
        </div>
      )}

      <p className="text-xs mb-5" style={{ color: "var(--vovo-lock)" }}>
        Redirecionando em {segundos}s...
      </p>

      <button onClick={() => router.push("/receitas")} className="btn-primary">
        Ver receitas agora →
      </button>
    </div>
  );
}
