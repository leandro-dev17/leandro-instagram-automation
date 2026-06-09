"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Config = Record<string, string>;

const CAMPOS = [
  {
    chave: "receita_do_dia_id",
    label: "Receita do Dia (ID)",
    tipo: "number",
    placeholder: "ex: 42",
    descricao: "ID da receita destacada na página inicial",
  },
  {
    chave: "banner_mensagem",
    label: "Banner global",
    tipo: "text",
    placeholder: "ex: Novidade! Receitas de verão disponíveis 🌞",
    descricao: "Mensagem exibida no topo do app para todos os usuários (deixe em branco para desativar)",
  },
  {
    chave: "trial_dias",
    label: "Duração do trial (dias)",
    tipo: "number",
    placeholder: "7",
    descricao: "Quantos dias dura o período de avaliação gratuita",
  },
  {
    chave: "limite_favoritos_free",
    label: "Limite de favoritos (plano gratuito)",
    tipo: "number",
    placeholder: "5",
    descricao: "Máximo de receitas favoritas para usuários free",
  },
  {
    chave: "mensagem_boas_vindas",
    label: "Mensagem de boas-vindas",
    tipo: "textarea",
    placeholder: "ex: Bem-vinda à cozinha da Vovó Teresinha! 💕",
    descricao: "Exibida na tela de receitas quando o usuário abre o app",
  },
  {
    chave: "preco_premium",
    label: "Preço do Premium (R$)",
    tipo: "text",
    placeholder: "12.90",
    descricao: "Exibido nas telas de assinatura (só visual — altere no MP também)",
  },
];

export default function AdminConfiguracoesPage() {
  const [config, setConfig] = useState<Config>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/configuracoes")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data.dados || {});
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }, []);

  async function salvar(chave: string) {
    setSalvando(chave);
    setSucesso(null);
    setErro(null);
    const res = await fetch("/api/admin/configuracoes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chave, valor: config[chave] ?? "" }),
    });
    setSalvando(null);
    if (res.ok) {
      setSucesso(chave);
      setTimeout(() => setSucesso(null), 2000);
    } else {
      setErro("Erro ao salvar");
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center justify-between shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <div className="flex items-center gap-2">
          <Link href="/admin" className="text-white opacity-70 hover:opacity-100 mr-1">←</Link>
          <span className="text-2xl">⚙️</span>
          <span className="text-white font-bold">Configurações</span>
        </div>
        <Link href="/receitas" className="text-white text-sm opacity-70 hover:opacity-100">App</Link>
      </header>

      <div className="px-4 pt-4 pb-8 max-w-2xl mx-auto">
        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">⚙️</div></div>
        ) : (
          <div className="space-y-4">
            {erro && (
              <div className="px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: "#fef3cd", color: "#856404" }}>
                {erro}
              </div>
            )}

            {CAMPOS.map((campo) => (
              <div key={campo.chave} className="card">
                <label className="block text-sm font-bold mb-1" style={{ color: "var(--vovo-marrom)" }}>
                  {campo.label}
                </label>
                <p className="text-xs mb-2" style={{ color: "var(--vovo-lock)" }}>{campo.descricao}</p>

                {campo.tipo === "textarea" ? (
                  <textarea
                    rows={3}
                    className="input-field w-full resize-none text-sm"
                    placeholder={campo.placeholder}
                    value={config[campo.chave] ?? ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, [campo.chave]: e.target.value }))}
                  />
                ) : (
                  <input
                    type={campo.tipo}
                    className="input-field w-full text-sm"
                    placeholder={campo.placeholder}
                    value={config[campo.chave] ?? ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, [campo.chave]: e.target.value }))}
                  />
                )}

                <button
                  onClick={() => salvar(campo.chave)}
                  disabled={salvando === campo.chave}
                  className="mt-2 text-xs font-semibold px-4 py-1.5 rounded-lg transition-all"
                  style={{ backgroundColor: sucesso === campo.chave ? "#6B8F71" : "var(--vovo-marrom)", color: "white" }}
                >
                  {salvando === campo.chave ? "Salvando..." : sucesso === campo.chave ? "✓ Salvo" : "Salvar"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
