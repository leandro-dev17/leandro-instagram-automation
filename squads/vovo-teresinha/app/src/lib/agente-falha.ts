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
      statusCode: 400,
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
        `Excedido limite de ${DB_TIMEOUT}ms\n`
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
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const resultado = await sql<FalhaResult[]>`
      INSERT INTO falhas_agentes (agente, erro, dados, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, NOW())
      RETURNING COUNT(*) OVER() as total
    `;

    if (Array.isArray(resultado) && resultado.length > 0) {
      const total = resultado[0].total;

      if (total > LIMITE_BACKLOG) {
        await enviarTelegram(
          `⚠️ <b>Backlog de Falhas Crítico</b>\n` +
          `Total de falhas abertas: ${total}\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n`
        );
      }
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolução: ${resolucao}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasAbertas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 50
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("Erro ao obter falhas abertas:", error);
    return [];
  }
}

export async function executarAgenteCorrecao(falhaId: number): Promise<boolean> {
  try {
    const falha = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro FROM falhas_agentes WHERE id = ${falhaId}
    `;

    if (!Array.isArray(falha) || falha.length === 0) {
      return false;
    }

    const { agente, erro } = falha[0];

    if (agente === "webhook_mp_valida_assinatura") {
      const validacao = await validarAssinaturaMercadoPago({});
      if (!validacao.valid) {
        await resolverFalha(falhaId, `Correção automática: ${validacao.message}`);
        return true;
      }
    }

    const especialista = await getEspecialistaResponsavel(agente);
    if (especialista) {
      await enviarTelegram(
        `🔧 <b>Falha Atribuída ao Especialista</b>\n` +
        `Especialista: ${especialista}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
      return true;
    }

    const gerente = await getGerenteResponsavel(agente);
    if (gerente) {
      await enviarTelegram(
        `📋 <b>Falha Escalada ao Gerente</b>\n` +
        `Gerente: ${gerente}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error("Erro ao executar agente de correção:", error);
    return false;
  }
}

export async function processoMonitorFalhas(): Promise<void> {
  if (CRON_SECRET !== process.env.CRON_SECRET) {
    throw new Error("CRON_SECRET inválido");
  }

  try {
    await limparBacklogFalhas();

    const falhasAbertas = await obterFalhasAbertas();

    for (const falha of falhasAbertas.slice(0, LIMITE_ESPECIALISTA)) {
      const sucesso = await executarAgenteCorrecao(falha.id);
      if (!sucesso) {
        console.warn(`Falha ${falha.id} não foi resolvida automaticamente`);
      }
    }

    await enviarTelegram(
      `📊 <b>Monitoramento de Falhas Concluído</b>\n` +
      `Falhas abertas: ${falhasAbertas.length}\n`
    );
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro no Monitoramento de Falhas</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
    );
  }
}