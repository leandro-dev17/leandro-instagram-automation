"use client";

import { useState } from "react";

export default function ListaDeEsperaPage() {
  const [form, setForm] = useState({ nome: "", email: "", telefone: "", plano: "vip" });
  const [status, setStatus] = useState<"idle" | "loading" | "sucesso" | "erro">("idle");
  const [erroMsg, setErroMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErroMsg("");

    try {
      const res = await fetch("/api/lista-de-espera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json() as { ok?: boolean; erro?: string };

      if (res.ok && data.ok) {
        setStatus("sucesso");
      } else {
        setErroMsg(data.erro || "Erro ao enviar. Tente novamente.");
        setStatus("erro");
      }
    } catch {
      setErroMsg("Erro de conexão. Tente novamente.");
      setStatus("erro");
    }
  }

  const styles = {
    page: {
      minHeight: "100vh",
      backgroundColor: "#0d0d1a",
      color: "#e8e8e8",
      fontFamily: "Arial, sans-serif",
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      padding: "48px 24px",
    },
    header: {
      textAlign: "center" as const,
      marginBottom: "48px",
    },
    logo: {
      fontSize: "28px",
      fontWeight: "bold",
      color: "#ffd700",
      letterSpacing: "2px",
      display: "block",
      marginBottom: "8px",
    },
    badge: {
      display: "inline-block",
      backgroundColor: "#c0392b",
      color: "#fff",
      fontSize: "11px",
      fontWeight: "bold",
      padding: "4px 12px",
      borderRadius: "2px",
      letterSpacing: "1px",
    },
    card: {
      backgroundColor: "#12122a",
      border: "1px solid #2a2a3e",
      borderRadius: "8px",
      padding: "40px 36px",
      maxWidth: "480px",
      width: "100%",
    },
    h1: {
      color: "#ffd700",
      fontSize: "24px",
      margin: "0 0 12px",
      lineHeight: "1.3",
    },
    subtitle: {
      color: "#b0b0b0",
      fontSize: "15px",
      lineHeight: "1.6",
      margin: "0 0 32px",
    },
    label: {
      display: "block",
      color: "#888",
      fontSize: "12px",
      fontWeight: "bold",
      letterSpacing: "1px",
      marginBottom: "6px",
      textTransform: "uppercase" as const,
    },
    input: {
      width: "100%",
      backgroundColor: "#1a1a2e",
      border: "1px solid #2a2a3e",
      borderRadius: "4px",
      color: "#e8e8e8",
      fontSize: "15px",
      padding: "12px 14px",
      marginBottom: "20px",
      boxSizing: "border-box" as const,
      outline: "none",
    },
    select: {
      width: "100%",
      backgroundColor: "#1a1a2e",
      border: "1px solid #2a2a3e",
      borderRadius: "4px",
      color: "#e8e8e8",
      fontSize: "15px",
      padding: "12px 14px",
      marginBottom: "28px",
      boxSizing: "border-box" as const,
      outline: "none",
      cursor: "pointer",
    },
    btn: {
      width: "100%",
      backgroundColor: "#c0392b",
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      fontSize: "16px",
      fontWeight: "bold",
      padding: "16px",
      cursor: "pointer",
      letterSpacing: "0.5px",
    },
    btnDisabled: {
      opacity: 0.6,
      cursor: "not-allowed",
    },
    sucesso: {
      textAlign: "center" as const,
      padding: "20px 0",
    },
    erroMsg: {
      backgroundColor: "#2a0a0a",
      border: "1px solid #c0392b",
      color: "#ff6b6b",
      padding: "12px 16px",
      borderRadius: "4px",
      fontSize: "14px",
      marginBottom: "16px",
    },
    info: {
      display: "flex",
      gap: "12px",
      marginTop: "24px",
    },
    infoItem: {
      flex: 1,
      backgroundColor: "#0d0d1a",
      border: "1px solid #2a2a3e",
      borderRadius: "4px",
      padding: "14px",
      textAlign: "center" as const,
    },
    infoNum: {
      color: "#ffd700",
      fontSize: "22px",
      fontWeight: "bold",
      display: "block",
      marginBottom: "4px",
    },
    infoLabel: {
      color: "#666",
      fontSize: "11px",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px",
    },
  };

  if (status === "sucesso") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.sucesso}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>✅</div>
            <h2 style={{ color: "#ffd700", fontSize: "22px", marginBottom: "12px" }}>
              Você está na lista!
            </h2>
            <p style={{ color: "#b0b0b0", fontSize: "15px", lineHeight: "1.6", margin: "0 0 8px" }}>
              Assim que uma vaga abrir no grupo <strong style={{ color: "#ffd700" }}>{form.plano.toUpperCase()}</strong>, você será o primeiro avisado.
            </p>
            <p style={{ color: "#666", fontSize: "13px", margin: 0 }}>
              Confirme seu e-mail na caixa de entrada.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <span style={styles.logo}>⚡ ALERTA PATRIOTA</span>
        <span style={styles.badge}>VAGAS LIMITADAS</span>
      </div>

      <div style={styles.card}>
        <h1 style={styles.h1}>Grupo VIP Premium — Lista de Espera</h1>
        <p style={styles.subtitle}>
          As vagas são limitadas. Entre na lista e seja o primeiro avisado quando abrir uma vaga.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          {status === "erro" && erroMsg && (
            <div style={styles.erroMsg}>{erroMsg}</div>
          )}

          <label style={styles.label} htmlFor="nome">Seu nome completo</label>
          <input
            id="nome"
            style={styles.input}
            type="text"
            placeholder="Ex: Carlos Patriota"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required
          />

          <label style={styles.label} htmlFor="email">E-mail</label>
          <input
            id="email"
            style={styles.input}
            type="email"
            placeholder="seu@email.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />

          <label style={styles.label} htmlFor="telefone">WhatsApp (com DDD)</label>
          <input
            id="telefone"
            style={styles.input}
            type="tel"
            placeholder="(47) 99999-9999"
            value={form.telefone}
            onChange={(e) => setForm({ ...form, telefone: e.target.value })}
            required
          />

          <label style={styles.label} htmlFor="plano">Plano de interesse</label>
          <select
            id="plano"
            style={styles.select}
            value={form.plano}
            onChange={(e) => setForm({ ...form, plano: e.target.value })}
          >
            <option value="vip">VIP Premium — R$9,90/mês</option>
            <option value="elite">Elite Global — R$19,90/mês</option>
          </select>

          <button
            type="submit"
            style={{ ...styles.btn, ...(status === "loading" ? styles.btnDisabled : {}) }}
            disabled={status === "loading"}
          >
            {status === "loading" ? "AGUARDE..." : "ENTRAR NA LISTA DE ESPERA →"}
          </button>
        </form>

        <div style={styles.info}>
          <div style={styles.infoItem}>
            <span style={styles.infoNum}>247</span>
            <span style={styles.infoLabel}>na lista</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoNum}>3</span>
            <span style={styles.infoLabel}>vagas/semana</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoNum}>~3sem</span>
            <span style={styles.infoLabel}>espera média</span>
          </div>
        </div>
      </div>
    </div>
  );
}
