"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Stats = {
  membros: { ativos: number; trial: number; inadimplentes: number; cancelados: number; vip: number; elite: number; novos_hoje: number; cancelados_hoje: number };
  financeiro: { mrr_estimado: number };
  grupos: Array<{ nome: string; plano: string; membros_ativos: number; max_membros: number }>;
  noticias: { total_24h: number; urgentes_24h: number };
  erros_recentes: Array<{ agente: string; acao: string; status: string; created_at: string }>;
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataHora, setDataHora] = useState("");

  useEffect(() => {
    // Data só no cliente para evitar hydration mismatch
    setDataHora(new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }));
    fetch("/api/admin/stats").then(r => r.json()).then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}>
      <p style={{ color:"#444", fontSize:14 }}>Carregando dados...</p>
    </div>
  );

  if (!stats) return <div style={{ padding:24, color:"#ef4444" }}>Erro ao carregar. Tente recarregar.</div>;

  const mrr = Number(stats.financeiro?.mrr_estimado || 0);
  const fmt = (v: number) => `R$${v.toFixed(2).replace(".", ",")}`;

  const kpis = [
    { label:"Membros Ativos",     val: stats.membros.ativos,         cor:"#22c55e", icon:"👥" },
    { label:"MRR Estimado",       val: fmt(mrr),                     cor:"#ffd700", icon:"💰" },
    { label:"Novos Hoje",         val: `+${stats.membros.novos_hoje}`,cor:"#3b82f6", icon:"📈" },
    { label:"Cancelamentos Hoje", val: stats.membros.cancelados_hoje, cor:"#ef4444", icon:"📉" },
    { label:"Em Trial",           val: stats.membros.trial,           cor:"#f59e0b", icon:"⏳" },
    { label:"Inadimplentes",      val: stats.membros.inadimplentes,   cor:"#f97316", icon:"⚠️" },
  ];

  const planos = [
    { p:"VIP",      val:stats.membros.vip,      cor:"#dc2626",e:"🔥"  },
    { p:"Elite",    val:stats.membros.elite,    cor:"#7c3aed",e:"🎖️"  },
  ];

  const nav = [
    { href:"/admin/membros",    l:"👥 Membros"    },
    { href:"/admin/financeiro", l:"💰 Financeiro" },
    { href:"/admin/conteudo",   l:"📰 Conteúdo"   },
    { href:"/admin/grupos",     l:"📱 Grupos"     },
    { href:"/admin/agentes",    l:"🤖 Agentes"    },
    { href:"/admin/logs",       l:"📋 Logs"       },
  ];

  return (
    <div style={{ padding:24, maxWidth:1100, fontFamily:"'Inter',sans-serif" }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:900, color:"#ffd700", marginBottom:4 }}>📊 Painel de Comando</h1>
        {dataHora && <p style={{ color:"#333", fontSize:12 }}>{dataHora}</p>}
      </div>

      {/* KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))", gap:12, marginBottom:20 }}>
        {kpis.map((k,i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"14px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
              <span>{k.icon}</span>
              <span style={{ fontSize:10, color:"#444", textTransform:"uppercase", letterSpacing:.8 }}>{k.label}</span>
            </div>
            <p style={{ fontSize:26, fontWeight:900, color:k.cor }}>{k.val}</p>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
        {/* Planos */}
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:18 }}>
          <p style={{ fontSize:11, color:"#444", textTransform:"uppercase", letterSpacing:1, marginBottom:14 }}>Membros por Plano</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {planos.map(p => (
              <div key={p.p} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"10px 12px", border:`1px solid ${p.cor}22` }}>
                <span style={{ fontSize:18 }}>{p.e}</span>
                <p style={{ fontSize:20, fontWeight:900, color:p.cor, margin:"3px 0" }}>{p.val}</p>
                <p style={{ fontSize:10, color:"#444" }}>{p.p}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Grupos */}
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:18 }}>
          <p style={{ fontSize:11, color:"#444", textTransform:"uppercase", letterSpacing:1, marginBottom:14 }}>Grupos WhatsApp</p>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {stats.grupos.map(g => {
              const pct = Math.round((g.membros_ativos / g.max_membros) * 100);
              const cor = pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#22c55e";
              return (
                <div key={g.plano}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                    <span style={{ color:"#aaa" }}>{g.nome}</span>
                    <span style={{ color:"#444" }}>{g.membros_ativos}/{g.max_membros}</span>
                  </div>
                  <div style={{ background:"#1e1e2e", borderRadius:3, height:5 }}>
                    <div style={{ background:cor, height:5, borderRadius:3, width:`${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Erros + Notícias */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:18 }}>
          <p style={{ fontSize:11, color:"#444", textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>Conteúdo (24h)</p>
          <div style={{ display:"flex", gap:24 }}>
            <div><p style={{ fontSize:28, fontWeight:900, color:"#ffd700" }}>{stats.noticias.total_24h}</p><p style={{ fontSize:11, color:"#444" }}>coletadas</p></div>
            <div><p style={{ fontSize:28, fontWeight:900, color:"#ef4444" }}>{stats.noticias.urgentes_24h}</p><p style={{ fontSize:11, color:"#444" }}>urgentes</p></div>
          </div>
        </div>
        <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${stats.erros_recentes.length > 0 ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.07)"}`, borderRadius:14, padding:18 }}>
          <p style={{ fontSize:11, color:stats.erros_recentes.length > 0 ? "#ef4444" : "#22c55e", textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>
            {stats.erros_recentes.length === 0 ? "✅ Sistema Saudável" : `⚠️ ${stats.erros_recentes.length} Erro(s)`}
          </p>
          {stats.erros_recentes.length === 0
            ? <p style={{ color:"#22c55e", fontSize:13 }}>Nenhum erro nas últimas 24h.</p>
            : stats.erros_recentes.slice(0,3).map((e,i) => (
              <div key={i} style={{ background:"rgba(239,68,68,0.07)", borderRadius:6, padding:"5px 8px", marginBottom:4, fontSize:11 }}>
                <span style={{ color:"#ef4444", fontWeight:700 }}>{e.agente}</span>
                <span style={{ color:"#555", marginLeft:6 }}>{e.acao}</span>
              </div>
            ))
          }
        </div>
      </div>

      {/* Navegação rápida */}
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:18 }}>
        <p style={{ fontSize:11, color:"#444", textTransform:"uppercase", letterSpacing:1, marginBottom:14 }}>Acesso Rápido</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))", gap:8 }}>
          {nav.map(item => (
            <Link key={item.href} href={item.href} style={{ display:"block", textAlign:"center", padding:"11px 8px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, textDecoration:"none", color:"#777", fontSize:13 }}>
              {item.l}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
