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
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const falhasAntiga = (await Promise.race([
        sql`
          SELECT id FROM falhas_agentes
          WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
          AND resolvido = TRUE
          LIMIT 1000
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as Array<{ id: number }>;

      if (timeoutId) clearTimeout(timeoutId);

      if (Array.isArray(falhasAntiga) && falhasAntiga.length > 0) {
        const ids = falhasAntiga.map((f) => f.id);
        await sql`
          DELETE FROM falhas_agentes
          WHERE id = ANY(${ids})
        `;

        await enviarTelegram(
          `🧹 <b>Limpeza de Backlog Executada</b>\n` +
          `Registros removidos: ${ids.length}\n` +
          `Retenção: ${TEMPO_RETENCAO_FALHAS}h`
        );
      }

      timeoutId = setTimeout(() => {
        throw new Error("DB_TIMEOUT");
      }, DB_TIMEOUT);

      const totalAbertoResult = (await Promise.race([
        sql`
          SELECT COUNT(*) as total FROM falhas_agentes
          WHERE resolvido = FALSE
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as FalhaResult[];

      if (timeoutId) clearTimeout(timeoutId);

      const totalAberto = totalAbertoResult[0]?.total || 0;

      if (totalAberto > LIMITE_BACKLOG) {
        await enviarTelegram(
          `⚠️ <b>Alerta: Backlog de Falhas Elevado</b>\n` +
          `Total aberto: ${totalAberto}\n` +
          `Limite: ${LIMITE_BACKLOG}`
        );
      }
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[limparBacklogFalhas] Erro:", errorMessage);
    await enviarTelegram(
      `❌ <b>Erro na Limpeza de Backlog</b>\n` +
      `Erro: ${errorMessage}`
    ).catch(() => {});
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
    `;

    const especialista = await getEspecialistaResponsavel(agente);
    if (especialista) {
      await enviarTelegram(
        `🚨 <b>Falha Registrada</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Especialista: ${especialista}`
      );
    }
  } catch (error) {
    console.error("[registrarFalhaAgente] Erro ao registrar:", error);
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = (await sql`
      SELECT * FROM falhas_agentes WHERE id = ${falhaId}
    `) as FalhaRegistro[];

    if (!Array.isArray(falha) || falha.length === 0) {
      throw new Error("Falha não encontrada");
    }

    const falhaRegistro = falha[0];

    if (nivelEscalacao === "especialista") {
      const especialista = await getEspecialistaResponsavel(falhaRegistro.agente);
      if (especialista) {
        await enviarTelegram(
          `📊 <b>Falha Escalada para Especialista</b>\n` +
          `ID: ${falhaId}\n` +
          `Agente: ${falhaRegistro.agente}\n` +
          `Especialista: ${especialista}`
        );
      }
    } else if (nivelEscalacao === "gerente") {
      const gerente = await getGerenteResponsavel(falhaRegistro.agente);
      if (gerente) {
        await enviarTelegram(
          `👔 <b>Falha Escalada para Gerente</b>\n` +
          `ID: ${falhaId}\n` +
          `Agente: ${falhaRegistro.agente}\n` +
          `Gerente: ${gerente}`
        );
      }
    } else if (nivelEscalacao === "claude") {
      await enviarTelegram(
        `🤖 <b>Falha Escalada para Claude (IA)</b>\n` +
        `ID: ${falhaId}\n` +
        `Agente: ${falhaRegistro.agente}\n` +
        `Erro: ${falhaRegistro.erro}`
      );
    }

    await sql`
      UPDATE falhas_agentes
      SET escalacao = ${nivelEscalacao}
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    console.error("[escalarFalha] Erro ao escalar:", error);
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}`
    );
  } catch (error) {
    console.error("[resolverFalha] Erro ao resolver:", error);
  }
}

export async function obterFalhasAbertas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = (await sql`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 50
    `) as FalhaRegistro[];

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("[obterFalhasAbertas] Erro:", error);
    return [];
  }
}

export async function verificarTaxaErros(): Promise<{ taxa: number; alerta: boolean }> {
  try {
    const resultado = (await sql`
      SELECT 
        COUNT(*) FILTER (WHERE criado_em > NOW() - INTERVAL '2 hours' AND resolvido = FALSE) as erros_recentes,
        COUNT(*) FILTER (WHERE criado_em > NOW() - INTERVAL '2 hours') as total_recente
      FROM falhas_agentes
    `) as Array<{ erros_recentes: number; total_recente: number }>;

    if (!Array.isArray(resultado) || resultado.length === 0) {
      return { taxa: 0, alerta: false };
    }

    const { erros_recentes, total_recente } = resultado[0];
    const taxa = total_recente > 0 ? (erros_recentes / total_recente) * 100 : 0;

    return {
      taxa: Math.round(taxa),
      alerta: taxa > 30,
    };
  } catch (error) {
    console.error("[verificarTaxaErros] Erro:", error);
    return { taxa: 0, alerta: false };
  }
}