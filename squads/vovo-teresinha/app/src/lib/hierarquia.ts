/**
 * Mapa de escalação hierárquica.
 * Cada agente fiscal sabe qual gerente chamar quando não consegue resolver.
 *
 * Hierarquia:
 * Fiscal detecta → Agente Especialista tenta → Gerente analisa → Claude resolve → Leandro (último recurso)
 */

export const HIERARQUIA: Record<string, { gerente: string; especialista?: string }> = {
  // Fiscais técnicos → Gerente Técnico
  "fiscal-banco":              { gerente: "gerente-tecnico", especialista: "circuit-breaker" },
  "fiscal-erros-api":          { gerente: "gerente-tecnico", especialista: "circuit-breaker" },
  "performance":               { gerente: "gerente-tecnico" },
  "saude-pwa":                 { gerente: "gerente-tecnico" },
  "fiscal-diario":             { gerente: "gerente-tecnico" },
  "heartbeat-receitas":        { gerente: "gerente-tecnico" },
  "fiscal-imagens":            { gerente: "gerente-conteudo" },

  // Squad Revisão de Código → Gerente de Código
  "fiscal-codigo-seguranca":   { gerente: "gerente-codigo",  especialista: "revisor-seguranca" },
  "fiscal-codigo-schema":      { gerente: "gerente-codigo",  especialista: "revisor-schema" },
  "fiscal-codigo-logica":      { gerente: "gerente-codigo",  especialista: "revisor-logica" },
  "fiscal-codigo-performance": { gerente: "gerente-codigo" },
  "revisor-schema":            { gerente: "gerente-codigo" },
  "revisor-logica":            { gerente: "gerente-codigo" },
  "revisor-seguranca":         { gerente: "gerente-codigo" },
  "gerente-codigo":            { gerente: "gerente-tecnico" },
  "claude-revisor":            { gerente: "gerente-tecnico" },

  // Fiscais financeiros → Gerente Financeiro
  "fiscal-pagamentos":         { gerente: "gerente-financeiro", especialista: "agente-assinaturas" },
  "reputacao-email":           { gerente: "gerente-financeiro" },
  "preditor-churn":            { gerente: "gerente-financeiro" },

  // Agentes de usuários → Gerente de Clientes
  "fiscal-login":              { gerente: "gerente-clientes" },
  "engajamento":               { gerente: "gerente-clientes" },
  "cacador-desistentes":       { gerente: "gerente-clientes" },
  "campanha-recuperacao":      { gerente: "gerente-clientes" },
  "convite-fim-de-semana":     { gerente: "gerente-clientes" },

  // Retenção → Gerente de Retenção
  "gerente-retencao":          { gerente: "gerente-clientes" },
  "notificador-trial":         { gerente: "gerente-retencao" },
  "sequenciador-onboarding":   { gerente: "gerente-retencao" },
  "conversor-free":            { gerente: "gerente-retencao" },

  // Push → Gerente Técnico
  "enviador-push":             { gerente: "gerente-tecnico", especialista: "saude-pwa" },
  "push-diario":               { gerente: "gerente-tecnico" },

  // Agentes de conteúdo → Gerente de Conteúdo
  "rotacao-receitas-free":     { gerente: "gerente-conteudo" },
  "criador-receitas":          { gerente: "gerente-conteudo" },
  "curador-avaliacoes":        { gerente: "gerente-conteudo" },
  "comunicador-novidades":     { gerente: "gerente-conteudo" },

  // Agentes de infra → Gerente Técnico
  "backup-monitor":            { gerente: "gerente-tecnico" },
  "fila-dlq":                  { gerente: "gerente-tecnico" },
  "circuit-breaker":           { gerente: "gerente-tecnico" },
  "guardiao-seguranca":        { gerente: "gerente-tecnico" },
  "compliance-lgpd":           { gerente: "gerente-tecnico" },
  "limpador-dados":            { gerente: "gerente-tecnico" },

  // Agentes WhatsApp → Gerente de Clientes
  "respondedor-vovo-wpp":      { gerente: "gerente-clientes" },
  "recepcionista-wpp":         { gerente: "gerente-clientes" },
  "publicador-wpp":            { gerente: "gerente-conteudo" },
  "conversor-wpp":             { gerente: "gerente-clientes" },
  "moderacao-grupo":           { gerente: "gerente-clientes" },

  // Agentes de afiliados → Gerente Financeiro
  "calculador-comissao":       { gerente: "gerente-financeiro" },
  "anti-fraude-afiliados":     { gerente: "gerente-financeiro" },
  "confirmador-comissao":      { gerente: "gerente-financeiro" },
  "pagamento-afiliados":       { gerente: "gerente-financeiro" },

  // Agentes do personal (alunas Leandro) → Gerente de Clientes
  "curador-receitas-personal": { gerente: "gerente-clientes" },
  "monitor-alunas":            { gerente: "gerente-clientes" },
  "personalizador-alunas":     { gerente: "gerente-clientes" },

  // Inteligência de mercado → CEO (via Gerente de Conteúdo)
  "observador-mercado":        { gerente: "gerente-conteudo" },
};

export function getGerenteResponsavel(agente: string): string {
  return HIERARQUIA[agente]?.gerente ?? "gerente-tecnico";
}

export function getEspecialistaResponsavel(agente: string): string | undefined {
  return HIERARQUIA[agente]?.especialista;
}
