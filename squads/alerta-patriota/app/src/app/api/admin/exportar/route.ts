import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// FASE 21: campos como "nome" vêm do cadastro do usuário sem nenhum controle de conteúdo.
// Um nome começando com =, +, -, @ ou tab é interpretado como fórmula pelo Excel/Sheets
// ao abrir o CSV (CSV injection / fórmula maliciosa), podendo executar comandos no Windows
// (ex: =cmd|'/c calc'!A1) na máquina do admin que abrir o export. Prefixamos com ' (apóstrofo)
// para neutralizar — o Excel exibe o valor como texto literal em vez de avaliar como fórmula.
function sanitizarCelulaCSV(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => {
      const v = sanitizarCelulaCSV(String(r[h] ?? "")).replace(/"/g, '""');
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
    // FASE 24: mesma proteção já aplicada a 6 outras rotas admin na Fase 23 — esta
    // rota ficou de fora daquela varredura e continuava devolvendo String(err) cru.
    console.error("admin/exportar GET error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
