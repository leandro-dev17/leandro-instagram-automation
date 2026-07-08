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
        `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
      );
    }
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const resultado = await Promise.race<FalhaResult>([
      sql<Array<FalhaResult>>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
        RETURNING COUNT(*) as total
      `.then((res) => res[0] || { total: 0 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (resultado.total === 0) {
      throw new Error("Falha não foi registrada no banco de dados");
    }

    const countResult = await sql<Array<{ count: string }>>`
      SELECT COUNT(*) as count FROM falhas_agentes WHERE resolvido = FALSE
    `;

    const backlogCount = parseInt(countResult[0]?.count || "0", 10);

    if (backlogCount > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Backlog Crítico Detectado</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas não resolvidas: ${backlogCount}\n` +
        `Erro: ${erro}\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`[${agente}] Timeout ao registrar falha`);
    } else {
      console.error(`[${agente}] Erro ao registrar falha:`, error);
    }
  }
}

export async function resolverFalhaAgente(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`[falhaId: ${falhaId}] Timeout ao resolver falha`);
    } else {
      console.error(`[falhaId: ${falhaId}] Erro ao resolver falha:`, error);
    }
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em ASC
        LIMIT 50
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error("Timeout ao obter falhas não resolvidas");
    } else {
      console.error("Erro ao obter falhas não resolvidas:", error);
    }
    return [];
  }
}

export async function escalarFalhaParaEspecialista(
  falhaId: number,
  agente: string
): Promise<boolean> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);

    if (!especialista) {
      await registrarFalhaAgente(
        "escalacao-falha",
        "Nenhum especialista disponível para escalar",
        { falhaId, agente }
      );
      return false;
    }

    const resultado = await Promise.race<Array<{ count: string }>>([
      sql`
        SELECT COUNT(*) as count
        FROM escalacoes_falhas
        WHERE especialista = ${especialista}
        AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const escalacoesPendentes = parseInt(resultado[0]?.count || "0", 10);

    if (escalacoesPendentes >= LIMITE_ESPECIALISTA) {
      const gerente = await getGerenteResponsavel(agente);

      if (gerente) {
        await sql`
          INSERT INTO escalacoes_falhas (falha_id, gerente, criado_em, resolvido)
          VALUES (${falhaId}, ${gerente}, NOW(), FALSE)
        `;

        await enviarTelegram(
          `📈 <b>Falha Escalada para Gerente</b>\n` +
          `Falha ID: ${falhaId}\n` +
          `Agente: ${agente}\n` +
          `Gerente: ${gerente}\n`
        );

        return true;
      }
    } else {
      await sql`
        INSERT INTO escalacoes_falhas (falha_id, especialista, criado_em, resolvido)
        VALUES (${falhaId}, ${especialista}, NOW(), FALSE)
      `;

      await enviarTelegram(
        `📋 <b>Falha Escalada para Especialista</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${agente}\n` +
        `Especialista: ${especialista}\n`
      );

      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`[falhaId: ${falhaId}] Timeout ao escalar falha`);
    } else {
      console.error(`[falhaId: ${falhaId}] Erro ao escalar falha:`, error);
    }
    return false;
  }
}

export async function processarFalhasAgentes(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      if (falha.agente === "webhook_mp_valida_assinatura") {
        const escalado = await escalarFalhaParaEspecialista(
          falha.id,
          falha.agente
        );

        if (escalado) {
          await resolverFalhaAgente(
            falha.id,
            "Escalada para especialista/gerente"
          );
        }
      }
    }

    await limparBacklogFalhas();
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao Processar Falhas</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n