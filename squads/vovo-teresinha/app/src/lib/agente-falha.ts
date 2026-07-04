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
          `Retenção: ${TEMPO_RETENCAO_FALHAS}h`
        );
      }
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(`❌ Erro ao limpar backlog: ${mensagemErro}`);
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
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(`⚠️ Erro ao registrar falha do agente ${agente}: ${mensagemErro}`);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = (await sql`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT ${LIMITE_BACKLOG}
    `) as FalhaRegistro[];

    return falhas;
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(`⚠️ Erro ao obter falhas não resolvidas: ${mensagemErro}`);
    return [];
  }
}

export async function resolverFalha(falhaId: number): Promise<boolean> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;
    return true;
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(`⚠️ Erro ao resolver falha ${falhaId}: ${mensagemErro}`);
    return false;
  }
}

export async function processarFalhasComEscalacao(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    if (falhas.length === 0) {
      return;
    }

    for (const falha of falhas) {
      const tentativas = falhas.filter(
        (f) => f.agente === falha.agente && !f.resolvido
      ).length;

      if (tentativas >= LIMITE_ESPECIALISTA && tentativas < LIMITE_GERENTE) {
        const especialista = await getEspecialistaResponsavel(falha.agente);
        if (especialista) {
          await enviarTelegram(
            `🚨 <b>Escalação para Especialista</b>\n` +
            `Agente: ${falha.agente}\n` +
            `Erro: ${falha.erro}\n` +
            `Responsável: ${especialista}`
          );
        }
      } else if (tentativas >= LIMITE_GERENTE && tentativas < LIMITE_CLAUDE) {
        const gerente = await getGerenteResponsavel(falha.agente);
        if (gerente) {
          await enviarTelegram(
            `🚨 <b>Escalação para Gerente</b>\n` +
            `Agente: ${falha.agente}\n` +
            `Erro: ${falha.erro}\n` +
            `Responsável: ${gerente}`
          );
        }
      } else if (tentativas >= LIMITE_CLAUDE) {
        await enviarTelegram(
          `🔴 <b>Falha Crítica - Claude Necessário</b>\n` +
          `Agente: ${falha.agente}\n` +
          `Erro: ${falha.erro}\n` +
          `Tentativas: ${tentativas}`
        );
      }
    }
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(`❌ Erro ao processar falhas com escalação: ${mensagemErro}`);
  }
}

export async function verificarSaudePorcentagemErros(): Promise<{
  saudavel: boolean;
  porcentagem: number;
}> {
  try {
    const resultado = (await sql`
      SELECT 
        COUNT(*) FILTER (WHERE resolvido = FALSE) as nao_resolvidas,
        COUNT(*) as total
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
    `) as Array<{ nao_resolvidas: number; total: number }>;

    if (resultado.length === 0 || resultado[0].total === 0) {
      return { saudavel: true, porcentagem: 0 };
    }

    const porcentagem = (resultado[0].nao_resolvidas / resultado[0].total) * 100;
    const saudavel = porcentagem < 10;

    if (!saudavel) {
      await enviarTelegram(
        `⚠️ <b>Taxa de Erros Crítica</b>\n` +
        `Porcentagem: ${porcentagem.toFixed(2)}%\n` +
        `Erros: ${resultado[0].nao_resolvidas}/${resultado[0].total}`
      );
    }

    return { saudavel, porcentagem };
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(`❌ Erro ao verificar saúde: ${mensagemErro}`);
    return { saudavel: false, porcentagem: 100 };
  }
}

export async function executarVerificacaoAgendada(): Promise<void> {
  const tokenValido = CRON_SECRET && process.env.CRON_SECRET === CRON_SECRET;

  if (!tokenValido) {
    await enviarTelegram("❌ Token CRON inválido");
    return;
  }

  try {
    await limparBacklogFalhas();
    await processarFalhasComEscalacao();
    const saude = await verificarSaudePorcentagemErros();

    if (!saude.saudavel) {
      await enviarTelegram(
        `🔔 <b>Verificação de Saúde Concluída</b>\n` +
        `Status: ⚠️ Taxa de erros elevada (${saude.porcentagem.toFixed(2)}%)`
      );
    } else {
      await enviarTelegram(
        `✅ <b>Verificação de Saúde Concluída</b>\n` +
        `Status: Saudável`
      );
    }
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await enviarTelegram(`❌ Erro na verificação agendada: ${mensagemErro}`);
  }
}
```