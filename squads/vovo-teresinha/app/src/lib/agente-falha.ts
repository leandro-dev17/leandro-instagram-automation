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
    } else if (error instanceof Error) {
      await enviarTelegram(
        `❌ <b>Erro ao Limpar Backlog</b>\n` +
        `Erro: ${error.message}\n`
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
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    const [resultado] = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente = ${agente} AND resolvido = FALSE
    `;

    if (resultado.total >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `⚠️ <b>Limite de Falhas Atingido</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas não resolvidas: ${resultado.total}\n` +
          `Especialista: @${especialista}\n`
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Registrar Falha</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${errorMessage}\n`
    );
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    const [falha] = await sql<FalhaRegistro[]>`
      SELECT * FROM falhas_agentes WHERE id = ${falhaId}
    `;

    if (!falha) {
      throw new Error(`Falha com ID ${falhaId} não encontrada`);
    }

    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    const gerente = await getGerenteResponsavel(falha.agente);
    if (gerente) {
      await enviarTelegram(
        `✅ <b>Falha Resolvida</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Resolução: ${resolucao}\n` +
        `Gerente: @${gerente}\n`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Resolver Falha</b>\n` +
      `ID: ${falhaId}\n` +
      `Erro: ${errorMessage}\n`
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
      LIMIT ${LIMITE_BACKLOG}
    `;

    return falhas;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Obter Falhas</b>\n` +
      `Erro: ${errorMessage}\n`
    );
    return [];
  }
}

export async function gerarRelatorioFalhas(): Promise<void> {
  try {
    const falhasAbertas = await sql<Array<{ agente: string; total: number }>>`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE resolvido = FALSE
      GROUP BY agente
      ORDER BY total DESC
    `;

    const totalAberto = falhasAbertas.reduce((sum, f) => sum + f.total, 0);

    let mensagem = `📊 <b>Relatório de Falhas (últimas 24h)</b>\n\n`;
    mensagem += `Total aberto: ${totalAberto}\n\n`;

    falhasAbertas.forEach((falha) => {
      mensagem += `• ${falha.agente}: ${falha.total} falhas\n`;
    });

    await enviarTelegram(mensagem);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(
      `❌ <b>Erro ao Gerar Relatório</b>\n` +
      `Erro: ${errorMessage}\n`
    );
  }
}

export async function verificarSaudeSistema(): Promise<{ saudavel: boolean; mensagem: string }> {
  try {
    const [resultado] = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
      AND criado_em > NOW() - INTERVAL '2 hours'
    `;

    const totalRecente = resultado.total;
    const percentualErro = (totalRecente / 100) * 100;

    if (percentualErro >= 36) {
      return {
        saudavel: false,
        mensagem: `Taxa de erro crítica: ${percentualErro.toFixed(2)}% nas últimas 2 horas`,
      };
    }

    if (percentualErro >= 20) {
      return {
        saudavel: false,
        mensagem: `Taxa de erro elevada: ${percentualErro.toFixed(2)}% nas últimas 2 horas`,
      };
    }

    return {
      saudavel: true,
      mensagem: "Sistema operacional normal",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Desconhecido";
    return {
      saudavel: false,
      mensagem: `Erro ao verificar saúde: ${errorMessage}`,
    };
  }
}

export async function escalarFalhaParaGerente(
  falhaId: number,
  motivo: string
): Promise<void> {
  try {
    const [falha] = await sql<FalhaRegistro[]>`
      SELECT * FROM falhas_agentes WHERE id = ${falhaId}
    `;

    if (!falha) {
      throw new Error(`Falha com ID ${falhaId} não encontrada`);
    }

    const gerente = await getGerenteResponsavel(falha.agente);
    if (gerente) {
      await enviarTelegram(
        `🚨 <b>Escalação para Gerente</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Motivo: ${motivo}\n` +
        `Gerente: @${gerente}\n` +
        `Erro original: ${falha.erro}\n`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(
      `❌