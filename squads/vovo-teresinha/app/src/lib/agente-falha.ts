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
    const contagem = await Promise.race<Array<FalhaResult>>([
      sql<Array<FalhaResult>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalAberto = Array.isArray(contagem) && contagem.length > 0 
      ? (contagem[0].total as number)
      : 0;

    if (totalAberto >= LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Limite de Backlog Atingido</b>\n` +
        `Falhas abertas: ${totalAberto}\n` +
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
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n`
      );
    } else {
      throw error;
    }
  }
}

export async function obterFalhasAbertas(): Promise<FalhaRegistro[]> {
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
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Obter Falhas Abertas</b>\n`
      );
    }
    return [];
  }
}

export async function resolverFalha(
  falhaId: number,
  resolvidoPor: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolvido_por = ${resolvidoPor}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolvido por: ${resolvidoPor}`
    );
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Resolver Falha</b>\n` +
        `ID: ${falhaId}`
      );
    } else {
      throw error;
    }
  }
}

export async function verificarEAtribuirFalha(falha: FalhaRegistro): Promise<void> {
  try {
    let responsavel: string | null = null;
    let nivel = "especialista";

    if (falha.agente === "webhook_mp_valida_assinatura") {
      responsavel = await getEspecialistaResponsavel("pagamentos");
    } else if (falha.agente.includes("agente_claude")) {
      responsavel = await getGerenteResponsavel("inteligencia");
      nivel = "gerente";
    } else {
      responsavel = await getEspecialistaResponsavel("backend");
    }

    if (responsavel) {
      await enviarTelegram(
        `🔴 <b>Nova Falha Detectada - ${nivel.toUpperCase()}</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Responsável: ${responsavel}\n` +
        `ID da Falha: ${falha.id}`
      );
    }
  } catch (error) {
    await enviarTelegram(
      `⚠️ <b>Erro ao Atribuir Falha</b>\n` +
      `Falha ID: ${falha.id}`
    );
  }
}

export async function executarMonitorFalhas(): Promise<void> {
  try {
    if (!CRON_SECRET || process.env.CRON_SECRET_PROVIDED !== "true") {
      throw new Error("CRON_SECRET não configurado");
    }

    await limparBacklogFalhas();

    const falhas = await obterFalhasAbertas();

    for (const falha of falhas) {
      await verificarEAtribuirFalha(falha);
    }

    const totalAberto = await Promise.race<Array<FalhaResult>>([
      sql<Array<FalhaResult>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(totalAberto) && totalAberto.length > 0
      ? (totalAberto[0].total as number)
      : 0;

    if (total > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Alerta Crítico - Backlog Excessivo</b>\n` +
        `Falhas abertas: ${total}\n` +
        `Limite: ${LIMITE_BACKLOG}\n` +
        `<a href="${APP_URL}/admin/falhas">Acessar Dashboard</a>`
      );
    }
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro no Monitor de Falhas</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
    throw error;
  }
}
```