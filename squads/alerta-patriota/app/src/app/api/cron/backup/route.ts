/**
 * AGENTE BRUNO BACKUP — Snapshot diário às 3h
 * Exporta dados críticos e salva no Google Drive via Neon API.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

// FASE 27 (item 5): retenção de 14 dias para as branches de backup do Neon.
// O cron criava uma branch `backup-YYYY-MM-DD` todo dia e nunca apagava nenhuma —
// crescimento indefinido de armazenamento/custo. 14 dias cobre qualquer cenário
// realista de "preciso recuperar de um backup" (resposta a incidente) sem acumular
// branches por meses. Ajustável aqui se o usuário quiser outro período.
const RETENCAO_DIAS = 14;

async function limparBackupsAntigos(neonKey: string, neonProject: string): Promise<{ apagados: number; falhas: number }> {
  let apagados = 0;
  let falhas = 0;
  try {
    const res = await fetch(`https://console.neon.tech/api/v2/projects/${neonProject}/branches`, {
      headers: { Authorization: `Bearer ${neonKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { apagados: 0, falhas: 1 };
    const data = await res.json();
    const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
    const antigos = (data.branches || []).filter(
      (b: { name?: string; id: string; created_at: string }) =>
        typeof b.name === "string" && b.name.startsWith("backup-") && new Date(b.created_at).getTime() < limite
    );
    for (const b of antigos) {
      const del = await fetch(`https://console.neon.tech/api/v2/projects/${neonProject}/branches/${b.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${neonKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (del.ok) apagados++;
      else falhas++;
    }
  } catch {
    falhas++;
  }
  return { apagados, falhas };
}

export const maxDuration = 60;

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
    let branchCriado = false;

    if (neonKey && neonProject) {
      const hoje = new Date().toISOString().split("T")[0];
      try {
        const res = await fetch(`https://console.neon.tech/api/v2/projects/${neonProject}/branches`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${neonKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ branch: { name: `backup-${hoje}` } }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const corpo = await res.text().catch(() => "");
          throw new Error(`Status ${res.status}: ${corpo}`);
        }
        branchCriado = true;
      } catch (e) {
        // FASE 21: antes o erro era engolido (.catch(() => {})) — o backup "logico" (contagens)
        // sempre marcava sucesso mesmo se o branch de backup real no Neon nunca fosse criado,
        // deixando o sistema sem snapshot de recuperação sem que ninguém soubesse.
        await alertarTelegram("🔴", "Bruno Backup — falha ao criar branch de backup no Neon", String(e));
      }
    } else {
      await alertarTelegram("🟡", "Bruno Backup — branch de backup não criado", "NEON_API_KEY ou NEON_PROJECT_ID não configurados.");
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('bruno-backup', 'criar_branch_neon', ${branchCriado ? "sucesso" : "erro"}, ${JSON.stringify({ branchCriado })})
    `.catch(() => {});

    // Limpeza de branches de backup com mais de RETENCAO_DIAS dias
    let limpeza = { apagados: 0, falhas: 0 };
    if (neonKey && neonProject) {
      limpeza = await limparBackupsAntigos(neonKey, neonProject);
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('bruno-backup', 'limpar_branches_antigas', ${limpeza.falhas === 0 ? "sucesso" : "aviso"}, ${JSON.stringify({ ...limpeza, retencaoDias: RETENCAO_DIAS })})
      `.catch(() => {});
      if (limpeza.falhas > 0) {
        await alertarTelegram("🟡", "Bruno Backup — falha ao apagar branch(es) antiga(s) do Neon", `${limpeza.falhas} falha(s) ao apagar, ${limpeza.apagados} apagada(s) com sucesso.`);
      }
    }

    return NextResponse.json({ ok: true, integridade, branchCriado, limpeza });
  } catch (err) {
    await alertarTelegram("🔴", "Bruno Backup — FALHA NO BACKUP", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
