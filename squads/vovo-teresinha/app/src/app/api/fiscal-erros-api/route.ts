import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "fiscal-erros-api");
  if (!auth.ok) {
    return NextResponse.json(
      {
        erro: "Não autorizado",
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Verifica erros de API registrados nas últimas 24h
    // A tabela logs_erros_api não existe no schema atual — o app não persiste
    // erros de API em banco. Retornamos resultado vazio de forma segura.
    console.log("[fiscal-erros-api] Tabela logs_erros_api não existe no schema atual — retornando resultado vazio.");

    return NextResponse.json({
      ok: true,
      periodo: "24h",
      endpoints_com_erros: 0,
      detalhes: [],
      aviso: "Tabela logs_erros_api ainda não existe no banco. Nenhum erro de API foi registrado.",
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-erros-api] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no fiscal de erros de API", detalhe: mensagem },
      { status: 500 }
    );
  }
}
