/**
 * Hierarquia de escalação — Alerta Patriota
 *
 * Fluxo:
 * Fiscal detecta → tenta auto-fix → reporta ao Gerente → Gerente escala ao CEO
 * → CEO alerta Leandro via Telegram → Claude como último recurso absoluto
 *
 * Níveis:
 * 4 — Fiscais (detecção 24/7)
 * 3 — Especialistas (auto-cura por serviço)
 * 2 — Gerentes (análise e coordenação)
 * 1 — General Alves CEO (decisão executiva + Telegram para Leandro)
 * 0 — Claude / Anthropic (correção de código quando tudo falhou)
 */

export type NivelSeveridade = "critico" | "alto" | "medio" | "baixo";

export interface EntradaHierarquia {
  gerente: string;       // rota do gerente responsável
  especialista?: string; // agente que tenta auto-fix antes do gerente
  nivel?: NivelSeveridade; // severidade padrão quando esse agente falha
}

export const HIERARQUIA: Record<string, EntradaHierarquia> = {

  // ── FISCAIS DE INFRAESTRUTURA → Coronel Técnico ─────────────────────────
  "fiscal-login":       { gerente: "gerente-tecnico", nivel: "alto" },
  "fiscal-api":         { gerente: "gerente-tecnico", nivel: "alto" },
  "fiscal-whatsapp":    { gerente: "gerente-tecnico", especialista: "agente-medico", nivel: "critico" },
  "fiscal-banco":       { gerente: "gerente-tecnico", especialista: "agente-medico", nivel: "critico" },
  "fiscal-pagamentos":  { gerente: "gerente-financeiro", nivel: "alto" },
  "fiscal-facebook":    { gerente: "gerente-tecnico", nivel: "medio" },
  "guardiao-seguranca": { gerente: "gerente-tecnico", nivel: "critico" },
  "backup":             { gerente: "gerente-tecnico", nivel: "medio" },
  "agente-medico":      { gerente: "gerente-tecnico", nivel: "critico" },
  "fila-dlq":           { gerente: "gerente-tecnico", nivel: "alto" },
  "carlos-disjuntor":   { gerente: "gerente-tecnico", nivel: "alto" },

  // ── NOVOS FISCAIS DE INFRAESTRUTURA ─────────────────────────────────────
  "arturo-apis":        { gerente: "gerente-tecnico", especialista: "agente-medico", nivel: "critico" },
  "max-memoria":        { gerente: "gerente-tecnico", nivel: "medio" },
  "wagner-workflow":    { gerente: "gerente-tecnico", nivel: "alto" },

  // ── FISCAIS DE CONTEÚDO → Sargento Conteúdo ────────────────────────────
  "neto-noticias":         { gerente: "gerente-conteudo", nivel: "alto" },
  "curador-carlos":        { gerente: "gerente-conteudo", nivel: "alto" },
  "bernardo-resumidor":    { gerente: "gerente-conteudo", nivel: "alto" },
  "gerador-card":          { gerente: "gerente-conteudo", especialista: "mateus-manchete", nivel: "critico" },
  "raquel-radar":          { gerente: "gerente-conteudo", nivel: "medio" },
  "igor-internacional":    { gerente: "gerente-conteudo", nivel: "medio" },
  "cavalcanti-resumidor":  { gerente: "gerente-conteudo", nivel: "medio" },
  "davi-dossie":           { gerente: "gerente-conteudo", nivel: "medio" },
  "tereza-termometro":     { gerente: "gerente-conteudo", nivel: "medio" },
  "analise-semanal-vip":   { gerente: "gerente-conteudo", nivel: "medio" },

  // ── NOVOS FISCAIS DE CONTEÚDO ────────────────────────────────────────────
  "flora-foto":            { gerente: "gerente-conteudo", nivel: "critico" },
  "diana-duplicata":       { gerente: "gerente-conteudo", nivel: "alto" },
  "clara-conteudo":        { gerente: "gerente-conteudo", nivel: "alto" },
  "mateus-manchete":       { gerente: "gerente-conteudo", nivel: "critico" },
  "sofia-stoque":          { gerente: "gerente-conteudo", especialista: "mateus-manchete", nivel: "critico" },
  "roberto-rss":           { gerente: "gerente-conteudo", nivel: "alto" },
  "pedro-pontual":         { gerente: "gerente-conteudo", nivel: "critico" },
  "vera-verificacao":      { gerente: "gerente-conteudo", nivel: "alto" },
  "vitor-validador":       { gerente: "gerente-conteudo", nivel: "medio" },
  "fabio-fomo":            { gerente: "gerente-conteudo", nivel: "medio" },
  "marcio-crise":          { gerente: "gerente-conteudo", nivel: "alto" },

  // ── FISCAIS FINANCEIROS → Major Financeiro ──────────────────────────────
  "fiscal-inadimplentes":  { gerente: "gerente-financeiro", nivel: "alto" },
  "marcos-mrr":            { gerente: "gerente-financeiro", nivel: "alto" },
  "tereza-trial":          { gerente: "gerente-financeiro", nivel: "alto" },
  "rodrigo-risco":         { gerente: "gerente-financeiro", nivel: "medio" },
  "diego-desistentes":     { gerente: "gerente-financeiro", nivel: "medio" },
  "rebeca-recuperacao":    { gerente: "gerente-financeiro", nivel: "medio" },
  "augusto-assinaturas":   { gerente: "gerente-financeiro", especialista: "fila-dlq", nivel: "critico" },
  "victor-visao":          { gerente: "gerente-financeiro", nivel: "medio" },

  // ── FISCAIS DE CLIENTES → Capitã Clientes ──────────────────────────────
  "engajamento":           { gerente: "gerente-clientes", nivel: "medio" },
  "enzo-engajamento":      { gerente: "gerente-clientes", nivel: "medio" },
  "miguel-moderacao":      { gerente: "gerente-clientes", nivel: "medio" },
  "cintia-conversao":      { gerente: "gerente-clientes", nivel: "medio" },
  "ulisses-upgrade":       { gerente: "gerente-clientes", nivel: "baixo" },
  "regina-recepcao":       { gerente: "gerente-clientes", nivel: "medio" },
  "bot-responder":         { gerente: "gerente-clientes", nivel: "medio" },
  "carlos-cargo":          { gerente: "gerente-clientes", nivel: "alto" },
  "moderacao-grupo":       { gerente: "gerente-clientes", nivel: "medio" },

  // ── ESCALONAMENTO FINAL ─────────────────────────────────────────────────
  "escalar-claude":        { gerente: "general-alves-ceo", nivel: "critico" },
  "paulo-ping":            { gerente: "general-alves-ceo", nivel: "baixo" },
};

export function getGerente(agente: string): string {
  return HIERARQUIA[agente]?.gerente ?? "gerente-tecnico";
}

export function getEspecialista(agente: string): string | undefined {
  return HIERARQUIA[agente]?.especialista;
}

export function getSeveridade(agente: string): NivelSeveridade {
  return HIERARQUIA[agente]?.nivel ?? "medio";
}

/** Reporta falha ao gerente responsável via API call */
export async function escalarParaGerente(
  agente: string,
  erro: string,
  detalhes?: Record<string, unknown>
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
  const secret = process.env.CRON_SECRET;
  const gerente = getGerente(agente);

  try {
    await fetch(`${appUrl}/api/cron/${gerente}?agente_origem=${agente}&erro=${encodeURIComponent(erro)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Falha silenciosa — o Telegram já foi alertado pelo fiscal
  }

  // Registra a escalação
  const { sql } = await import("@/lib/db");
  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes)
    VALUES (${agente}, 'escalacao_gerente', 'aviso',
      ${JSON.stringify({ gerente, erro, detalhes })})
  `.catch(() => {});
}
