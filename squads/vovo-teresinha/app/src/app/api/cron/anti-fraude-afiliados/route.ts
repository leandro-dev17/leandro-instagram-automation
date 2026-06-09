import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

// Detecta padrões de fraude no sistema de afiliados
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const suspeitos: string[] = [];

    // 1. Mesmo IP com muitas conversões em 24h (farm de afiliados)
    const ipsAbusivos = await sql`
      SELECT ip_visitante, COUNT(*) as total, COUNT(DISTINCT afiliado_id) as afiliados
      FROM rastreamento_links
      WHERE converteu = TRUE
        AND criado_em > NOW() - INTERVAL '24 hours'
        AND ip_visitante IS NOT NULL
      GROUP BY ip_visitante
      HAVING COUNT(*) > 3
    `;

    for (const ip of ipsAbusivos) {
      suspeitos.push(`IP abusivo: ${ip.ip_visitante} (${ip.total} conversões, ${ip.afiliados} afiliados)`);

      // Marca as comissões desse IP como fraude
      await sql`
        UPDATE comissoes c SET status = 'fraude'
        FROM rastreamento_links r
        WHERE c.rastreamento_id = r.id
          AND r.ip_visitante = ${ip.ip_visitante}
          AND r.criado_em > NOW() - INTERVAL '24 hours'
          AND c.status = 'pendente'
      `;
    }

    // 2. Afiliado que se auto-indicou (mesmo usuário)
    const autoIndicados = await sql`
      SELECT a.id, a.nome, a.codigo_afiliado, COUNT(r.id) as tentativas
      FROM afiliados a
      JOIN rastreamento_links r ON r.afiliado_id = a.id
      WHERE r.usuario_convertido_id = a.usuario_id
      GROUP BY a.id, a.nome, a.codigo_afiliado
      HAVING COUNT(r.id) > 0
    `;

    for (const af of autoIndicados) {
      suspeitos.push(`Auto-indicação: ${af.nome} (${af.codigo_afiliado})`);

      await sql`
        UPDATE comissoes c SET status = 'fraude'
        FROM rastreamento_links r
        JOIN afiliados a ON a.id = r.afiliado_id
        WHERE c.rastreamento_id = r.id
          AND r.usuario_convertido_id = a.usuario_id
          AND c.status = 'pendente'
      `;
    }

    // 3. Afiliado com taxa de conversão impossível (> 80% de todos os cliques)
    const taxaAbusiva = await sql`
      SELECT a.id, a.nome, a.codigo_afiliado,
             COUNT(*) as total_cliques,
             COUNT(*) FILTER (WHERE r.converteu) as conversoes,
             ROUND(COUNT(*) FILTER (WHERE r.converteu)::numeric / NULLIF(COUNT(*),0) * 100, 1) as taxa
      FROM afiliados a
      JOIN rastreamento_links r ON r.afiliado_id = a.id
      WHERE r.criado_em > NOW() - INTERVAL '7 days'
      GROUP BY a.id, a.nome, a.codigo_afiliado
      HAVING COUNT(*) > 10
        AND COUNT(*) FILTER (WHERE r.converteu)::numeric / NULLIF(COUNT(*),0) > 0.8
    `;

    for (const af of taxaAbusiva) {
      suspeitos.push(`Taxa suspeita: ${af.nome} (${af.taxa}% de conversão em ${af.total_cliques} cliques)`);

      await sql`
        UPDATE afiliados SET status = 'suspenso', atualizado_em = NOW()
        WHERE id = ${af.id} AND status = 'ativo'
      `;
    }

    if (suspeitos.length > 0) {
      await enviarTelegram(
        `🚨 <b>Anti-Fraude Afiliados</b>\n\n` +
        suspeitos.map(s => `⚠️ ${s}`).join("\n") +
        `\n\nComissões suspeitas marcadas como fraude e afiliados suspensos automaticamente.`
      );
    }

    await resolverFalhas("anti-fraude-afiliados");
    return NextResponse.json({ ok: true, suspeitos: suspeitos.length, detalhes: suspeitos });
  } catch (err) {
    await reportarFalha("anti-fraude-afiliados", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
