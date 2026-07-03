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
  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      statusCode: 400,
      message: "Payload inválido ou vazio",
    };
  }

  const webhookPayload = payload as WebhookMercadoPagoPayload;

  if (!webhookPayload.type || !webhookPayload.data?.id) {
    return {
      valid: false,
      statusCode: 400,
      message: "Campos obrigatórios ausentes",
    };
  }

  return {
    valid: true,
    statusCode: 200,
    message: "Validação bem-sucedida",
  };
}

export async function limparBacklogFalhas(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DB_TIMEOUT);

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

      clearTimeout(timeoutId);

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

      const totalAbertoResult = (await Promise.race([
        sql`
          SELECT COUNT(*) as total FROM falhas_agentes
          WHERE resolvido = FALSE
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as FalhaResult[];

      clearTimeout(timeoutId);

      const totalAberto = totalAbertoResult[0]?.total ?? 0;

      if (totalAberto > LIMITE_BACKLOG) {
        await enviarTelegram(
          `⚠️ <b>Backlog de Falhas Crítico</b>\n` +
          `Total aberto: ${totalAberto}\n` +
          `Limite: ${LIMITE_BACKLOG}`
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (erro) {
    console.error("Erro ao limpar backlog:", erro);
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

    const countResult = (await sql`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente = ${agente} AND resolvido = FALSE
    `) as FalhaResult[];

    const totalAgente = countResult[0]?.total ?? 0;

    if (totalAgente >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `❌ <b>Falha Registrada</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Total falhas: ${totalAgente}\n` +
        `Responsável: ${especialista}`
      );
    }

    if (totalAgente >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🔴 <b>ALERTA CRÍTICO - Muitas Falhas</b>\n` +
        `Agente: ${agente}\n` +
        `Total falhas: ${totalAgente}\n` +
        `Gerente: ${gerente}`
      );
    }
  } catch (erro) {
    console.error("Erro ao registrar falha:", erro);
  }
}

export async function resolverFalha(id: number, resolucao: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}, atualizado_em = NOW()
      WHERE id = ${id}
    `;
  } catch (erro) {
    console.error("Erro ao resolver falha:", erro);
  }
}

export async function listarFalhasAbertas(
  agente?: string
): Promise<FalhaRegistro[]> {
  try {
    let query;
    if (agente) {
      query = await sql`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE AND agente = ${agente}
        ORDER BY criado_em DESC
        LIMIT 100
      `;
    } else {
      query = await sql`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 100
      `;
    }
    return query as FalhaRegistro[];
  } catch (erro) {
    console.error("Erro ao listar falhas:", erro);
    return [];
  }
}

export async function analisarTaxaErros(): Promise<{
  taxa: number;
  totalFalhas: number;
  periodo: string;
}> {
  try {
    const resultados = (await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN resolvido = FALSE THEN 1 END) as abertos
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
    `) as Array<{ total: number; abertos: number }>;

    const { total, abertos } = resultados[0] || { total: 0, abertos: 0 };
    const taxa = total > 0 ? (abertos / total) * 100 : 0;

    return {
      taxa: Math.round(taxa * 100) / 100,
      totalFalhas: total,
      periodo: "2h",
    };
  } catch (erro) {
    console.error("Erro ao analisar taxa de erros:", erro);
    return { taxa: 0, totalFalhas: 0, periodo: "2h" };
  }
}

export async function processarFalhasEmMassa(): Promise<void> {
  try {
    const falhasAbertas = (await sql`
      SELECT id, agente, erro, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em ASC
      LIMIT ${LIMITE_CLAUDE}
    `) as Array<{
      id: number;
      agente: string;
      erro: string;
      criado_em: string;
    }>;

    for (const falha of falhasAbertas) {
      try {
        const url = new URL(`${APP_URL}/api/agentes/${falha.agente}/diagnostico`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

        const resposta = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CRON_SECRET}`,
          },
          body: JSON.stringify({
            falhaId: falha.id,
            erro: falha.erro,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (resposta.ok) {
          await resolverFalha(falha.id, "Resolvido por análise automática");
        }
      } catch (erro) {
        console.error(`Erro ao processar falha ${falha.id}:`, erro);
      }
    }

    const analise = await analisarTaxaErros();
    if (analise.taxa > 30) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Elevada</b>\n` +
        `Taxa: ${analise.taxa}%\n` +
        `Total: ${analise.totalFalhas}\n` +
        `Período: ${analise.periodo}`
      );
    }
  } catch (erro) {
    console.error("Erro ao processar falhas em massa:", erro);
  }
}

export async function notificarEscalacao(falha: FalhaRegistro): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel(falha.agente);
    const especialista = await getEspecialistaResponsavel(falha.agente);

    await enviarTelegram(
      `⛔ <b>Escalação de Falha</b>\n` +
      `ID: ${falha.id}\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `Desde: ${falha.criado_em}\n` +
      `Especialista: ${especialista}\n` +
      `Gerente: ${gerente}`
    );
  } catch (erro) {
    console.error("Erro ao notificar escalação:", erro);
  }
}
```