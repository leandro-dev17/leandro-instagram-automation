"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type StatsAfiliados = {
  total_afiliados: number;
  comissoes: { status: string; total: string }[];
  saques_pendentes_valor: number;
  top_afiliados: { codigo: string; nome: string; conversoes: number; total_ganho: string }[];
};

type Saque = {
  id: number;
  valor: number;
  status: string;
  pix_destino: string;
  created_at: string;
  codigo: string;
  nome: string;
  email: string;
};

export default function AdminAfiliadosPage() {
  const [stats, setStats] = useState<StatsAfiliados | null>(null);
  const [saques, setSaques] = useState<Saque[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<"stats" | "saques">("stats");

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/afiliados/stats").then((r) => r.json()),
      fetch("/api/admin/afiliados/saques").then((r) => r.json()),
    ]).then(([s, sv]) => {
      setStats(s.dados);
      setSaques(sv.dados || []);
      setCarregando(false);
    }).catch(() => setCarregando(false));
  }, []);

  async function processarSaque(id: number, acao: "aprovar" | "rejeitar") {
    await fetch(`/api/admin/afiliados/saques/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao }),
    });
    const res = await fetch("/api/admin/afiliados/saques");
    const data = await res.json();
    setSaques(data.dados || []);
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center gap-3 shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <Link href="/admin" className="text-white text-lg">←</Link>
        <span className="text-white font-bold">Afiliados</span>
      </header>

      <div className="px-4 pt-4 max-w-3xl mx-auto">
        <div className="flex gap-2 mb-4">
          {(["stats", "saques"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: aba === a ? "var(--vovo-marrom)" : "white",
                color: aba === a ? "white" : "var(--vovo-marrom)",
                border: "1.5px solid",
                borderColor: aba === a ? "var(--vovo-marrom)" : "#e5e0da",
              }}
            >
              {a === "stats" ? "Estatísticas" : "Saques"}
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">💰</div></div>
        ) : aba === "stats" && stats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="card text-center">
                <div className="text-2xl font-bold" style={{ color: "var(--vovo-marrom)" }}>{stats.total_afiliados}</div>
                <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Total afiliados</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-bold" style={{ color: "var(--vovo-rosa)" }}>R${stats.saques_pendentes_valor.toFixed(2)}</div>
                <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Saques pendentes</div>
              </div>
            </div>

            <div className="card">
              <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>Top afiliadas</h3>
              <div className="space-y-2">
                {stats.top_afiliados.map((a, i) => (
                  <div key={a.codigo} className="flex items-center gap-3">
                    <span className="text-sm font-bold w-5" style={{ color: "var(--vovo-lock)" }}>{i + 1}.</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: "var(--vovo-marrom)" }}>{a.nome}</p>
                      <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>{a.conversoes} conversões</p>
                    </div>
                    <span className="text-sm font-bold" style={{ color: "var(--vovo-verde)" }}>
                      R${parseFloat(a.total_ganho).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {saques.filter((s) => s.status === "pendente").length === 0 ? (
              <p className="text-center py-8 text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>Nenhum saque pendente</p>
            ) : (
              saques.filter((s) => s.status === "pendente").map((s) => (
                <div key={s.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm" style={{ color: "var(--vovo-marrom)" }}>{s.nome}</p>
                      <p className="text-xs" style={{ color: "var(--vovo-marrom-mid)" }}>PIX: {s.pix_destino}</p>
                      <p className="text-lg font-bold" style={{ color: "var(--vovo-verde)" }}>R${s.valor.toFixed(2)}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => processarSaque(s.id, "aprovar")} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ backgroundColor: "#dcfce7", color: "#16a34a" }}>Aprovar</button>
                      <button onClick={() => processarSaque(s.id, "rejeitar")} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}>Rejeitar</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
