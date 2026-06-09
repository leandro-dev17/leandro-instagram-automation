"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Assinante = {
  id: number;
  nome: string;
  email: string;
  whatsapp: string | null;
  plano: string | null;
  trial_fim: string | null;
  tipo_usuario: string;
};

type FinanceiroDados = {
  receita_periodo: number;
  pagamentos_periodo: number;
  assinaturas_por_plano: { plano: string; count: string; total: string }[];
  total_assinantes: number;
  assinantes: Assinante[];
};

const TIPO_COR: Record<string, string> = {
  premium: "#16a34a",
  aluna_leandro: "#0284c7",
};

export default function AdminFinanceiroPage() {
  const [dados, setDados] = useState<FinanceiroDados | null>(null);
  const [periodo, setPeriodo] = useState("30");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    fetch(`/api/admin/financeiro?periodo=${periodo}`)
      .then((r) => r.json())
      .then((data) => { setDados(data.dados ?? null); setCarregando(false); })
      .catch(() => setCarregando(false));
  }, [periodo]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center gap-3 shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <Link href="/admin" className="text-white text-lg">←</Link>
        <span className="text-white font-bold">📊 Financeiro & Assinantes</span>
      </header>

      <div className="px-4 pt-4 pb-8 max-w-3xl mx-auto">
        <div className="flex gap-2 mb-4">
          {["7", "30", "90"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: periodo === p ? "var(--vovo-marrom)" : "white",
                color: periodo === p ? "white" : "var(--vovo-marrom)",
                border: "1.5px solid",
                borderColor: periodo === p ? "var(--vovo-marrom)" : "#e5e0da",
              }}
            >
              {p} dias
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">📊</div></div>
        ) : !dados ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>Não foi possível carregar dados financeiros.</p>
            <button onClick={() => window.location.reload()} className="btn-primary mt-3 text-sm">Tentar novamente</button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Stats cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="card text-center py-3">
                <div className="text-xl font-bold" style={{ color: "var(--vovo-verde)" }}>
                  R${(dados.receita_periodo || 0).toFixed(2)}
                </div>
                <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Receita {periodo}d</div>
              </div>
              <div className="card text-center py-3">
                <div className="text-xl font-bold" style={{ color: "var(--vovo-marrom)" }}>{dados.total_assinantes}</div>
                <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Assinantes</div>
              </div>
              <div className="card text-center py-3">
                <div className="text-xl font-bold" style={{ color: "var(--vovo-rosa)" }}>{dados.pagamentos_periodo}</div>
                <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Pagamentos</div>
              </div>
            </div>

            {/* Assinantes list */}
            <div className="card">
              <h3 className="font-bold mb-3 flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
                ✅ Assinantes ativos ({dados.assinantes?.length ?? 0})
              </h3>
              {(!dados.assinantes || dados.assinantes.length === 0) ? (
                <p className="text-sm text-center py-4" style={{ color: "var(--vovo-lock)" }}>Nenhum assinante ainda</p>
              ) : (
                <div className="space-y-2">
                  {dados.assinantes.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0" style={{ borderColor: "#f0ebe5" }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--vovo-marrom)" }}>{a.nome}</p>
                        <p className="text-xs truncate" style={{ color: "var(--vovo-marrom-mid)" }}>{a.email}</p>
                        {a.whatsapp && (
                          <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>📱 {a.whatsapp}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: `${TIPO_COR[a.tipo_usuario] ?? "#888"}20`,
                            color: TIPO_COR[a.tipo_usuario] ?? "#888",
                          }}
                        >
                          {a.tipo_usuario === "aluna_leandro" ? "Aluna Personal" : "Premium"}
                        </span>
                        {a.plano && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--vovo-lock)" }}>{a.plano}</p>
                        )}
                        {a.trial_fim && new Date(a.trial_fim) > new Date() && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--vovo-laranja)" }}>
                            trial até {new Date(a.trial_fim).toLocaleDateString("pt-BR")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Por plano */}
            {dados.assinaturas_por_plano && dados.assinaturas_por_plano.length > 0 && (
              <div className="card">
                <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>Por plano (tabela assinaturas)</h3>
                {dados.assinaturas_por_plano.map((p) => (
                  <div key={p.plano} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: "#f0ebe5" }}>
                    <div>
                      <p className="text-sm font-medium capitalize" style={{ color: "var(--vovo-marrom)" }}>{p.plano}</p>
                      <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>{p.count} assinantes</p>
                    </div>
                    <p className="font-bold" style={{ color: "var(--vovo-verde)" }}>R${parseFloat(p.total || "0").toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
