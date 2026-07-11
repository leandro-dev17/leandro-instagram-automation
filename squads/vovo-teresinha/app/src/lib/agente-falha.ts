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
    const backlogCount = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (
      Array.isArray(backlogCount) &&
      backlogCount.length > 0 &&
      backlogCount[0].total >= LIMITE_BACKLOG
    ) {
      await enviarTelegram(
        `🚨 <b>Backlog de Falhas Crítico</b>\n` +
        `Limite atingido: ${backlogCount[0].total}/${LIMITE_BACKLOG}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}`
      );
      return;
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao registrar falha</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelAtual: string
): Promise<void> {
  try {
    const falha = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(falha) || falha.length === 0) {
      throw new Error("Falha não encontrada");
    }

    let proximoNivel = "";
    let responsavel = "";
    let contador = 0;

    if (nivelAtual === "especialista") {
      proximoNivel = "gerente";
      const gerenteData = await getGerenteResponsavel();
      responsavel = gerenteData?.nome || "Gerente";
      contador = LIMITE_GERENTE;
    } else if (nivelAtual === "gerente") {
      proximoNivel = "claude";
      responsavel = "Claude (IA)";
      contador = LIMITE_CLAUDE;
    } else {
      proximoNivel = "crítico";
      responsavel = "Crítico";
    }

    await sql`
      UPDATE falhas_agentes
      SET escalado_para = ${proximoNivel}
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `🚀 <b>Falha Escalada</b>\n` +
      `ID: ${falhaId}\n` +
      `Agente: ${falha[0].agente}\n` +
      `Nível: ${nivelAtual} → ${proximoNivel}\n` +
      `Responsável: ${responsavel}\n` +
      `Erro: ${falha[0].erro}\n` +
      `Limite do nível: ${contador}`
    );
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao escalar falha</b>\n` +
      `ID: ${falhaId}\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
  }
}

export async function monitorarFalhas(): Promise<void> {
  try {
    const falhasNaoResolvidas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '2 hours'
        ORDER BY criado_em DESC
        LIMIT 10
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(falhasNaoResolvidas) || falhasNaoResolvidas.length === 0) {
      return;
    }

    const taxaErro = (falhasNaoResolvidas.length / 10) * 100;

    if (taxaErro >= 40) {
      const especialista = await getEspecialistaResponsavel();
      
      await enviarTelegram(
        `⚠️ <b>Taxa de Erros Elevada Detectada</b>\n` +
        `Taxa: ${taxaErro.toFixed(1)}%\n` +
        `Especialista responsável: ${especialista?.nome || "Sistema"}\n` +
        `Falhas detectadas: ${falhasNaoResolvidas.length}\n\n` +
        `<b>Últimas falhas:</b>\n` +
        falhasNaoResolvidas
          .slice(0, 3)
          .map((f) => `• ${f.agente}: ${f.erro.substring(0, 50)}...`)
          .join("\n")
      );

      for (const falha of falhasNaoResolvidas.slice(0, LIMITE_ESPECIALISTA)) {
        await escalarFalha(falha.id, "especialista");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout no Monitoramento de Falhas</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro no Monitoramento de Falhas</b>\n` +
        `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
      );
    }
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
        SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolução: ${resolucao}`
    );
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao resolver falha</b>\n` +
      `ID: ${falhaId}\n` +