import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { getGerenteResponsavel, getEspecialistaResponsavel } from "@/lib/hierarquia";

const LIMITE_ESPECIALISTA = 3;
const LIMITE_GERENTE = 4;
const LIMITE_CLAUDE = 5;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;
const DB_TIMEOUT = 5000;
const HTTP_TIMEOUT = 55000;
const LIMITE_BACKLOG = 100;
const TEMPO_RETENCAO_FALHAS = 24;

interface FalhaResult {
  total: number;
}

interface WebhookValidacaoPayload {
  agente: string;
  erro: string;
  dados?: Record<string, unknown>;
  statusCode?: number;
}

interface WebhookMercadoPagoPayload {
  type?: string;
  data?: {
    id?: string;
  };
}

interface FalhaRegistro {
  id: number;
  agente: string;
  erro: string;
  resolvido: boolean;
  criado_em: string;
}

export async function validarAssinaturaMercadoPago(
  payload: unknown
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  try {
    if (payload === null || payload === undefined) {
      return {
        valid: false,
        statusCode: 400,
        message: "Payload inválido ou vazio",
      };
    }

    if (typeof payload !== "object") {
      return {
        valid: false,
        statusCode: 400,
        message: "Payload deve ser um objeto",
      };
    }

    const webhookPayload = payload as WebhookMercadoPagoPayload;

    if (!webhookPayload.type || !webhookPayload.data?.id) {
      return {
        valid: false,
        statusCode: 400,
        message: "Campos obrigatórios ausentes: type ou data.id",
      };
    }

    return {
      valid: true,
      statusCode: 200,
      message: "Validação bem-sucedida",
    };
  } catch (error) {
    return {
      valid: false,
      statusCode: 500,
      message: `Erro na validação: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
  }
}

export async function limparBacklogFalhas(): Promise<void> {
  try {
    const falhasAntiga = await Promise.race<Array<{ id: number }>>([
      sql<Array<{ id: number }>>`
        SELECT id FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        AND resolvido = TRUE
        LIMIT 1000
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(falhasAntiga) && falhasAntiga.length > 0) {
      const ids = falhasAntiga.map((f) => f.id);
      await sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${ids})
      `;

      await enviarTelegram(
        `🧹 <b>Limpeza de Backlog Executada</b>\n` +
        `Registros removidos: ${ids.length}\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout na Limpeza de Backlog</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
      );
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  statusCode?: number
): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes (agente, erro, status_code, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${statusCode || 500}, false, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const contagem = await Promise.race<Array<{ total: number }>>([
      sql<Array<{ total: number }>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(contagem) && contagem.length > 0 ? contagem[0].total : 0;

    if (total >= LIMITE_BACKLOG) {
      await notificarBacklogCritico(total);
    }
  } catch (error) {
    console.error(`Erro ao registrar falha [${agente}]:`, error);
  }
}

export async function notificarBacklogCritico(total: number): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel();
    
    await enviarTelegram(
      `🚨 <b>BACKLOG CRÍTICO DETECTADO</b>\n` +
      `Total de falhas não resolvidas: ${total}\n` +
      `Gerente responsável: ${gerente?.nome || "Não atribuído"}\n` +
      `⏰ Timestamp: ${new Date().toISOString()}\n`,
      gerente?.telegram_id
    );
  } catch (error) {
    console.error("Erro ao notificar backlog crítico:", error);
  }
}

export async function processarFalhas(): Promise<void> {
  try {
    const falhasNaoResolvidas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em ASC
        LIMIT 10
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(falhasNaoResolvidas) || falhasNaoResolvidas.length === 0) {
      return;
    }

    for (const falha of falhasNaoResolvidas) {
      const tentativas = await obterTentativasAtual(falha.id);

      if (tentativas >= LIMITE_ESPECIALISTA) {
        const especialista = await getEspecialistaResponsavel(falha.agente);
        await escalarParaEspecialista(falha, especialista);
      }

      if (tentativas >= LIMITE_GERENTE) {
        const gerente = await getGerenteResponsavel();
        await escalarParaGerente(falha, gerente);
      }

      if (tentativas >= LIMITE_CLAUDE) {
        await escalarParaClaude(falha);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error("Timeout ao processar falhas");
    } else {
      console.error("Erro ao processar falhas:", error);
    }
  }
}

async function obterTentativasAtual(falhaId: number): Promise<number> {
  try {
    const resultado = await Promise.race<Array<{ count: number }>>([
      sql<Array<{ count: number }>>`
        SELECT COUNT(*) as count FROM escalacoes
        WHERE falha_id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(resultado) && resultado.length > 0 ? resultado[0].count : 0;
  } catch {
    return 0;
  }
}

async function escalarParaEspecialista(
  falha: FalhaRegistro,
  especialista: { id: number; nome: string; telegram_id?: string } | null
): Promise<void> {
  try {
    await sql`
      INSERT INTO escalacoes (falha_id, nivel, usuario_id, criado_em)
      VALUES (${falha.id}, 'especialista', ${especialista?.id || null}, NOW())
    `;

    await enviarTelegram(
      `⚠️ <b>Falha Escalada para Especialista</b>\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `Especialista: ${especialista?.nome || "Não atribuído"}\n`
    );
  } catch (error) {
    console.error("Erro ao escalar para especialista:", error);
  }
}

async function escalarParaGerente(
  falha: FalhaRegistro,
  gerente: { id: number; nome: string; telegram_id?: string } | null
): Promise<void> {
  try {
    await sql`
      INSERT INTO escalacoes (falha_id, nivel, usuario_id, criado_em)
      VALUES (${falha.id}, 'gerente', ${gerente?.id || null}, NOW())
    `;

    await enviarTelegram(
      `🔴 <b>Falha Escalada para Gerente</b>\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `Gerente: ${gerente?.nome || "Não atribuído"}\n`
    );
  } catch (error) {
    console.error("Erro ao escalar para gerente:", error);
  }
}

async function escalarParaClaude(falha: FalhaRegistro): Promise<void> {
  try {
    await sql`
      INSERT INTO escalacoes (falha_id, nivel, criado_em)
      VALUES (${falha.id}, 'claude', NOW())
    `;

    await enviarTelegram(
      `🤖 <b>Falha Escalada para Claude AI</b>\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `Status: Aguardando análise de IA...\n`
    );
  } catch (error) {
    console.error("Erro ao escalar para Claude:", error);
  }
}

export async function resolverFalha(falhaId: number, solucao: string): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, solucao = ${solucao}, resolvido_em = NOW()
        WHERE id = ${falha