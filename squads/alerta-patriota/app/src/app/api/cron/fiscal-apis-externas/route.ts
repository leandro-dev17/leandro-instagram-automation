/**
 * ARTURO APIS — Testa saúde das APIs externas preventivamente
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const TIMEOUT_MS = 8000;

interface ResultadoApi {
  nome: string;
  status: "ok" | "degradado" | "down";
  ms: number;
  erro?: string;
}

async function testarApi(
  nome: string,
  fn: () => Promise<Response>
): Promise<ResultadoApi> {
  const t = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fn();
    } finally {
      clearTimeout(timeout);
    }

    const ms = Date.now() - t;

    if (!res.ok) {
      return { nome, status: "down", ms, erro: `HTTP ${res.status}` };
    }
    if (ms > 3000) {
      return { nome, status: "degradado", ms };
    }
    return { nome, status: "ok", ms };
  } catch (err) {
    const ms = Date.now() - t;
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout") || ms >= TIMEOUT_MS - 100;
    return { nome, status: "down", ms, erro: isTimeout ? "TIMEOUT" : msg };
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "demazkgy2";
  const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL!;
  const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!;
  const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN!;
  const BREVO_API_KEY = process.env.BREVO_API_KEY!;

  const resultados: ResultadoApi[] = await Promise.all([
    testarApi("Cloudinary", () =>
      // Ping público — não requer autenticação
      fetch(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/sample.jpg`, { method: "HEAD" })
    ),

    testarApi("Evolution API", () =>
      // connectionState usa a chave da instância (não a global)
      fetch(`${EVOLUTION_API_URL}/instance/connectionState/${process.env.EVOLUTION_INSTANCIA || "alertapatriota"}`, {
        headers: { apikey: EVOLUTION_API_KEY },
      })
    ),

    testarApi("Mercado Pago", () =>
      // /v1/users/me funciona com qualquer access_token válido
      fetch("https://api.mercadopago.com/v1/users/me", {
        headers: { Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` },
      })
    ),

    testarApi("Brevo", () =>
      fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": BREVO_API_KEY },
      })
    ),

    (async (): Promise<ResultadoApi> => {
      const t = Date.now();
      try {
        await Promise.race([
          sql`SELECT 1`,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("TIMEOUT")), 5000)
          ),
        ]);
        const ms = Date.now() - t;
        return { nome: "Banco Neon", status: ms > 3000 ? "degradado" : "ok", ms };
      } catch (err) {
        return { nome: "Banco Neon", status: "down", ms: Date.now() - t, erro: String(err) };
      }
    })(),
  ]);

  // Verifica falhas consecutivas por API em agentes_log
  const downs = resultados.filter((r) => r.status === "down");
  const degradados = resultados.filter((r) => r.status === "degradado");

  for (const api of downs) {
    const falhasConsecutivas = await sql`
      SELECT COUNT(*) as total FROM agentes_log
      WHERE agente = 'arturo-apis'
        AND acao = 'health_check'
        AND status = 'erro'
        AND (detalhes->>'api_down')::text ILIKE ${`%${api.nome}%`}
        AND created_at >= NOW() - INTERVAL '2 hours'
    `;
    const qtdFalhas = Number(falhasConsecutivas[0].total) + 1;

    const prioridadeMaxima = qtdFalhas >= 2;
    const nivel = prioridadeMaxima ? ("🚨" as const) : ("🔴" as const);

    const linhas = resultados
      .map((r) => {
        const icon = r.status === "ok" ? "✅" : r.status === "degradado" ? "🟡" : "❌";
        const detalhe = r.status === "ok" ? `OK (${r.ms}ms)` : r.erro ?? `${r.ms}ms`;
        return `${icon} ${r.nome}: ${detalhe}`;
      })
      .join("\n");

    await alertarTelegram(
      nivel,
      `ARTURO APIS — ${api.nome} ${prioridadeMaxima ? "CRÍTICO (2ª falha)" : "DOWN"}`,
      `🔌 ${linhas}\n\n${api.nome} DOWN pode causar falha nos serviços do Alerta Patriota!`
    );

    await sql`
      INSERT INTO alertas (tipo, severidade, mensagem)
      VALUES (
        'api_externa_down',
        ${prioridadeMaxima ? "critico" : "alto"},
        ${`${api.nome} não respondeu (tentativa ${qtdFalhas})`}
      )
    `;
  }

  if (downs.length === 0 && degradados.length > 0) {
    const linhas = resultados
      .map((r) => {
        const icon = r.status === "ok" ? "✅" : r.status === "degradado" ? "🟡" : "❌";
        return `${icon} ${r.nome}: ${r.status === "ok" ? `OK (${r.ms}ms)` : `${r.ms}ms`}`;
      })
      .join("\n");

    await alertarTelegram(
      "🟡",
      "ARTURO APIS — Serviço Degradado",
      `🔌 ${linhas}`
    );
  }

  const duracao = Date.now() - inicio;
  const statusGeral = downs.length > 0 ? "erro" : degradados.length > 0 ? "aviso" : "sucesso";

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
    VALUES (
      'arturo-apis',
      'health_check',
      ${statusGeral},
      ${JSON.stringify({
        resultados,
        downs: downs.map((d) => d.nome),
        degradados: degradados.map((d) => d.nome),
        api_down: downs.map((d) => d.nome).join(", "),
      })},
      ${duracao}
    )
  `;

  const linhasResumo = resultados
    .map((r) => {
      const icon = r.status === "ok" ? "✅" : r.status === "degradado" ? "🟡" : "❌";
      return `${icon} ${r.nome}: ${r.status.toUpperCase()} (${r.ms}ms)`;
    })
    .join("\n");

  return NextResponse.json({
    ok: downs.length === 0,
    resumo: linhasResumo,
    resultados,
    downs: downs.length,
    degradados: degradados.length,
    duracao_ms: duracao,
  });
}
