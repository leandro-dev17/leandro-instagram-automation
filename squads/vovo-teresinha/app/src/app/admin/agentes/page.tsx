"use client";

import Link from "next/link";

export default function AdminAgentesPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center gap-3 shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <Link href="/admin" className="text-white text-lg">←</Link>
        <span className="text-white font-bold">Agentes IA</span>
      </header>

      <div className="px-4 pt-4 max-w-lg mx-auto">
        <div className="space-y-3">
          <div className="card">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">🤖</span>
              <div>
                <h3 className="font-bold" style={{ color: "var(--vovo-marrom)" }}>Geladeira IA</h3>
                <p className="text-xs" style={{ color: "var(--vovo-marrom-mid)" }}>Claude API • Haiku 4.5</p>
              </div>
              <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "#dcfce7", color: "#16a34a" }}>
                Ativo
              </span>
            </div>
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
              Analisa ingredientes da geladeira e sugere receitas usando IA.
            </p>
          </div>

          <div className="card">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">📱</span>
              <div>
                <h3 className="font-bold" style={{ color: "var(--vovo-marrom)" }}>WhatsApp Bot</h3>
                <p className="text-xs" style={{ color: "var(--vovo-marrom-mid)" }}>Evolution API • instância: vovoapp</p>
              </div>
              <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "#fef9c3", color: "#ca8a04" }}>
                Config.
              </span>
            </div>
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
              Envia mensagens de boas-vindas e lembretes para assinantes.
            </p>
          </div>

          <div className="card">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">💳</span>
              <div>
                <h3 className="font-bold" style={{ color: "var(--vovo-marrom)" }}>Webhook Mercado Pago</h3>
                <p className="text-xs" style={{ color: "var(--vovo-marrom-mid)" }}>Processa pagamentos automaticamente</p>
              </div>
              <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "#dcfce7", color: "#16a34a" }}>
                Ativo
              </span>
            </div>
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
              Atualiza status de assinatura após pagamento aprovado.
              Libera comissões de afiliados automaticamente.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
