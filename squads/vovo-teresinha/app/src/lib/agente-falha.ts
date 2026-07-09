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
      console.error("Erro ao limpar backlog de falhas:", error);
    }
  }
}

export async function registrarFalha(
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
    console.error("Erro ao registrar falha:", error);
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
        LIMIT 50
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function marcarFalhaResolvida(falhaId: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error("Erro ao marcar falha como resolvida:", error);
  }
}

export async function escalarFalhaParaEspecialista(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET escalada_para = ${especialista}, criado_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `🚀 <b>Falha Escalada para Especialista</b>\n` +
      `Agente: ${agente}\n` +
      `Especialista: ${especialista}\n` +
      `ID da Falha: ${falhaId}`
    );
  } catch (error) {
    console.error("Erro ao escalar falha para especialista:", error);
  }
}

export async function escalarFalhaParaGerente(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel(agente);

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET escalada_para = ${gerente}, criado_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `⚡ <b>Falha Escalada para Gerente</b>\n` +
      `Agente: ${agente}\n` +
      `Gerente: ${gerente}\n` +
      `ID da Falha: ${falhaId}`
    );
  } catch (error) {
    console.error("Erro ao escalar falha para gerente:", error);
  }
}

export async function verificarTaxaErros(): Promise<{
  taxa: number;
  total: number;
}> {
  try {
    const resultado = await Promise.race<FalhaResult>([
      sql<FalhaResult>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(resultado) ? resultado[0]?.total || 0 : resultado.total || 0;
    const taxa = total > 0 ? Math.min((total / 100) * 100, 100) : 0;

    if (taxa > 30) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Elevada Detectada</b>\n` +
        `Taxa: ${taxa.toFixed(2)}%\n` +
        `Total de falhas: ${total}\n` +
        `Período: Últimas 2 horas`
      );
    }

    return { taxa, total };
  } catch (error) {
    console.error("Erro ao verificar taxa de erros:", error);
    return { taxa: 0, total: 0 };
  }
}

export async function processarFalhasEmLote(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const tentativas = await sql<Array<{ count: number }>>`
        SELECT COUNT(*) as count
        FROM falhas_agentes
        WHERE agente = ${falha.agente}
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      `;

      const tentativasCount = Array.isArray(tentativas) ? tentativas[0]?.count || 0 : tentativas[0]?.count || 0;

      if (tentativasCount >= LIMITE_ESPECIALISTA && tentativasCount < LIMITE_GERENTE) {
        await escalarFalhaParaEspecialista(falha.id, falha.agente);
      } else if (tentativasCount >= LIMITE_GERENTE && tentativasCount < LIMITE_CLAUDE) {
        await escalarFalhaParaGerente(falha.id, falha.agente);
      } else if (tentativasCount >= LIMITE_CLAUDE) {
        await registrarFalha(
          "claude-api",
          `Falha crítica repassada: ${falha.agente}`,
          { falhaOriginal: falha.id }
        );
      }
    }
  } catch (error) {
    console.error("Erro ao processar falhas em lote:", error);
  }
}

export async function iniciarMonitoramentoFalhas(): Promise<void> {
  try {
    const intervalo = setInterval(async () => {
      await verificarTaxaErros();
      await processarFalhasEmLote();
      await limparBacklogFalhas();
    }, 60000);

    process.on("SIGTERM", () => {
      clearInterval(intervalo);
    });
  } catch (error) {
    console.error("Erro ao iniciar monitoramento de falhas:", error);
  }