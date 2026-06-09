"use client";

import { useState } from "react";
import Link from "next/link";

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);

    try {
      const res = await fetch("/api/auth/esqueci-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErro(data.erro || "Erro ao enviar");
        return;
      }

      setEnviado(true);
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8"
      style={{ backgroundColor: "var(--vovo-creme)" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--vovo-marrom)" }}>
            Esqueci minha senha
          </h1>
        </div>

        <div className="card">
          {enviado ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">📧</div>
              <p className="font-medium mb-2" style={{ color: "var(--vovo-marrom)" }}>
                E-mail enviado!
              </p>
              <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
                Verifique sua caixa de entrada e siga o link para redefinir sua senha.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
                Digite seu email e enviaremos um link para redefinir a senha.
              </p>
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="seu@email.com"
                  required
                />
              </div>

              {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}

              <button type="submit" disabled={carregando} className="btn-primary w-full">
                {carregando ? "Enviando..." : "Enviar link de redefinição"}
              </button>
            </form>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link href="/login" className="text-sm font-medium" style={{ color: "var(--vovo-rosa)" }}>
            ← Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  );
}
