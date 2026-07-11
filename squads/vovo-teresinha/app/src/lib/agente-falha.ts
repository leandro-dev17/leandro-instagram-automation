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
    const backlogAtual = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalAberto = Array.isArray(backlogAtual) && backlogAtual.length > 0 
      ? backlogAtual[0].total 
      : 0;

    if (totalAberto >= LIMITE_BACKLOG) {
      await limparBacklogFalhas();
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE)
    `;

    if (agente === "webhook_mp_valida_assinatura") {
      const especialista = await getEspecialistaResponsavel("pagamento");
      await enviarTelegram(
        `⚠️ <b>Falha Detectada: ${agente}</b>\n` +
        `Erro: ${erro}\n` +
        `Responsável: ${especialista}\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`Timeout ao registrar falha: ${agente}`);
    } else {
      throw error;
    }
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await Promise.race<void>([
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
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`Timeout ao resolver falha: ${falhaId}`);
    } else {
      throw error;
    }
  }
}

export async function escalarFalha(
  falhaId: number,
  nivel: "especialista" | "gerente" | "claude"
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
      throw new Error(`Falha não encontrada: ${falhaId}`);
    }

    const registroFalha = falha[0];
    let responsavel: string;

    if (nivel === "especialista") {
      responsavel = await getEspecialistaResponsavel(registroFalha.agente);
    } else if (nivel === "gerente") {
      responsavel = await getGerenteResponsavel(registroFalha.agente);
    } else {
      responsavel = "Claude AI (Sistema Autônomo)";
    }

    const mensagem =
      `🔴 <b>Escalação de Falha - Nível: ${nivel.toUpperCase()}</b>\n` +
      `Falha ID: ${falhaId}\n` +
      `Agente: ${registroFalha.agente}\n` +
      `Erro: ${registroFalha.erro}\n` +
      `Responsável: ${responsavel}\n` +
      `Criado em: ${registroFalha.criado_em}\n`;

    await enviarTelegram(mensagem);

    await sql`
      UPDATE falhas_agentes
      SET nivel_escala = ${nivel}
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`Timeout ao escalar falha: ${falhaId}`);
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
      console.error("Timeout ao obter falhas abertas");
      return [];
    } else {
      throw error;
    }
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalAberto: number;
  totalResolvido: number;
  agenteComMaiorFalhas: string | null;
}> {
  try {
    const stats = await Promise.race<Array<{ 
      total_aberto: number; 
      total_resolvido: number; 
      agente_principal: string | null;
    }>>([
      sql<Array<{ 
        total_aberto: number; 
        total_resolvido: number; 
        agente_principal: string | null;
      }>>`
        SELECT 
          (SELECT COUNT(*) FROM falhas_agentes WHERE resolvido = FALSE)::int as total_aberto,
          (SELECT COUNT(*) FROM falhas_agentes WHERE resolvido = TRUE)::int as total_resolvido,
          (SELECT agente FROM falhas_agentes WHERE resolvido = FALSE GROUP BY agente ORDER BY COUNT(*) DESC LIMIT 1) as agente_principal
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(stats) && stats.length > 0) {
      return {
        totalAberto: stats[0].total_aberto,
        totalResolvido: stats[0].total_resolvido,
        agenteComMaiorFalhas: stats[0].agente_principal,
      };
    }

    return {
      totalAberto: 0,
      totalResolvido: 0,
      agenteComMaiorFalhas: null,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error("Timeout ao obter estatísticas de falhas");
      return {
        totalAberto: 0,
        totalResolvido: 0,
        agenteComMaiorFalhas: null,
      };
    } else {
      throw error;
    }
  }
}
```