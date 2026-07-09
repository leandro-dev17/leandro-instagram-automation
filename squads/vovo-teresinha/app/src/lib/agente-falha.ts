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
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
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
    const resultado = await Promise.race<FalhaResult>([
      sql<FalhaResult[]>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
        RETURNING COUNT(*) as total
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = await Promise.race<FalhaResult>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(totalFalhas) && totalFalhas.length > 0) {
      const count = (totalFalhas[0] as { total?: number }).total || 0;
      if (count > LIMITE_BACKLOG) {
        await enviarTelegram(
          `🚨 <b>Backlog Crítico Detectado</b>\n` +
          `Total de falhas: ${count}\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}`
        );
      }
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

export async function resolverFalha(id: number): Promise<boolean> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE
        WHERE id = ${id}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
    return true;
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    return false;
  }
}

export async function atribuirFalhaEspecialista(
  falhaId: number,
  agente: string
): Promise<boolean> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);
    if (!especialista) {
      return false;
    }

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET atribuido_para = ${especialista}
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `📋 <b>Falha Atribuída ao Especialista</b>\n` +
      `Especialista: ${especialista}\n` +
      `Agente: ${agente}`
    );

    return true;
  } catch (error) {
    console.error("Erro ao atribuir falha:", error);
    return false;
  }
}

export async function escalarFalhaGerente(
  falhaId: number,
  agente: string
): Promise<boolean> {
  try {
    const gerente = await getGerenteResponsavel(agente);
    if (!gerente) {
      return false;
    }

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET atribuido_para = ${gerente}, escalado = TRUE
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `🔴 <b>Falha Escalada para Gerente</b>\n` +
      `Gerente: ${gerente}\n` +
      `Agente: ${agente}`
    );

    return true;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
    return false;
  }
}

export async function analisarFalhaComClaude(falhaId: number): Promise<string> {
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
      return "Falha não encontrada";
    }

    const falhaData = falha[0];

    const prompt = `Analise a seguinte falha do aplicativo Receitinhas da Vovó Teresinha:
    Agente: ${falhaData.agente}
    Erro: ${falhaData.erro}
    Data: ${falhaData.criado_em}
    
    Forneça:
    1. Causa raiz provável
    2. Impacto no usuário
    3. Solução recomendada
    4. Prioridade (Alta/Média/Baixa)`;

    const response = await Promise.race([
      fetch(`${APP_URL}/api/ia/analisar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({ prompt }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);

    if (!response.ok) {
      throw new Error(`API retornou ${response.status}`);
    }

    const resultado = await response.json();
    const analise = resultado.analise || "Análise não disponível";

    await sql`
      UPDATE falhas_agentes
      SET analise_ia = ${analise}
      WHERE id = ${falhaId}
    `;

    return analise;
  } catch (error) {
    console.error("Erro ao analisar falha com Claude