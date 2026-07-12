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
        `Tentando novamente em 5 minutos...`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro ao Limpar Backlog</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}`
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
      VALUES (${agente}, ${erro}, ${dados ? JSON.stringify(dados) : null}, false, NOW())
    `;

    // Verificar se backlog excedeu limite
    const resultado = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
    `;
    
    const totalFalhas = resultado[0]?.total || 0;
    
    if (totalFalhas > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Backlog de Falhas Crítico</b>\n` +
        `Total de falhas não resolvidas: ${totalFalhas}\n` +
        `Agente: ${agente}`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalha(
  id: number,
  resolucao: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}
      WHERE id = ${id}
    `;
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 50
    `;
    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function atribuirFalhaAoEspecialista(
  falhaId: number,
  agente: string
): Promise<string | null> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);
    
    if (!especialista) {
      return null;
    }

    await sql`
      UPDATE falhas_agentes
      SET atribuido_a = ${especialista}
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `📋 <b>Falha Atribuída</b>\n` +
      `Especialista: ${especialista}\n` +
      `Agente: ${agente}`
    );

    return especialista;
  } catch (error) {
    console.error("Erro ao atribuir falha:", error);
    return null;
  }
}

export async function escalarFalhaAoGerente(
  falhaId: number,
  agente: string
): Promise<string | null> {
  try {
    const gerente = await getGerenteResponsavel(agente);
    
    if (!gerente) {
      return null;
    }

    await sql`
      UPDATE falhas_agentes
      SET atribuido_a = ${gerente}, escalado = TRUE
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `🚨 <b>Falha Escalada para Gerente</b>\n` +
      `Gerente: ${gerente}\n` +
      `Agente: ${agente}`
    );

    return gerente;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
    return null;
  }
}

export async function iniciarAnalisePorClaudeAPI(falhaId: number): Promise<boolean> {
  try {
    const falha = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro FROM falhas_agentes WHERE id = ${falhaId}
    `;

    if (!falha || falha.length === 0) {
      return false;
    }

    const response = await Promise.race<Response>([
      fetch(`${APP_URL}/api/analise-claude`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cron-Secret": CRON_SECRET || "",
        },
        body: JSON.stringify({
          falhaId: falha[0].id,
          agente: falha[0].agente,
          erro: falha[0].erro,
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);

    return response.ok;
  } catch (error) {
    console.error("Erro ao iniciar análise por Claude:", error);
    return false;
  }
}

export async function notificarBacklogCritico(): Promise<void> {
  try {
    const resultado = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
    `;
    
    const totalFalhas = resultado[0]?.total || 0;

    if (totalFalhas > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🔴 <b>ALERTA: Backlog Crítico!</b>\n` +
        `Total de falhas não resolvidas: ${totalFalhas}\n` +
        `Ação imediata necessária!`
      );
    }
  } catch (error) {
    console.error("Erro ao notificar backlog crítico:", error);
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  total: number;
  naoResolvidas: number;
  porAgente: Record<string, number>;
}> {
  try {
    const resultado = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes
    `;
    
    const naoResolvidas = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
    `;

    const porAgente = await sql<Array<{ agente: string; total: number }>>`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE resolvido = FALSE
      GROUP BY agente
      ORDER BY total DESC
    `;

    const porAgenteMap: Record<string, number> = {};
    porAgente.forEach((item) => {
      porAgenteMap[item.agente] = item.total;
    });

    return {
      total: resultado[0]?.total || 0,
      naoResolvidas: naoResolvidas[0]?.total || 0,
      porAgente: porAgenteMap,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      total: 0,
      naoResolvidas: 0