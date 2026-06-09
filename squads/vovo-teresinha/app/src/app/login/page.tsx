"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const ERROS_GOOGLE: Record<string, string> = {
  google_falhou: "Não foi possível entrar com o Google. Tente novamente.",
  email_nao_verificado: "Seu e-mail do Google precisa estar verificado.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const erroParam = searchParams.get("erro");
    if (erroParam && ERROS_GOOGLE[erroParam]) setErro(ERROS_GOOGLE[erroParam]);
  }, [searchParams]);

  const redirect = searchParams.get("redirect") || "/receitas";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data.erro || "Erro ao fazer login"); return; }
      router.push(redirect);
      router.refresh();
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/selo-vovo.png" alt="Vovó Teresinha" className="w-28 h-28 mx-auto mb-2 object-contain" />
          <p className="text-sm mt-1" style={{ color: "var(--vovo-marrom-mid)" }}>Bem-vinda de volta, querida! 💕</p>
        </div>

        <div className="card space-y-4">
          {/* Botão Google */}
          <a
            href={`/api/auth/google/redirect?redirect=${encodeURIComponent(redirect)}`}
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl border-2 font-medium text-sm transition-all active:scale-95"
            style={{ borderColor: "#e5e0da", color: "var(--vovo-marrom)", backgroundColor: "white" }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Entrar com Google
          </a>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ backgroundColor: "#e5e0da" }} />
            <span className="text-xs" style={{ color: "var(--vovo-lock)" }}>ou</span>
            <div className="flex-1 h-px" style={{ backgroundColor: "#e5e0da" }} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" placeholder="seu@email.com" required autoComplete="email" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Senha</label>
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className="input-field" placeholder="••••••" required autoComplete="current-password" />
            </div>

            {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}

            <button type="submit" disabled={carregando} className="btn-primary w-full">
              {carregando ? "Entrando..." : "Entrar 🍳"}
            </button>
          </form>

          <div className="text-center">
            <Link href="/esqueci-senha" className="text-sm" style={{ color: "var(--vovo-rosa)" }}>
              Esqueci minha senha
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
            Ainda não tem conta?{" "}
            <Link href="/cadastro" className="font-semibold" style={{ color: "var(--vovo-marrom)" }}>Cadastre-se grátis</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
