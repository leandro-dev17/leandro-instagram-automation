"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function RedefinirForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (novaSenha !== confirmar) {
      setErro("As senhas não coincidem");
      return;
    }

    if (novaSenha.length < 8) {
      setErro("Senha deve ter ao menos 8 caracteres");
      return;
    }

    setCarregando(true);

    try {
      const res = await fetch("/api/auth/redefinir-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, nova_senha: novaSenha }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErro(data.erro || "Erro ao redefinir senha");
        return;
      }

      setSucesso(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setCarregando(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">Link inválido ou expirado.</p>
        <Link href="/esqueci-senha" className="btn-primary mt-4 inline-block">
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      {sucesso ? (
        <div className="text-center py-4">
          <div className="text-4xl mb-3">✅</div>
          <p className="font-medium" style={{ color: "var(--vovo-marrom)" }}>
            Senha redefinida! Redirecionando...
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>
              Nova senha
            </label>
            <input
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              className="input-field"
              placeholder="Mín. 6 caracteres"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>
              Confirmar senha
            </label>
            <input
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              className="input-field"
              placeholder="Repita a senha"
              required
            />
          </div>

          {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}

          <button type="submit" disabled={carregando} className="btn-primary w-full">
            {carregando ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8"
      style={{ backgroundColor: "var(--vovo-creme)" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🔐</div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--vovo-marrom)" }}>
            Redefinir senha
          </h1>
        </div>
        <Suspense fallback={<div className="card text-center py-4">Carregando...</div>}>
          <RedefinirForm />
        </Suspense>
        <div className="mt-6 text-center">
          <Link href="/login" className="text-sm font-medium" style={{ color: "var(--vovo-rosa)" }}>
            ← Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  );
}
