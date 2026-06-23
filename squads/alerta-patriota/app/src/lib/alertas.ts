import { sql } from "@/lib/db";

export type SeveridadeAlerta = "critico" | "alto" | "medio" | "baixo";

/**
 * FASE 17: quase todas as rotas fiscal-* inseriam um novo registro em `alertas`
 * (e reenviavam Telegram) a cada execução do cron enquanto a condição
 * persistia, gerando spam de alertas idênticos. Esse helper só cria um novo
 * registro se não houver um alerta do mesmo tipo ainda não resolvido dentro
 * da janela informada.
 *
 * FASE 21: migração estendida para 22 das 25 rotas fiscal-* existentes.
 * Pendente: fiscal-codigo-performance, fiscal-pagamentos, fiscal-trials.
 */
export async function criarAlertaDedup(
  tipo: string,
  severidade: SeveridadeAlerta,
  mensagem: string,
  janelaHoras = 6
): Promise<{ criado: boolean }> {
  const existente = await sql`
    SELECT id FROM alertas
    WHERE tipo = ${tipo} AND resolvido = false
      AND created_at >= NOW() - INTERVAL '1 hour' * ${janelaHoras}
    LIMIT 1
  `;
  if (existente.length > 0) return { criado: false };

  await sql`
    INSERT INTO alertas (tipo, severidade, mensagem)
    VALUES (${tipo}, ${severidade}, ${mensagem})
  `;
  return { criado: true };
}
