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
    // Retornar 400 para payload nulo/vazio, não 404
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

    // Validar campos obrigatórios
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
    const resultado = await sql<Array<FalhaResult>>`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
      RETURNING COUNT(*) as total
    `;

    if (Array.isArray(resultado) && resultado.length > 0) {
      await enviarTelegram(
        `⚠️ <b>Falha Registrada</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Dados: ${JSON.stringify(dados || {})}`
      );
    }
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
        LIMIT ${LIMITE_BACKLOG}
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

export async function resolverFalha(falhaId: number, resolvido: boolean = true): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = ${resolvido}
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function verificarStatusAgentes(): Promise<void> {
  try {
    const falhasNaoResolvidas = await obterFalhasNaoResolvidas();

    if (falhasNaoResolvidas.length === 0) {
      return;
    }

    for (const falha of falhasNaoResolvidas) {
      let responsavel = null;

      if (falha.agente === "especialista") {
        responsavel = await getEspecialistaResponsavel();
      } else if (falha.agente === "gerente") {
        responsavel = await getGerenteResponsavel();
      }

      if (responsavel) {
        await enviarTelegram(
          `📢 <b>Escalação de Falha</b>\n` +
          `Agente: ${falha.agente}\n` +
          `Erro: ${falha.erro}\n` +
          `Responsável: ${responsavel}\n` +
          `Criado em: ${falha.criado_em}`
        );
      }
    }
  } catch (error) {
    console.error("Erro ao verificar status dos agentes:", error);
  }
}

export async function executarReparoAutomatico(falha: FalhaRegistro): Promise<boolean> {
  try {
    const contadorFalhas = falhasNaoResolvidas.filter(
      (f) => f.agente === falha.agente && f.erro === falha.erro
    ).length;

    if (contadorFalhas >= LIMITE_ESPECIALISTA) {
      await resolverFalha(falha.id, true);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Erro ao executar reparo automático:", error);
    return false;
  }
}

export async function analisarTaxaErro(): Promise<{
  taxaErro: number;
  totalFalhas: number;
  recomendacao: string;
}> {
  try {
    const falhas = await sql<Array<{ total: number }>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
      AND resolvido = FALSE
    `;

    const totalFalhas = Array.isArray(falhas) && falhas.length > 0 ? falhas[0].total : 0;
    const taxaErro = (totalFalhas / 100) * 100;

    let recomendacao = "✅ Sistema operacional";
    if (taxaErro > 10 && taxaErro <= 25) {
      recomendacao = "⚠️ Atenção moderada necessária";
    } else if (taxaErro > 25) {
      recomendacao = "🔴 Intervenção imediata necessária";
    }

    return {
      taxaErro,
      totalFalhas,
      recomendacao,
    };
  } catch (error) {
    console.error("Erro ao analisar taxa de erro:", error);
    return {
      taxaErro: 0,
      totalFalhas: 0,
      recomendacao: "❌ Erro na análise",
    };
  }
}

export async function gerarRelatorioFalhas(): Promise<string> {
  try {
    const falhasNaoResolvidas = await obterFalhasNaoResolvidas();
    const analise = await analisarTaxaErro();

    let relatorio = `📊 <b>Relatório de Falhas - Receitinhas da Vovó Teresinha</b>\n\n`;
    relatorio += `Taxa de Erro: ${analise.taxaErro.toFixed(2)}%\n`;
    relatorio += `Total de Falhas: ${analise.totalFalhas}\n`;
    relatorio += `Recomendação: ${analise.recomendacao}\n\n`;

    if (falhasNaoResolvidas.length > 0) {
      relatorio += `<b>Falhas Não Resolvidas:</b>\n`;
      falhasNaoResolvidas.slice(0, 5).forEach((falha) => {
        relatorio += `• ${falha.agente}: ${falha.erro} (${falha.criado_em})\n`;
      });
    } else {
      relatorio += `✅ Nenhuma falha não resolvida\n`;
    }

    return relatorio;
  } catch (error) {
    console.error("Erro ao gerar relatório de falhas:", error);
    return `❌ Erro ao gerar relatório: ${error instanceof Error ? error.message : "Desconhecido"}`;
  }
}

let falhasNaoResolvidas: FalhaRegistro[] = [];

export async function inic