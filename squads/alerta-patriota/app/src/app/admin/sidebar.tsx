"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href:"/admin",             icon:"📊", label:"Dashboard"   },
  { href:"/admin/membros",     icon:"👥", label:"Membros"     },
  { href:"/admin/usuarios",    icon:"🗑️", label:"LGPD / Em massa" },
  { href:"/admin/financeiro",  icon:"💰", label:"Financeiro"  },
  { href:"/admin/conteudo",    icon:"📰", label:"Conteúdo"    },
  { href:"/admin/noticias",    icon:"🗞️", label:"Notícias"    },
  { href:"/admin/grupos",      icon:"📱", label:"Grupos WPP"  },
  { href:"/admin/mensagens",   icon:"💬", label:"Mensagens"   },
  { href:"/admin/prompts",     icon:"🧠", label:"Prompts IA"  },
  { href:"/admin/agentes",     icon:"🤖", label:"Agentes"     },
  { href:"/admin/logs",        icon:"📋", label:"Logs"        },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [crise, setCrise] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    fetch("/api/admin/modo-crise").then(r => r.json()).then(d => setCrise(d.ativo || false)).catch(() => {});
  }, []);

  const toggleCrise = async () => {
    setToggling(true);
    const acao = crise ? "desativar" : "ativar";
    const res = await fetch("/api/admin/modo-crise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao }),
    });
    const d = await res.json();
    if (d.ok) setCrise(!crise);
    setToggling(false);
  };

  return (
    <aside style={{ width:220, flexShrink:0, background:"rgba(255,255,255,0.03)", backdropFilter:"blur(20px)", borderRight:"1px solid rgba(255,255,255,0.07)", display:"flex", flexDirection:"column", position:"fixed", top:0, left:0, height:"100vh", zIndex:100, overflow:"hidden" }}>
      {/* Logo */}
      <div style={{ padding:"16px 14px", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <img src="/logo.png" alt="" style={{ width:32, height:32, borderRadius:"50%", border:"1.5px solid rgba(255,215,0,.4)", objectFit:"cover" }} />
        <div>
          <p style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14, letterSpacing:1, background:"linear-gradient(90deg,#ffd700,#ff9500)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>ALERTA PATRIOTA</p>
          <p style={{ fontSize:9, color:"#2a2a3a", letterSpacing:1.5, textTransform:"uppercase" }}>Admin Panel</p>
        </div>
      </div>

      {/* Botão Modo Crise */}
      <div style={{ padding:"10px 10px 0", flexShrink:0 }}>
        <button onClick={toggleCrise} disabled={toggling} style={{
          width:"100%", padding:"8px 10px", borderRadius:8, border:"none", cursor:"pointer", fontSize:11, fontWeight:700,
          background:crise ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.05)",
          color:crise ? "#ef4444" : "#444",
          borderTop:`1px solid ${crise?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.08)"}`,
          transition:"all .2s",
        }}>
          {toggling ? "..." : crise ? "🚨 CRISE ATIVA — Desativar" : "🔕 Modo Crise: OFF"}
        </button>
      </div>

      {/* Nav scrollável */}
      <nav style={{ flex:1, padding:"8px 8px", display:"flex", flexDirection:"column", gap:2, overflowY:"auto" }}>
        {NAV.map(item => {
          const ativo = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} style={{ display:"flex", alignItems:"center", gap:9, padding:"9px 10px", borderRadius:9, textDecoration:"none", background:ativo?"rgba(255,215,0,0.1)":"transparent", border:ativo?"1px solid rgba(255,215,0,0.2)":"1px solid transparent", color:ativo?"#ffd700":"#444", fontWeight:ativo?700:400, fontSize:12, transition:"all .15s" }}>
              <span style={{ fontSize:14 }}>{item.icon}</span>
              {item.label}
              {ativo && <span style={{ marginLeft:"auto", width:4, height:4, borderRadius:"50%", background:"#ffd700", flexShrink:0 }} />}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding:"10px 14px", borderTop:"1px solid rgba(255,255,255,0.05)", flexShrink:0 }}>
        <p style={{ fontSize:9, color:"#1e1e2e", fontStyle:"italic" }}>"Deus, Pátria e Família — sempre."</p>
      </div>
    </aside>
  );
}
