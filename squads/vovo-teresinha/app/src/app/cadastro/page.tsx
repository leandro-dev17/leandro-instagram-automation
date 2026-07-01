"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

type OtpEstado = "idle" | "enviando" | "aguardando" | "verificando" | "verificado";
type PlanoId = "caderninho" | "livro_receitas";

const PLANOS_CADASTRO: { id: PlanoId; titulo: string; emoji: string; preco: string }[] = [
  { id: "caderninho", titulo: "Caderninho", emoji: "📒", preco: "R$ 9,90/mês" },
  { id: "livro_receitas", titulo: "Livro de Receitas", emoji: "📖", preco: "R$ 19,90/mês" },
];

function CadastroForm() {
  const searchParams = useSearchParams();
  const planoInicial = searchParams.get("plano");
  const erroParam = searchParams.get("erro");
  const refParam = searchParams.get("ref") || "";
  const erroInicial =
    erroParam === "escolha_plano" ? "Escolha um plano antes de continuar com o Google." :
    erroParam === "checkout_falhou" ? "Não foi possível gerar o link de pagamento. Tente novamente." :
    "";

  const [plano, setPlano] = useState<PlanoId | null>(
    planoInicial === "caderninho" || planoInicial === "livro_receitas" ? planoInicial : null
  );
  const [form, setForm] = useState({ nome: "", email: "", senha: "", whatsapp: "", aceita_whatsapp: false });
  const [erro, setErro] = useState(erroInicial);
  const [carregando, setCarregando] = useState(false);
  const [otpEstado, setOtpEstado] = useState<OtpEstado>("idle");
  const [codigoOtp, setCodigoOtp] = useState("");
  const [erroOtp, setErroOtp] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
    if (name === "whatsapp") {
      setOtpEstado("idle");
      setCodigoOtp("");
      setErroOtp("");
    }
  }

  async function enviarOtp() {
    setErroOtp("");
    setOtpEstado("enviando");
    try {
      const res = await fetch("/api/auth/otp/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: form.whatsapp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErroOtp(data.erro || "Erro ao enviar código");
        setOtpEstado("idle");
        return;
      }
      setOtpEstado("aguardando");
    } catch {
      setErroOtp("Erro de conexão. Tente novamente.");
      setOtpEstado("idle");
    }
  }

  async function verificarOtp() {
    setErroOtp("");
    setOtpEstado("verificando");
    try {
      const res = await fetch("/api/auth/otp/verificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: form.whatsapp, codigo: codigoOtp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErroOtp(data.erro || "Código inválido");
        setOtpEstado("aguardando");
        return;
      }
      setOtpEstado("verificado");
    } catch {
      setErroOtp("Erro de conexão. Tente novamente.");
      setOtpEstado("aguardando");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!plano) { setErro("Escolha um plano antes de continuar"); return; }
    if (form.senha.length < 8) { setErro("Senha deve ter ao menos 8 caracteres"); return; }
    if (otpEstado !== "verificado") { setErro("Verifique seu WhatsApp antes de continuar"); return; }
    setCarregando(true);
    try {
      const res = await fetch("/api/auth/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, plano, ref: refParam }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.redirecionarParaAssinar) {
          window.location.href = refParam ? `/assinar?ref=${refParam}` : "/assinar";
          return;
        }
        setErro(data.erro || "Erro ao cadastrar");
        return;
      }
      const url = data.dados?.init_point;
      if (!url) { setErro("Link de pagamento não gerado. Tente novamente."); return; }
      window.location.href = url;
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  const telefoneValido = form.whatsapp.replace(/\D/g, "").length >= 10;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start px-4 py-6"
      style={{ background: "linear-gradient(160deg, #fdf6ee 0%, #f0e6d8 100%)" }}
    >
      <div className="w-full max-w-sm">

        {/* Foto da Vovó */}
        <div className="relative w-full h-96 rounded-2xl overflow-hidden mb-5 shadow-lg">
          <Image
            src="/vovo-mostrando-bolo.jpeg"
            alt="Vovó Teresinha com seu bolo"
            fill
            className="object-cover object-top"
            priority
          />
        </div>

        {/* Copy emocional */}
        <div
          className="rounded-2xl px-5 py-4 mb-5 text-center shadow-sm"
          style={{ backgroundColor: "white" }}
        >
          <p className="text-sm leading-relaxed" style={{ color: "#6b4a3a" }}>
            Meu amor 💕, que alegria saber que você está aqui!{" "}
            A vovó tem várias receitinhas bem fáceis de fazer,{" "}
            vem ver que estou te esperando ansiosa!
          </p>
          <p className="mt-2 font-semibold text-sm" style={{ color: "#c85a70" }}>
            A vovó ama você 💕
          </p>
        </div>

        {/* Card do formulário */}
        <div className="rounded-2xl p-5 shadow-md" style={{ backgroundColor: "white" }}>

          {/* Seletor de plano */}
          <div className="mb-4">
            <label className="block text-xs font-semibold mb-2" style={{ color: "#4a2c1e" }}>
              Escolha seu plano <span style={{ color: "#e8778a" }}>*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PLANOS_CADASTRO.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlano(p.id)}
                  className="rounded-xl p-3 text-center border-2 transition-all active:scale-95"
                  style={{
                    borderColor: plano === p.id ? "#e8778a" : "#e5d8ce",
                    backgroundColor: plano === p.id ? "rgba(232,119,138,0.08)" : "white",
                  }}
                >
                  <div className="text-xl">{p.emoji}</div>
                  <div className="text-xs font-bold mt-1" style={{ color: "#4a2c1e" }}>{p.titulo}</div>
                  <div className="text-xs" style={{ color: "#9a7a6a" }}>{p.preco}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Google */}
          <a
            href={plano ? `/api/auth/google/redirect?plano=${plano}${refParam ? `&ref=${refParam}` : ""}` : "#"}
            onClick={(e) => { if (!plano) { e.preventDefault(); setErro("Escolha um plano antes de continuar com o Google"); } }}
            aria-disabled={!plano}
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl border-2 font-medium text-sm transition-all active:scale-95 mb-4"
            style={{ borderColor: "#e5d8ce", color: "#4a2c1e", backgroundColor: "white", opacity: plano ? 1 : 0.5 }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Criar conta com Google
          </a>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ backgroundColor: "#e5d8ce" }} />
            <span className="text-xs" style={{ color: "#b09080" }}>ou preencha</span>
            <div className="flex-1 h-px" style={{ backgroundColor: "#e5d8ce" }} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "#4a2c1e" }}>Seu nome</label>
              <input type="text" name="nome" value={form.nome} onChange={handleChange} className="input-field" placeholder="Maria das Graças" required />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "#4a2c1e" }}>Email</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} className="input-field" placeholder="seu@email.com" required autoComplete="email" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "#4a2c1e" }}>Senha</label>
              <input type="password" name="senha" value={form.senha} onChange={handleChange} className="input-field" placeholder="Mín. 8 caracteres" required autoComplete="new-password" />
            </div>

            {/* WhatsApp + OTP */}
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "#4a2c1e" }}>
                WhatsApp <span style={{ color: "#e8778a" }}>*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  name="whatsapp"
                  value={form.whatsapp}
                  onChange={handleChange}
                  className="input-field flex-1"
                  placeholder="(47) 99999-9999"
                  disabled={otpEstado === "verificado"}
                  required
                />
                {otpEstado !== "verificado" ? (
                  <button
                    type="button"
                    onClick={enviarOtp}
                    disabled={!telefoneValido || otpEstado === "enviando"}
                    className="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 disabled:opacity-40"
                    style={{ backgroundColor: "#e8778a", color: "white", border: "none" }}
                  >
                    {otpEstado === "enviando" ? "Enviando..." : otpEstado === "aguardando" ? "Reenviar" : "Enviar código"}
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-bold px-2" style={{ color: "#16a34a" }}>
                    ✓ Verificado
                  </span>
                )}
              </div>
            </div>

            {/* Campo do código OTP */}
            {(otpEstado === "aguardando" || otpEstado === "verificando") && (
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#4a2c1e" }}>Código do WhatsApp</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={codigoOtp}
                    onChange={(e) => setCodigoOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="input-field flex-1 text-center tracking-[0.3em] text-lg font-mono"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={verificarOtp}
                    disabled={codigoOtp.length !== 6 || otpEstado === "verificando"}
                    className="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 disabled:opacity-40"
                    style={{ backgroundColor: "#4a2c1e", color: "white", border: "none" }}
                  >
                    {otpEstado === "verificando" ? "..." : "Verificar"}
                  </button>
                </div>
              </div>
            )}

            {erroOtp && <p className="text-xs text-red-600 text-center">{erroOtp}</p>}

            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <input type="checkbox" name="aceita_whatsapp" checked={form.aceita_whatsapp} onChange={handleChange} className="mt-0.5 accent-[#e8778a]" />
              <span className="text-xs leading-relaxed" style={{ color: "#9a7a6a" }}>
                Aceito receber dicas e receitas da Vovó pelo WhatsApp 💕
              </span>
            </label>

            {erro && <p className="text-sm text-red-600 text-center">{erro}</p>}

            <button
              type="submit"
              disabled={carregando || otpEstado !== "verificado" || !plano}
              className="w-full py-4 rounded-2xl font-bold text-base text-white transition-all active:scale-95 disabled:opacity-50 mt-2"
              style={{
                background: "linear-gradient(135deg, #c85a70 0%, #e8778a 100%)",
                boxShadow: otpEstado === "verificado" && plano ? "0 8px 24px rgba(200,90,112,0.38)" : "none",
                border: "none",
              }}
            >
              {carregando ? "Redirecionando para pagamento..." : "Quero entrar 💕"}
            </button>

            {!plano && (
              <p className="text-xs text-center" style={{ color: "#b09080" }}>
                Escolha um plano para continuar
              </p>
            )}

            {otpEstado !== "verificado" && (
              <p className="text-xs text-center" style={{ color: "#b09080" }}>
                Verifique seu WhatsApp para criar a conta
              </p>
            )}
          </form>
        </div>

        <div className="mt-5 text-center pb-6">
          <p className="text-sm" style={{ color: "#9a7a6a" }}>
            Já tem conta?{" "}
            <Link href="/login" className="font-semibold" style={{ color: "#4a2c1e" }}>Fazer login</Link>
          </p>
        </div>

      </div>
    </div>
  );
}

export default function CadastroPage() {
  return (
    <Suspense>
      <CadastroForm />
    </Suspense>
  );
}
