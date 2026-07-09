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
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${dados ? JSON.stringify(dados) : null}, FALSE, NOW())
    `;

    const totalFalhas = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
    `;

    if (Array.isArray(totalFalhas) && totalFalhas[0]?.total > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Alerta: Backlog de Falhas Alto</b>\n` +
        `Total: ${totalFalhas[0].total}\n` +
        `Limite: ${LIMITE_BACKLOG}\n`
      );
    }
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao registrar falha</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 50
    `;
    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao obter falhas não resolvidas</b>\n` +
      `${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
    return [];
  }
}

export async function marcarFalhaComoResolvida(falhaId: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n`
    );
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao marcar falha como resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

export async function escalarFalha(
  falhaId: number,
  agente: string,
  erro: string
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(agente);

    const mensagem = `🔴 <b>ESCALAÇÃO DE FALHA</b>\n` +
      `ID: ${falhaId}\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n` +
      `Especialista: ${especialista}\n` +
      `Gerente: ${gerente}\n`;

    await enviarTelegram(mensagem);

    await sql`
      UPDATE falhas_agentes
      SET escalado = TRUE, escalado_em = NOW()
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao escalar falha</b>\n` +
      `ID: ${falhaId}\n` +
      `${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

export async function verificarSaudeAgentes(): Promise<void> {
  try {
    const falhasRecentes = await sql<Array<{ agente: string; total: number }>>`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '1 hour'
      AND resolvido = FALSE
      GROUP BY agente
      HAVING COUNT(*) > 5
    `;

    if (Array.isArray(falhasRecentes) && falhasRecentes.length > 0) {
      for (const falha of falhasRecentes) {
        await escalarFalha(0, falha.agente, `Múltiplas falhas detectadas: ${falha.total}`);
      }
    }
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao verificar saúde dos agentes</b>\n` +
      `${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

export async function procesarFalhasEmBacklog(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const tentativas = await sql<Array<{ tentativas: number }>>`
        SELECT COUNT(*) as tentativas
        FROM falhas_agentes
        WHERE agente = ${falha.agente}
        AND criado_em > NOW() - INTERVAL '6 hours'
      `;

      if (Array.isArray(tentativas) && tentativas[0]?.tentativas > LIMITE_ESPECIALISTA) {
        await escalarFalha(falha.id, falha.agente, falha.erro);
      }
    }
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao processar falhas em backlog</b>\n` +
      `${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

export async function analisarTaxaErros(): Promise<{
  taxa: number;
  total: number;
  resolvidas: number;
  naoResolvidas: number;
}> {
  try {
    const resultado = await sql<Array<{
      total: number;
      resolvidas: number;
      nao_resolvidas: number;
    }>>`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN resolvido = TRUE THEN 1 ELSE 0 END) as resolvidas,
        SUM(CASE WHEN resolvido = FALSE THEN 1 ELSE 0 END) as nao_resolvidas
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
    `;

    if (Array.isArray(resultado) && resultado.length > 0) {
      const { total, resolvidas = 0, nao_resolvidas = 0 } = resultado[0];
      const taxa = total > 0 ? (nao_resolvidas / total) * 100 : 0;

      if (taxa > 30) {
        await enviarTelegram(
          `🚨 <b>ALERTA: Taxa de Erros Elev