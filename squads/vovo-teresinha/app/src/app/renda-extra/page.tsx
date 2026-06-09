"use client";

import { useEffect, useState } from "react";
import NavBar from "@/components/NavBar";

type AfilinadoConta = {
  id: number;
  codigo: string;
  cpf: string | null;
  pix_chave: string | null;
  tier: number;
  saldo_pendente: number;
  saldo_disponivel: number;
  total_sacado: number;
  total_conversoes: number;
};

export default function RendaExtraPage() {
  const [conta, setConta] = useState<AfilinadoConta | null>(null);
  const [cadastrado, setCadastrado] = useState(false);
  const [cpf, setCpf] = useState("");
  const [pix, setPix] = useState("");
  const [cadastrando, setCadastrando] = useState(false);
  const [solicitandoSaque, setSolicitandoSaque] = useState(false);
  const [valorSaque, setValorSaque] = useState("");
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch("/api/afiliados/minha-conta")
      .then((r) => r.json())
      .then((data) => {
        if (data.dados) {
          setConta(data.dados);
          setCadastrado(true);
        }
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }, []);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCadastrando(true);

    const res = await fetch("/api/afiliados/cadastrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf, pix_chave: pix }),
    });
    const data = await res.json();

    if (!res.ok) {
      setErro(data.erro || "Erro ao cadastrar");
    } else {
      setSucesso("Cadastro realizado! Seu link de afiliado foi criado 💕");
      const reload = await fetch("/api/afiliados/minha-conta");
      const d = await reload.json();
      if (d.dados) { setConta(d.dados); setCadastrado(true); }
    }
    setCadastrando(false);
  }

  async function solicitarSaque(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setSolicitandoSaque(true);

    const res = await fetch("/api/afiliados/solicitar-saque", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valor: parseFloat(valorSaque) }),
    });
    const data = await res.json();

    if (!res.ok) {
      setErro(data.erro || "Erro ao solicitar saque");
    } else {
      setSucesso("Saque solicitado! Será processado em até 5 dias úteis.");
      setValorSaque("");
    }
    setSolicitandoSaque(false);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
  const linkAfiliado = conta ? `${appUrl}/cadastro?ref=${conta.codigo}` : "";

  const KIT_MENSAGENS = conta ? [
    {
      titulo: "WhatsApp (simples)",
      texto: `Meninas, descobri um app incrível da Vovó Teresinha com centenas de receitas gostosas! 🍳👵\n\nVou te mandar o link para criar sua conta grátis!\n${linkAfiliado}`,
    },
    {
      titulo: "Stories/Instagram",
      texto: `🍳 App da Vovó Teresinha\n\nCentenas de receitas deliciosas com o carinho de uma avó!\n\nCrie sua conta grátis 👇\n${linkAfiliado}`,
    },
    {
      titulo: "Grupo de receitas",
      texto: `Pessoal, recomendo esse app de receitas da Vovó Teresinha! Tem de tudo: doces, bolos, pratos do dia a dia, sopas... 🥘\n\nEu uso todo dia e já aprendi receitas deliciosas!\n\nCadastro gratuito aqui: ${linkAfiliado}`,
    },
  ] : [];

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-1 flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
          💰 Programa de Afiliados
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--vovo-marrom-mid)" }}>
          Indique o app e ganhe comissões por cada assinatura anual!
        </p>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">💰</div></div>
        ) : !cadastrado ? (
          <div>
            <div className="card mb-4">
              <h3 className="font-bold mb-3" style={{ color: "var(--vovo-marrom)" }}>Como funciona</h3>
              <div className="space-y-2 text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
                <p>✅ Compartilhe seu link de afiliado</p>
                <p>✅ Ganhe por cada assinatura anual (R$79,90)</p>
                <p>✅ 1-4 conversões: R$20/venda</p>
                <p>✅ 5-9 conversões: R$25/venda</p>
                <p>✅ 10+ conversões: R$30/venda</p>
                <p>⏳ Comissão liberada após 30 dias</p>
              </div>
            </div>

            <div className="card">
              <h3 className="font-bold mb-3" style={{ color: "var(--vovo-marrom)" }}>Cadastrar como afiliada</h3>
              <form onSubmit={cadastrar} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>CPF</label>
                  <input type="text" value={cpf} onChange={(e) => setCpf(e.target.value)} className="input-field" placeholder="000.000.000-00" required />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Chave PIX para recebimento</label>
                  <input type="text" value={pix} onChange={(e) => setPix(e.target.value)} className="input-field" placeholder="CPF, email ou telefone" required />
                </div>
                {erro && <p className="text-sm text-red-600">{erro}</p>}
                {sucesso && <p className="text-sm text-green-600">{sucesso}</p>}
                <button type="submit" disabled={cadastrando} className="btn-primary w-full">
                  {cadastrando ? "Cadastrando..." : "Quero ser afiliada! 💕"}
                </button>
              </form>
            </div>
          </div>
        ) : conta ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Disponível", valor: conta.saldo_disponivel, cor: "var(--vovo-verde)" },
                { label: "Pendente", valor: conta.saldo_pendente, cor: "var(--vovo-laranja)" },
                { label: "Sacado", valor: conta.total_sacado, cor: "var(--vovo-marrom-mid)" },
                { label: "Conversões", valor: conta.total_conversoes, cor: "var(--vovo-rosa)", isInt: true },
              ].map((item) => (
                <div key={item.label} className="card text-center">
                  <p className="text-xl font-bold" style={{ color: item.cor }}>
                    {item.isInt ? item.valor : `R$${Number(item.valor).toFixed(2)}`}
                  </p>
                  <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>{item.label}</p>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 className="font-semibold mb-2" style={{ color: "var(--vovo-marrom)" }}>Seu link de afiliado</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={linkAfiliado}
                  className="input-field text-xs flex-1"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(linkAfiliado)}
                  className="px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ backgroundColor: "var(--vovo-marrom)", color: "white" }}
                >
                  Copiar
                </button>
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--vovo-lock)" }}>Código: {conta.codigo}</p>
            </div>

            {/* Kit de divulgação */}
            <div className="card">
              <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>📢 Kit de Divulgação</h3>
              <p className="text-xs mb-3" style={{ color: "var(--vovo-marrom-mid)" }}>
                Copie uma dessas mensagens e compartilhe no WhatsApp, Instagram ou grupos!
              </p>
              <div className="space-y-3">
                {KIT_MENSAGENS.map((kit) => (
                  <div key={kit.titulo} className="rounded-xl p-3" style={{ backgroundColor: "#f5f0ea" }}>
                    <p className="text-xs font-semibold mb-2" style={{ color: "var(--vovo-marrom)" }}>{kit.titulo}</p>
                    <p className="text-xs mb-2 whitespace-pre-line" style={{ color: "var(--vovo-marrom-mid)" }}>{kit.texto}</p>
                    <button
                      onClick={() => { navigator.clipboard.writeText(kit.texto); setSucesso("Copiado!"); setTimeout(() => setSucesso(""), 1500); }}
                      className="text-xs font-semibold px-3 py-1 rounded-lg"
                      style={{ backgroundColor: "var(--vovo-marrom)", color: "white" }}
                    >
                      Copiar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {conta.saldo_disponivel >= 30 && (
              <div className="card">
                <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>Solicitar saque</h3>
                <form onSubmit={solicitarSaque} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>
                      Valor (mín. R$30, disponível: R${conta.saldo_disponivel.toFixed(2)})
                    </label>
                    <input
                      type="number"
                      value={valorSaque}
                      onChange={(e) => setValorSaque(e.target.value)}
                      className="input-field"
                      min="30"
                      max={conta.saldo_disponivel}
                      step="0.01"
                      required
                    />
                  </div>
                  {erro && <p className="text-sm text-red-600">{erro}</p>}
                  {sucesso && <p className="text-sm text-green-600">{sucesso}</p>}
                  <button type="submit" disabled={solicitandoSaque} className="btn-primary w-full">
                    {solicitandoSaque ? "Solicitando..." : "Solicitar saque via PIX"}
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
