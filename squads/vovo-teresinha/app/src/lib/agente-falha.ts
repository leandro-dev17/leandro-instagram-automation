```typescript
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
      console.error("Erro ao limpar backlog:", error);
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
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const totalFalhas = await Promise.race<FalhaResult>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(totalFalhas) && totalFalhas[0] ? totalFalhas[0].total : 0;

    if (total > LIMITE_BACKLOG) {
      await limparBacklogFalhas();
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    if (total > LIMITE_BACKLOG * 0.8) {
      await enviarTelegram(
        `⚠️ <b>Backlog de Falhas Alto</b>\n` +
        `Agente: ${agente}\n` +
        `Total de falhas: ${total}\n` +
        `Erro: ${erro}\n`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalha(
  id: number,
  resolucao: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
      WHERE id = ${id}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${id}\n` +
      `Resolução: ${resolucao}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function listarFalhas(
  pagina: number = 1,
  limite: number = 20
): Promise<{ falhas: FalhaRegistro[]; total: number }> {
  try {
    const offset = (pagina - 1) * limite;

    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        ORDER BY criado_em DESC
        LIMIT ${limite} OFFSET ${offset}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalResult = await Promise.race<Array<{ total: number }>>([
      sql<Array<{ total: number }>>`
        SELECT COUNT(*) as total FROM falhas_agentes
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(totalResult) && totalResult[0] ? totalResult[0].total : 0;

    return {
      falhas: Array.isArray(falhas) ? falhas : [],
      total,
    };
  } catch (error) {
    console.error("Erro ao listar falhas:", error);
    return { falhas: [], total: 0 };
  }
}

export async function escalarFalha(
  id: number,
  nivel: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    let responsavel: string | null = null;

    if (nivel === "especialista") {
      responsavel = await getEspecialistaResponsavel();
    } else if (nivel === "gerente") {
      responsavel = await getGerenteResponsavel();
    }

    const escalacaoMensagem = `
🚨 <b>Falha Escalada</b>
ID: ${id}
Nível: ${nivel}
Responsável: ${responsavel || "Sistema Automático"}
URL: ${APP_URL}/falhas/${id}
    `;

    await enviarTelegram(escalacaoMensagem);

    await sql`
      UPDATE falhas_agentes
      SET nivel_escalacao = ${nivel}, responsavel = ${responsavel}, escalado_em = NOW()
      WHERE id = ${id}
    `;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function analisarFalhasRecorrentes(): Promise<void> {
  try {
    const falhasRecorrentes = await Promise.race<
      Array<{ agente: string; total: number }>
    >([
      sql<Array<{ agente: string; total: number }>>`
        SELECT agente, COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        AND resolvido = FALSE
        GROUP BY agente
        HAVING COUNT(*) > 5
        ORDER BY total DESC
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(falhasRecorrentes) && falhasRecorrentes.length > 0) {
      let mensagem = "🔄 <b>Falhas Recorrentes Detectadas</b>\n\n";

      for (const falha of falhasRecorrentes) {
        mensagem += `• ${falha.agente}: ${falha.total} falhas\n`;
      }

      await enviarTelegram(mensagem);
    }
  } catch (error) {
    console.error("Erro ao analisar falhas recorrentes:", error);
  }
}

export async function validarStatusWebhook(
  statusCode: number,
  agente: string
): Promise<boolean> {
  const statusesValidos = [200, 201, 202, 204];
  const statusesEsperadosParaFalha = [400, 401, 403];

  if (!statusesValidos.includes(statusCode)) {
    if (!statusesEsperadosParaFalha.includes(statusCode)) {
      if (statusCode === 404 && agente === "webhook_mp_valida_assinatura") {
        await registrarFalha(
          agente,
          `Webhook retornou ${statusCode} quando esperado era 400/401/403`,
          { statusCode, esperado: "400/401/403" }
        );
        return false;
      }

      await registrarFalha(
        agente,
        `Status inválido: ${statusCode}`,
        { statusCode }
      );
      return false;
    }
  }

  return true;
}

export async function processarFalhasAgentes(): Promise<void> {
  try {
    const verificarSecretoCron =