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
      throw error;
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const totalFalhas = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = totalFalhas[0]?.total || 0;

    if (Number(total) > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Limite de Backlog Excedido</b>\n` +
        `Falhas abertas: ${total}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
      return;
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
    `;
  } catch (error) {
    if (error instanceof Error && error.message !== "DB_TIMEOUT") {
      console.error("Erro ao registrar falha:", error);
    }
  }
}

export async function resolverFalha(id: number, solucao: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, solucao = ${solucao}, resolvido_em = NOW()
      WHERE id = ${id}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${id}\n` +
      `Solução: ${solucao}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasAbertasPorAgente(agente: string): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 10
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas abertas:", error);
    return [];
  }
}

export async function atribuirFalhaAoEspecialista(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);

    if (!especialista) {
      throw new Error("Especialista não encontrado");
    }

    await sql`
      UPDATE falhas_agentes
      SET atribuido_a = ${especialista}, atribuido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `📋 <b>Falha Atribuída ao Especialista</b>\n` +
      `ID: ${falhaId}\n` +
      `Especialista: ${especialista}\n`
    );
  } catch (error) {
    console.error("Erro ao atribuir falha:", error);
  }
}

export async function escalarFalhaAoGerente(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel(agente);

    if (!gerente) {
      throw new Error("Gerente não encontrado");
    }

    await sql`
      UPDATE falhas_agentes
      SET atribuido_a = ${gerente}, nivel_escalacao = 'gerente', atribuido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `⚠️ <b>Falha Escalada ao Gerente</b>\n` +
      `ID: ${falhaId}\n` +
      `Gerente: ${gerente}\n`
    );
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function validarWebhookMercadoPago(
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

export async function processarWebhookComRetentativa(
  agente: string,
  payload: unknown,
  maxTentativas: number = 3
): Promise<{ sucesso: boolean; statusCode: number; mensagem: string }> {
  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const validacao = await validarAssinaturaMercadoPago(payload);

      if (!validacao.valid) {
        await registrarFalha(
          agente,
          `[Tentativa ${tentativa}] ${validacao.message}`,
          { statusCode: validacao.statusCode, payload }
        );

        if (tentativa === maxTentativas) {
          return {
            sucesso: false,
            statusCode: validacao.statusCode,
            mensagem: validacao.message,
          };
        }

        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, tentativa - 1) * 1000)
        );
        continue;
      }

      return {
        sucesso: true,
        statusCode: 200,
        mensagem: "Webhook processado com sucesso",
      };
    } catch (error) {
      ultimoErro = error instanceof Error ? error : new Error(String(error));

      if (tentativa === maxTentativas) {
        await registrarFalha(
          agente,
          `Falha após ${maxTentativas} tentativas: ${ultimoErro.message}`,
          { payload, tentativas: maxTentativas }