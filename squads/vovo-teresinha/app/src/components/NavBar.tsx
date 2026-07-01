"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type TipoUsuario = "free" | "premium" | "trial" | "aluna_leandro" | "admin" | null;
type Plano = "caderninho" | "livro_receitas" | null;

const NAV_PADRAO = [
  { href: "/receitas", label: "Receitas", icon: "🍳" },
  { href: "/favoritos", label: "Favoritos", icon: "❤️" },
  { href: "/assinar", label: "Plano", icon: "📅" },
  { href: "/renda-extra", label: "Renda Extra", icon: "💰" },
  { href: "/perfil", label: "Perfil", icon: "👤" },
];

// Caderninho (R$9,90): acesso às 80 receitas selecionadas, sem os recursos exclusivos do Livro de Receitas
const NAV_CADERNINHO = [
  { href: "/receitas", label: "Receitas", icon: "🍳" },
  { href: "/favoritos", label: "Favoritos", icon: "❤️" },
  { href: "/renda-extra", label: "Renda Extra", icon: "💰" },
  { href: "/perfil", label: "Perfil", icon: "👤" },
];

// Livro de Receitas (R$19,90): acesso completo, inclui Plano Semanal, Geladeira Inteligente e Lista de Compras
const NAV_LIVRO = [
  { href: "/receitas", label: "Receitas", icon: "🍳" },
  { href: "/plano-semanal", label: "Plano", icon: "📅" },
  { href: "/geladeira", label: "Geladeira", icon: "🥕" },
  { href: "/lista-compras", label: "Compras", icon: "🛒" },
  { href: "/perfil", label: "Perfil", icon: "👤" },
];

const NAV_ALUNA = [
  { href: "/receitas", label: "Receitas", icon: "🍳" },
  { href: "/personal", label: "Personal", icon: "🏋️" },
  { href: "/favoritos", label: "Favoritos", icon: "❤️" },
  { href: "/perfil", label: "Perfil", icon: "👤" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [tipoUsuario, setTipoUsuario] = useState<TipoUsuario>(null);
  const [plano, setPlano] = useState<Plano>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setTipoUsuario(d.dados?.tipo_usuario ?? null);
        setPlano(d.dados?.plano ?? null);
      })
      .catch(() => {});
  }, []);

  const navItems =
    tipoUsuario === "aluna_leandro" ? NAV_ALUNA :
    (tipoUsuario === "admin" || (tipoUsuario === "premium" && plano !== "caderninho")) ? NAV_LIVRO :
    tipoUsuario === "premium" ? NAV_CADERNINHO :
    NAV_PADRAO;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 shadow-sm"
        style={{ backgroundColor: "var(--vovo-marrom)" }}
      >
        <Link href="/receitas" className="flex items-center gap-2">
          <img src="/selo-vovo.png" alt="Vovó Teresinha" className="w-9 h-9 object-contain rounded-full" />
          <span className="text-white font-bold text-lg leading-tight">
            Vovó Teresinha
          </span>
        </Link>
        <button
          onClick={handleLogout}
          className="text-white opacity-70 hover:opacity-100 text-xs px-3 py-1.5 rounded-lg border border-white/20 transition-opacity"
        >
          Sair
        </button>
      </header>

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around py-2 border-t"
        style={{ backgroundColor: "white", borderColor: "#e5e0da" }}
      >
        {navItems.map((item) => {
          const active =
            item.href === "/receitas"
              ? pathname === "/receitas" || pathname.startsWith("/receitas/")
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-colors"
              style={{ color: active ? "var(--vovo-rosa)" : "var(--vovo-lock)" }}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
