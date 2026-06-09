"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Stats = {
  total_usuarios: number;
  usuarios_por_tipo: { tipo_usuario: string; count: string }[];
  total_receitas: number;
  assinaturas_ativas: number;
  receita_total_30d: number;
  novos_usuarios_7d: number;
  push_subscriptions: number;
};

const ADMIN_LINKS = [
  { href: "/admin/usuarios", label: "Usuários", icon: "👥" },
  { href: "/admin/receitas", label: "Receitas", icon: "🍳" },
  { href: "/admin/alunas", label: "Alunas", icon: "💪" },
  { href: "/admin/afiliados", label: "Afiliados", icon: "💰" },
  { href: "/admin/financeiro", label: "Financeiro", icon: "📊" },
  { href: "/admin/push", label: "Notificações", icon: "🔔" },
  { href: "/admin/agentes", label: "Agentes IA", icon: "🤖" },
  { href: "/admin/configuracoes", label: "Configurações", icon: "⚙️" },
  { href: "/admin/whatsapp", label: "WhatsApp Fila", icon: "💬" },
];

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((data) => {
        setStats(data.dados);
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }, []);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center justify-between shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚙️</span>
          <span className="text-white font-bold">Admin — Vovó Teresinha</span>
        </div>
        <Link href="/receitas" className="text-white text-sm opacity-70 hover:opacity-100">App</Link>
      </header>

      <div className="px-4 pt-4 pb-8 max-w-3xl mx-auto">
        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">⚙️</div></div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {[
                { label: "Usuários", valor: stats.total_usuarios, icon: "👥" },
                { label: "Assinaturas ativas", valor: stats.assinaturas_ativas, icon: "✅" },
                { label: "Receitas cadastradas", valor: stats.total_receitas, icon: "🍳" },
                { label: "Novos (7 dias)", valor: stats.novos_usuarios_7d, icon: "🆕" },
                { label: "Receita 30 dias", valor: `R$${stats.receita_total_30d.toFixed(2)}`, icon: "💰", isStr: true },
                { label: "Push subscribers", valor: stats.push_subscriptions, icon: "🔔" },
              ].map((item) => (
                <div key={item.label} className="card text-center">
                  <div className="text-2xl mb-1">{item.icon}</div>
                  <div className="text-xl font-bold" style={{ color: "var(--vovo-marrom)" }}>
                    {item.valor}
                  </div>
                  <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>{item.label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              {stats.usuarios_por_tipo.map((t) => (
                <div key={t.tipo_usuario} className="card">
                  <div className="font-semibold text-sm capitalize" style={{ color: "var(--vovo-marrom)" }}>
                    {t.tipo_usuario.replace(/_/g, " ")}
                  </div>
                  <div className="text-2xl font-bold" style={{ color: "var(--vovo-rosa)" }}>{t.count}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center py-8" style={{ color: "var(--vovo-marrom-mid)" }}>Erro ao carregar estatísticas</p>
        )}

        <h2 className="font-bold mb-3" style={{ color: "var(--vovo-marrom)" }}>Gerenciar</h2>
        <div className="grid grid-cols-2 gap-3">
          {ADMIN_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="card flex items-center gap-3 hover:shadow-md transition-shadow">
              <span className="text-3xl">{link.icon}</span>
              <span className="font-medium" style={{ color: "var(--vovo-marrom)" }}>{link.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
