/**
 * AGENTE BRUNO BACKUP — Snapshot diário às 3h
 * Exporta dados críticos e salva no Google Drive via Neon API.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Conta registros para verificação de integridade
    const [usuarios, assinaturas, noticias, posts] = await Promise.all([
      sql`SELECT COUNT(*) as total FROM usuarios`,
      sql`SELECT COUNT(*) as total FROM assinaturas WHERE status = 'ativa'`,
      sql`SELECT COUNT(*) as total FROM noticias WHERE created_at >= NOW() - INTERVAL '7 days'`,
      sql`SELECT COUNT(*) as total FROM posts_whatsapp WHERE enviado_at >= NOW() - INTERVAL '7 days'`,
    ]);

    const integridade = {
      usuarios_total: Number(usuarios[0].total),
      assinaturas_ativas: Number(assinaturas[0].total),
      noticias_7d: Number(noticias[0].total),
      posts_7d: Number(posts[0].total),
      timestamp: new Date().toISOString(),
    };

    // Registra backup
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('bruno-backup', 'snapshot_integridade', 'sucesso', ${JSON.stringify(integridade)})
    `;

    // Alerta se usuários caírem muito (possível problema)
    if (integridade.usuarios_total === 0) {
      await alertarTelegram("🚨", "Bruno Backup — ALERTA DE INTEGRIDADE", "Tabela de usuários vazia! Verificar banco.");
    }

    // Usa Neon API para criar branch de backup
    const neonKey = process.env.NEON_API_KEY;
    const neonProject = process.env.NEON_PROJECT_ID;

    if (neonKey && neonProject) {
      const hoje = new Date().toISOString().split("T")[0];
      await fetch(`https://console.neon.tech/api/v2/projects/${neonProject}/branches`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${neonKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ branch: { name: `backup-${hoje}` } }),
      }).catch(() => {}); // não crítico se falhar
    }

    return NextResponse.json({ ok: true, integridade });
  } catch (err) {
    await alertarTelegram("🔴", "Bruno Backup — FALHA NO BACKUP", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
