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
          `Registros removidos: ${ids.length}\n`
        );
      }
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function registrarFalhaAgente(
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
    console.error("Erro ao registrar falha:", error);
  }
}

export async function procesarFalhasEmAberto(): Promise<void> {
  try {
    const falhas = (await sql`
      SELECT id, agente, erro, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em ASC
      LIMIT 50
    `) as FalhaRegistro[];

    for (const falha of falhas) {
      const tentativas = await obterTentativasResolucao(falha.id);

      if (tentativas >= LIMITE_ESPECIALISTA) {
        const gerente = await getGerenteResponsavel(falha.agente);
        await enviarTelegram(
          `⚠️ <b>Falha Escalada para Gerente</b>\n` +
          `Agente: ${falha.agente}\n` +
          `Erro: ${falha.erro}\n` +
          `Gerente: ${gerente}`
        );
      }

      if (tentativas >= LIMITE_CLAUDE) {
        await sql`
          UPDATE falhas_agentes
          SET resolvido = TRUE
          WHERE id = ${falha.id}
        `;
      }
    }
  } catch (error) {
    console.error("Erro ao processar falhas:", error);
  }
}

export async function obterTentativasResolucao(falhaId: number): Promise<number> {
  try {
    const result = (await sql`
      SELECT COUNT(*) as tentativas
      FROM falhas_tentativas
      WHERE falha_id = ${falhaId}
    `) as Array<{ tentativas: number }>;

    return result[0]?.tentativas || 0;
  } catch (error) {
    console.error("Erro ao obter tentativas:", error);
    return 0;
  }
}

export async function escalarFalhaParaClaud(): Promise<void> {
  try {
    const falhas = (await sql`
      SELECT id, agente, erro
      FROM falhas_agentes
      WHERE resolvido = FALSE
      AND criado_em < NOW() - INTERVAL '6 hours'
      LIMIT 20
    `) as FalhaRegistro[];

    for (const falha of falhas) {
      await enviarTelegram(
        `🤖 <b>Falha Escalada para Claude</b>\n` +
        `ID: ${falha.id}\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}`
      );

      await sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE
        WHERE id = ${falha.id}
      `;
    }
  } catch (error) {
    console.error("Erro ao escalar para Claude:", error);
  }
}

export async function monitorarTaxaErros(): Promise<void> {
  try {
    const resultado = (await sql`
      SELECT COUNT(*) as total
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
      AND resolvido = FALSE
    `) as FalhaResult[];

    const totalFalhas = resultado[0]?.total || 0;
    const taxaErro = (totalFalhas / 100) * 100;

    if (taxaErro > 40) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Elevada Detectada</b>\n` +
        `Taxa: ${taxaErro.toFixed(2)}%\n` +
        `Total de falhas (2h): ${totalFalhas}`
      );
    }
  } catch (error) {
    console.error("Erro ao monitorar taxa de erros:", error);
  }
}
```