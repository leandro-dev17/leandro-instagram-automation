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
  statusCode?: number
): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes (agente, erro, status_code, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${statusCode || 500}, FALSE, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const contagem = await Promise.race<Array<FalhaResult>>([
      sql<Array<FalhaResult>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = Array.isArray(contagem) && contagem[0] ? contagem[0].total : 0;

    if (totalFalhas >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `🚨 <b>Falha Detectada</b>\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n` +
          `Total de falhas: ${totalFalhas}\n` +
          `Responsável: ${especialista}\n`
        );
      }
    }

    if (totalFalhas >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente) {
        await enviarTelegram(
          `🔴 <b>Alerta Crítico</b>\n` +
          `Agente: ${agente} apresenta múltiplas falhas\n` +
          `Total: ${totalFalhas} falhas não resolvidas\n` +
          `Gerente: ${gerente}\n`
        );
      }
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n`
      );
    }
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
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
    console.error("Erro ao resolver falha:", error);
    throw error;
  }
}

export async function obterFalhasNaoResolvidas(): Promise<Array<FalhaRegistro>> {
  try {
    const falhas = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
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

export async function analisarTaxaErros(): Promise<{
  taxa: number;
  total: number;
  criticas: number;
}> {
  try {
    const resultado = await Promise.race<
      Array<{ total: number; criticas: number }>
    >([
      sql<Array<{ total: number; criticas: number }>>`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) as criticas
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(resultado) || resultado.length === 0) {
      return { taxa: 0, total: 0, criticas: 0 };
    }

    const { total, criticas } = resultado[0];
    const taxaErros = total > 0 ? (criticas / total) * 100 : 0;

    if (taxaErros > 30) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Elevada</b>\n` +
        `Taxa: ${taxaErros.toFixed(2)}%\n` +
        `Total de erros: ${total}\n` +
        `Erros críticos: ${criticas}\n` +
        `Período: Últimas 2 horas\n`
      );
    }

    return {
      taxa: parseFloat(taxaErros.toFixed(2)),
      total,
      criticas,
    };
  } catch (error) {
    console.error("Erro ao analisar taxa de erros:", error);
    return { taxa: 0, total: 0, criticas: 0 };
  }
}

export async function gerarRelatorioFalhas(): Promise<string> {
  try {
    const falhas = await obterFalhasNaoResolvidas();
    const { taxa, total, criticas } = await analisarTaxaErros();

    let relatorio = `📊 <b>Relatório de Falhas</b>\n`;
    relatorio += `Taxa de erro (2h): ${taxa}%\n`;
    relatorio += `Total: ${total} | Críticas: ${criticas}\n\n`;

    if (falhas.length > 0) {
      relatorio += `<b>Falhas Não Resolvidas:</b>\n`;
      falhas.slice(0, 5).forEach((falha) => {
        relatorio += `• ${falha.agente}: ${falha.erro}\n`;
      });
    }

    return relatorio;
  } catch (error) {
    console.error("Erro ao gerar relatório de falhas:", error);
    return "Erro ao gerar relatório de falhas";
  }
}
```