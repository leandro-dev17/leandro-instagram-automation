"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Mensagem = {
  id: number;
  mensagem: string;
  status: string;
  tentativas: number;
  created_at: string;
  enviado_em: string | null;
  telefone: string;
};

export default function AdminWhatsAppPage() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "pendente" | "enviado">("todos");
  const [mostraEnvio, setMostraEnvio] = useState(false);
  const [telefone, setTelefone] = useState("");
  const [mensagemManual, setMensagemManual] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [feedbackEnvio, setFeedbackEnvio] = useState("");

  function carregar() {
    fetch("/api/admin/whatsapp/fila")
      .then((r) => r.json())
      .then((data) => { setMensagens(data.dados || []); setCarregando(false); })
      .catch(() => setCarregando(false));
  }

  useEffect(() => { carregar(); }, []);

  async function enviarManual(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setFeedbackEnvio("");
    try {
      const res = await fetch("/api/admin/whatsapp/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone, mensagem: mensagemManual }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedbackEnvio("✅ Mensagem enviada!");
        setTelefone("");
        setMensagemManual("");
        carregar();
      } else {
        setFeedbackEnvio(`❌ ${data.erro || "Erro ao enviar"}`);
      }
    } catch {
      setFeedbackEnvio("❌ Erro de conexão");
    } finally {
      setEnviando(false);
    }
  }

  const filtrados = mensagens.filter((m) => {
    if (filtro === "pendente") return m.status === "pendente";
    if (filtro === "enviado") return m.status === "enviado";
    return true;
  });

  const pendentes = mensagens.filter((m) => m.status === "pendente").length;
  const enviados = mensagens.filter((m) => m.status === "enviado").length;

  function formatarData(d: string) {
    return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center justify-between shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <div className="flex items-center gap-2">
          <Link href="/admin" className="text-white opacity-70 hover:opacity-100 mr-1">←</Link>
          <span className="text-2xl">💬</span>
          <span className="text-white font-bold">Fila WhatsApp</span>
        </div>
        <button
          onClick={() => { setMostraEnvio(true); setFeedbackEnvio(""); }}
          className="text-white text-sm font-semibold bg-white bg-opacity-20 px-3 py-1 rounded-lg"
        >
          + Enviar mensagem
        </button>
      </header>

      <div className="px-4 pt-4 pb-8 max-w-3xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: "Total", valor: mensagens.length, cor: "var(--vovo-marrom)" },
            { label: "Pendentes", valor: pendentes, cor: "var(--vovo-laranja)" },
            { label: "Enviados", valor: enviados, cor: "var(--vovo-verde)" },
          ].map((s) => (
            <div key={s.label} className="card text-center py-3">
              <div className="text-2xl font-bold" style={{ color: s.cor }}>{s.valor}</div>
              <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-4">
          {(["todos", "pendente", "enviado"] as const).map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: filtro === f ? "var(--vovo-marrom)" : "white",
                color: filtro === f ? "white" : "var(--vovo-marrom)",
                border: "1.5px solid",
                borderColor: filtro === f ? "var(--vovo-marrom)" : "#e5e0da",
              }}>
              {f === "todos" ? "Todos" : f === "pendente" ? "Pendentes" : "Enviados"}
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">💬</div></div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>Nenhuma mensagem encontrada</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtrados.map((m) => (
              <div key={m.id} className="card p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold" style={{ color: "var(--vovo-marrom)" }}>
                    📱 {m.telefone}
                  </p>
                  <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: m.status === "enviado" ? "rgba(107,143,113,0.15)" : "rgba(232,168,124,0.2)",
                      color: m.status === "enviado" ? "var(--vovo-verde)" : "var(--vovo-laranja)",
                    }}>
                    {m.status === "enviado" ? "✓ Enviado" : "⏳ Pendente"}
                  </span>
                </div>
                <p className="text-xs mb-1 line-clamp-2" style={{ color: "var(--vovo-marrom-mid)" }}>{m.mensagem}</p>
                <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>
                  {m.enviado_em ? `Enviado: ${formatarData(m.enviado_em)}` : `Criado: ${formatarData(m.created_at)}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal envio manual */}
      {mostraEnvio && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold" style={{ color: "var(--vovo-marrom)" }}>💬 Enviar mensagem manual</h2>
              <button onClick={() => setMostraEnvio(false)} style={{ color: "var(--vovo-lock)" }}>✕</button>
            </div>

            <form onSubmit={enviarManual} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>
                  Telefone (com DDD, somente números)
                </label>
                <input
                  type="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  className="input-field"
                  placeholder="47999999999"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Mensagem</label>
                <textarea
                  value={mensagemManual}
                  onChange={(e) => setMensagemManual(e.target.value)}
                  className="input-field resize-none"
                  rows={5}
                  placeholder="Digite a mensagem que será enviada pelo WhatsApp..."
                  required
                />
                <p className="text-xs mt-1" style={{ color: "var(--vovo-lock)" }}>{mensagemManual.length} caracteres</p>
              </div>

              {feedbackEnvio && (
                <p className="text-sm font-medium text-center p-2 rounded-xl"
                  style={{ backgroundColor: feedbackEnvio.startsWith("✅") ? "#f0fdf4" : "#fef2f2", color: feedbackEnvio.startsWith("✅") ? "#16a34a" : "#dc2626" }}>
                  {feedbackEnvio}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setMostraEnvio(false)} className="btn-secondary flex-1 text-sm">Cancelar</button>
                <button type="submit" disabled={enviando} className="btn-primary flex-1 text-sm">
                  {enviando ? "Enviando..." : "📤 Enviar agora"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
