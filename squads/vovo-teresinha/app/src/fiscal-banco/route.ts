import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Guard: valida o CRON_SECRET enviado pela Vercel (ou por qualquer chamador)
// A Vercel injeta automaticamente o header Authorization: Bearer <CRON_SECRET>
// quando o cron é disparado internamente.
//
// Fluxo de validação:
//  1. Em produção (NODE_ENV === "production"): CRON_SECRET obrigatório.
//     - Ausente → 503 (misconfiguration) + log de erro claro.
//     - Presente mas header não bate → 401 + log de warning.
//  2. Fora de produção (dev/preview): se CRON_SECRET não estiver definido,
//     permite a chamada (facilita testes locais sem variável configurada).
//     Se CRON_SECRET estiver definido mesmo em dev, a validação é aplicada.
//
// CORREÇÃO (28/05/2026): secret ausente em produção retorna 503 (configuração
// ausente) em vez de 401 (não autorizado), evitando falso-positivo de segurança
// e tornando o diagnóstico imediato via status HTTP.
// ---------------------------------------------------------------------------
function autorizado(req: NextRequest): { ok: boolean; status?: number; motivo?: string } {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      // Produção sem CRON_SECRET configurado → bloqueia com 503 e avisa claramente
      console.error(
        "[fiscal-banco] CRON_SECRET não está definido nas variáveis de ambiente do projeto " +
          "(Vercel Dashboard → Settings → Environment Variables). " +
          "O cron ficará bloqueado até que a variável seja adicionada e o projeto seja reimplantado. " +
          "Retornando 503 para distinguir misconfiguration de acesso indevido (401)."
      );
      return { ok: false, status: 503, motivo: "secret_ausente" };
    }
    // Fora de produção sem secret → permite (ambiente de dev/preview sem configuração local)
    console.warn(
      "[fiscal-banco] CRON_SECRET não definido — acesso permitido pois NODE_ENV !== 'production'. " +
        "Configure a variável para testar o fluxo completo de autenticação."
    );
    return { ok: true };
  }

  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-banco] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        `(esperado: "Bearer ***"). ` +
        "Verifique se CRON_SECRET no ambiente corresponde ao valor configurado no cron job."
    );
    return { ok: false, status: 401, motivo: "header_invalido" };
  }

  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = autorizado(req);

  if (!auth.ok) {
    const httpStatus = auth.status ?? 401;
    const isSecretAusente = auth.motivo === "secret_ausente";

    return NextResponse.json(
      {
        erro: isSecretAusente ? "Serviço mal configurado" : "Não autorizado",
        // Não expõe o motivo no body em produção para não vazar informação,
        // mas o motivo está nos logs do Vercel para diagnóstico.
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: httpStatus }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // ------------------------------------------------------------------
    // Fiscal do banco: verifica assinaturas vencidas e executa manutenção
    // ------------------------------------------------------------------

    // 1. Assinaturas expiradas há mais de 7 dias → marca como inativa
    const expiradas = await sql`
      UPDATE assinaturas
      SET ativa = false
      WHERE ativa = true
        AND renovada_em < NOW() - INTERVAL '37 days'
      RETURNING id, usuario_id, renovada_em
    `;

    // 2. Coleta métricas básicas do banco para monitoramento
    const [metricas] = await sql`
      SELECT
        (SELECT COUNT(*) FROM usuarios)          AS total_usuarios,
        (SELECT COUNT(*) FROM assinaturas WHERE ativa = true) AS assinaturas_ativas,
        (SELECT COUNT(*) FROM assinaturas WHERE ativa = false) AS assinaturas_inativas,
        NOW() AS verificado_em
    `;

    console.info(
      `[fiscal-banco] Verificação concluída. ` +
        `Expiradas desativadas: ${expiradas.length}. ` +
        `Usuários: ${metricas.total_usuarios} | Ativas: ${metricas.assinaturas_ativas} | Inativas: ${metricas.assinaturas_inativas}.`
    );

    return NextResponse.json(
      {
        ok: true,
        expiradas_desativadas: expiradas.length,
        metricas: {
          total_usuarios: metricas.total_usuarios,
          assinaturas_ativas: metricas.assinaturas_ativas,
          assinaturas_inativas: metricas.assinaturas_inativas,
          verificado_em: metricas.verificado_em,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[fiscal-banco] Erro ao executar verificação do banco:", err);
    return NextResponse.json(
      { erro: "Erro interno ao verificar banco de dados" },
      { status: 500 }
    );
  }
}
