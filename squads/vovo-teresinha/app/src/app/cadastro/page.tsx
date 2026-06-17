"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function CadastroPage() {
  const router = useRouter();
  const [form, setForm] = useState({ nome: "", email: "", senha: "", whatsapp: "", aceita_whatsapp: false });
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (form.senha.length < 8) { setErro("Senha deve ter ao menos 8 caracteres"); return; }
    setCarregando(true);
    try {
      const res = await fetch("/api/auth/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setErro(data.erro || "Erro ao cadastrar"); return; }
      router.push("/bem-vinda");
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
          <div className="text-6xl mb-3">💕</div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--vovo-marrom)" }}>Criar conta</h1>
          <p className="text-sm mt-1" style={{ color: "var(--vovo-marrom-mid)" }}>Comece a cozinhar com a Vovó Teresinha!</p>
        </div>

        <div className="card space-y-4">
          {/* Botão Google */}
          <a
            href="/api/auth/google/redirect"
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl border-2 font-medium text-sm transition-all active:scale-95"
            style={{ borderColor: "#e5e0da", color: "var(--vovo-marrom)", backgroundColor: "white" }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Criar conta com Google
          </a>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ backgroundColor: "#e5e0da" }} />
            <span className="text-xs" style={{ color: "var(--vovo-lock)" }}>ou preencha o formulário</span>
            <div className="flex-1 h-px" style={{ backgroundColor: "#e5e0da" }} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Seu nome</label>
              <input type="text" name="nome" value={form.nome} onChange={handleChange} className="input-field" placeholder="Maria das Graças" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Email</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} className="input-field" placeholder="seu@email.com" required autoComplete="email" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Senha</label>
              <input type="password" name="senha" value={form.senha} onChange={handleChange} className="input-field" placeholder="Mín. 6 caracteres" required autoComplete="new-password" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>WhatsApp (opcional)</label>
              <input type="tel" name="whatsapp" value={form.whatsapp} onChange={handleChange} className="input-field" placeholder="(47) 99999-9999" />
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" name="aceita_whatsapp" checked={form.aceita_whatsapp} onChange={handleChange} className="mt-0.5 accent-[var(--vovo-rosa)]" />
              <span className="text-xs" style={{ color: "var(--vovo-marrom-mid)" }}>
                Aceito receber dicas e receitas da Vovó Teresinha pelo WhatsApp 💕
              </span>
            </label>

            {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}

            <button type="submit" disabled={carregando} className="btn-primary w-full">
              {carregando ? "Criando conta..." : "Criar conta 🎉"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
            Já tem conta?{" "}
            <Link href="/login" className="font-semibold" style={{ color: "var(--vovo-marrom)" }}>Fazer login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
