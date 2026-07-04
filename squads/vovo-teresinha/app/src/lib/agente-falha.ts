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
          `Timestamp: ${new Date().toISOString()}`
        );
      }
    } catch (innerError) {
      if (innerError instanceof Error && innerError.message === "DB_TIMEOUT") {
        await enviarTelegram(
          `⚠️ <b>Timeout na Limpeza de Backlog</b>\n` +
          `Erro: Database timeout\n` +
          `Timestamp: ${new Date().toISOString()}`
        );
      } else {
        throw innerError;
      }
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    await enviarTelegram(
      `❌ <b>Erro na Limpeza de Backlog</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n` +
      `Timestamp: ${new Date().toISOString()}`
    );
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    const totalFalhas = (await sql`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `) as Array<FalhaResult>;

    if (totalFalhas[0]?.total > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Alerta: Backlog de Falhas Crítico</b>\n` +
        `Agente: ${agente}\n` +
        `Total de falhas não resolvidas: ${totalFalhas[0].total}\n` +
        `Limite: ${LIMITE_BACKLOG}`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelAtual: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = (await sql`
      SELECT * FROM falhas_agentes WHERE id = ${falhaId}
    `) as Array<FalhaRegistro>;

    if (!falha.length) {
      console.warn(`Falha ${falhaId} não encontrada`);
      return;
    }

    const falhaPrincipal = falha[0];
    let mensagem = "";

    if (nivelAtual === "especialista") {
      const gerente = await getGerenteResponsavel(falhaPrincipal.agente);
      mensagem = `⚠️ <b>Escalação para Gerente</b>\n` +
        `Falha: ${falhaPrincipal.erro}\n` +
        `Atribuído a: ${gerente}\n` +
        `Timestamp: ${new Date().toISOString()}`;
    } else if (nivelAtual === "gerente") {
      mensagem = `🆘 <b>Escalação para Claude (IA)</b>\n` +
        `Falha: ${falhaPrincipal.erro}\n` +
        `Prioridade: CRÍTICA\n` +
        `Timestamp: ${new Date().toISOString()}`;
    } else if (nivelAtual === "claude") {
      mensagem = `🔴 <b>Falha Crítica Não Resolvida</b>\n` +
        `Falha: ${falhaPrincipal.erro}\n` +
        `Agente: ${falhaPrincipal.agente}\n` +
        `Timestamp: ${new Date().toISOString()}`;
    }

    await enviarTelegram(mensagem);

    await sql`
      UPDATE falhas_agentes
      SET resolvido = FALSE
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function resolverFalha(
  falhaId: number,
  descricaoResolucao: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, descricao_resolucao = ${descricaoResolucao}
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolução: ${descricaoResolucao}\n` +
      `Timestamp: ${new Date().toISOString()}`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalNaoResolvidas: number;
  porAgente: Record<string, number>;
  ultimasFalhas: FalhaRegistro[];
}> {
  try {
    const totalNaoResolvidasResult = (await sql`
      SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
    `) as Array<FalhaResult>;

    const porAgenteResult = (await sql`
      SELECT agente, COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
      GROUP BY agente
    `) as Array<{ agente: string; total: number }>;

    const ultimasFalhasResult = (await sql`
      SELECT * FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 10
    `) as Array<FalhaRegistro>;

    const porAgente: Record<string, number> = {};
    porAgenteResult.forEach((item) => {
      porAgente[item.agente] = item.total;
    });

    return {
      totalNaoResolvidas: totalNaoResolvidasResult[0]?.total || 0,
      porAgente,
      ultimasFalhas: ultimasFalhasResult,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      totalNaoResolvidas: 0,
      porAgente: {},
      ultimasFalhas: [],
    };
  }
}

export async function verificarSaudeAgentes(): Promise<boolean> {
  try {
    const estatisticas = await obterEstatisticasFalhas();

    if (estatisticas.totalNaoResolvidas > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Status Crítico Detectado</b>\n` +
        `Total de falhas não resolvidas: ${estatisticas.totalNaoResolvidas}\n` +
        `Limite crítico: ${LIMITE_BACKLOG}\n` +
        `Timestamp: ${new Date().toISOString()}`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Erro ao verificar saúde dos agentes:", error);
    return false;
  }
}
```