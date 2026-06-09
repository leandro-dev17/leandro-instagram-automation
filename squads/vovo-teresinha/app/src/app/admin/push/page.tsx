"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminPushPage() {
  const [titulo, setTitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [url, setUrl] = useState("/receitas");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ sucesso: number; falha: number; total: number } | null>(null);
  const [stats, setStats] = useState<{ total_subscriptions: number } | null>(null);

  useEffect(() => {
    fetch("/api/push/stats")
      .then((r) => r.json())
      .then((data) => setStats(data.dados));
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setResultado(null);

    const res = await fetch("/api/push/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo, corpo, url }),
    });

    const data = await res.json();
    if (data.dados) setResultado(data.dados);
    setEnviando(false);
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center gap-3 shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <Link href="/admin" className="text-white text-lg">←</Link>
        <span className="text-white font-bold">Notificações Push</span>
      </header>

      <div className="px-4 pt-4 max-w-lg mx-auto">
        {stats && (
          <div className="card text-center mb-4">
            <div className="text-3xl font-bold" style={{ color: "var(--vovo-marrom)" }}>{stats.total_subscriptions}</div>
            <div className="text-sm" style={{ color: "var(--vovo-lock)" }}>usuários inscritos para notificações</div>
          </div>
        )}

        <div className="card">
          <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>Enviar notificação</h3>
          <form onSubmit={enviar} className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Título</label>
              <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="input-field" placeholder="Receita nova disponível! 🍳" required />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Mensagem</label>
              <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} className="input-field resize-none" rows={3} placeholder="Olá querida! Acabamos de adicionar..." required />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>URL destino</label>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} className="input-field" placeholder="/receitas" />
            </div>

            {resultado && (
              <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: "#dcfce7" }}>
                ✅ Enviado para {resultado.sucesso}/{resultado.total} usuários
                {resultado.falha > 0 && ` (${resultado.falha} falhas removidas)`}
              </div>
            )}

            <button type="submit" disabled={enviando} className="btn-primary w-full">
              {enviando ? "Enviando..." : "🔔 Enviar para todos"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
