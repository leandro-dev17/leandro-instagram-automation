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

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE)
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Registrar Falha</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n` +
      `Detalhes: ${errorMessage}\n`
    );
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Obter Falhas</b>\n` +
      `Detalhes: ${errorMessage}\n`
    );
    return [];
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Resolver Falha</b>\n` +
      `ID: ${falhaId}\n` +
      `Detalhes: ${errorMessage}\n`
    );
  }
}

export async function escalarFalhaParaEspecialista(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);

    if (!especialista) {
      throw new Error("Especialista não encontrado");
    }

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET escalado_para = ${especialista}, escalado_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `🔴 <b>Falha Escalada para Especialista</b>\n` +
      `ID: ${falhaId}\n` +
      `Agente: ${agente}\n` +
      `Especialista: ${especialista}\n`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Escalar Falha</b>\n` +
      `ID: ${falhaId}\n` +
      `Detalhes: ${errorMessage}\n`
    );
  }
}

export async function escalarFalhaParaGerente(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel(agente);

    if (!gerente) {
      throw new Error("Gerente não encontrado");
    }

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET escalado_para = ${gerente}, escalado_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `🔴 <b>Falha Escalada para Gerente</b>\n` +
      `ID: ${falhaId}\n` +
      `Agente: ${agente}\n` +
      `Gerente: ${gerente}\n`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Escalar Falha para Gerente</b>\n` +
      `ID: ${falhaId}\n` +
      `Detalhes: ${errorMessage}\n`
    );
  }
}

export async function contarFalhasNaoResolvidas(): Promise<number> {
  try {
    const result = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(result) && result.length > 0 ? result[0].total : 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Contar Falhas</b>\n` +
      `Detalhes: ${errorMessage}\n`
    );
    return 0;
  }
}

export async function processarFalhas(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const tentativas = await contarTentativasResolucao(falha.id);

      if (tentativas >= LIMITE_ESPECIALISTA) {
        await escalarFalhaParaGerente(falha.id, falha.agente);
      } else if (tentativas >= LIMITE_ESPECIALISTA) {
        await escalarFalhaParaEspecialista(falha.id, falha.agente);
      }
    }

    const totalFalhas = await contarFalhasNaoResolvidas();
    if (totalFalhas > 0) {
      await