import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const alertas: string[] = [];

  try {
    // Conta métricas atuais
    const [{ total: totalUsuarios }] = await sql`SELECT COUNT(*) as total FROM usuarios` as { total: number }[];
    const [{ total: totalAssinaturas }] = await sql`SELECT COUNT(*) as total FROM assinaturas WHERE status = 'ativo'` as { total: number }[];
    const [{ total: totalReceitas }] = await sql`SELECT COUNT(*) as total FROM receitas` as { total: number }[];

    const snapshot = {
      usuarios: Number(totalUsuarios),
      assinaturas_ativas: Number(totalAssinaturas),
      receitas: Number(totalReceitas),
    };

    // Lê snapshots anteriores
    const snapUsuarios = await sql`SELECT valor FROM app_configuracoes WHERE chave = 'backup_snapshot_usuarios'`;
    const snapAssinaturas = await sql`SELECT valor FROM app_configuracoes WHERE chave = 'backup_snapshot_assinaturas'`;
    const snapReceitas = await sql`SELECT valor FROM app_configuracoes WHERE chave = 'backup_snapshot_receitas'`;

    if (snapUsuarios.length > 0) {
      const anterior = Number(snapUsuarios[0].valor);
      if (anterior > 0 && snapshot.usuarios < anterior * 0.8) {
        alertas.push(`🚨 Usuários caíram mais de 20%: ${anterior} → ${snapshot.usuarios}`);
      }
    }

    if (snapAssinaturas.length > 0) {
      const anterior = Number(snapAssinaturas[0].valor);
      if (anterior > 0 && snapshot.assinaturas_ativas < anterior * 0.8) {
        alertas.push(`🚨 Assinaturas ativas caíram mais de 20%: ${anterior} → ${snapshot.assinaturas_ativas}`);
      }
    }

    if (snapReceitas.length > 0) {
      const anterior = Number(snapReceitas[0].valor);
      if (anterior > 0 && snapshot.receitas < anterior * 0.8) {
        alertas.push(`🚨 Receitas caíram mais de 20%: ${anterior} → ${snapshot.receitas}`);
      }
    }

    if (alertas.length > 0) {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      await enviarTelegram(
        `💾 <b>Backup Monitor — ALERTA — ${hora}</b>\n\n` +
          alertas.join("\n") +
          `\n\n<i>Verifique o banco de dados imediatamente!</i>`
      );
    }

    // Atualiza snapshots
    await sql`
      INSERT INTO app_configuracoes (chave, valor) VALUES ('backup_snapshot_usuarios', ${String(snapshot.usuarios)})
      ON CONFLICT (chave) DO UPDATE SET valor = ${String(snapshot.usuarios)}
    `;
    await sql`
      INSERT INTO app_configuracoes (chave, valor) VALUES ('backup_snapshot_assinaturas', ${String(snapshot.assinaturas_ativas)})
      ON CONFLICT (chave) DO UPDATE SET valor = ${String(snapshot.assinaturas_ativas)}
    `;
    await sql`
      INSERT INTO app_configuracoes (chave, valor) VALUES ('backup_snapshot_receitas', ${String(snapshot.receitas)})
      ON CONFLICT (chave) DO UPDATE SET valor = ${String(snapshot.receitas)}
    `;

    await resolverFalhas("backup-monitor");
    return NextResponse.json({ snapshot, alertas });
  } catch (err) {
    await reportarFalha("backup-monitor", String(err));
    return NextResponse.json({ erro: "Falha no backup monitor", detalhes: String(err) }, { status: 500 });
  }
}
