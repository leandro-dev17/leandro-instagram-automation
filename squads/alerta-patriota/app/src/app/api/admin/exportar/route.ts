import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => {
      const v = String(r[h] ?? "").replace(/"/g, '""');
      return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v}"` : v;
    }).join(","))
  ];
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const tipo = searchParams.get("tipo") || "membros";

    let csv = "";
    let filename = "";

    if (tipo === "membros") {
      const rows = await sql`
        SELECT id, nome, email, telefone, plano, status, tipo_usuario,
          trial_inicio, trial_fim, assinatura_inicio, created_at
        FROM usuarios ORDER BY created_at DESC
      `;
      csv = toCSV(rows as Record<string, unknown>[]);
      filename = `membros-${new Date().toISOString().split("T")[0]}.csv`;
    } else if (tipo === "financeiro") {
      const rows = await sql`
        SELECT p.id, u.nome, u.email, u.plano, p.valor, p.status, p.metodo, p.created_at
        FROM pagamentos p JOIN usuarios u ON u.id = p.usuario_id
        ORDER BY p.created_at DESC LIMIT 1000
      `;
      csv = toCSV(rows as Record<string, unknown>[]);
      filename = `pagamentos-${new Date().toISOString().split("T")[0]}.csv`;
    } else if (tipo === "inadimplentes") {
      const rows = await sql`
        SELECT id, nome, email, telefone, plano, updated_at
        FROM usuarios WHERE status = 'inadimplente' ORDER BY updated_at DESC
      `;
      csv = toCSV(rows as Record<string, unknown>[]);
      filename = `inadimplentes-${new Date().toISOString().split("T")[0]}.csv`;
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
