import type { Metadata } from "next";
import AdminSidebar from "./sidebar";

export const metadata: Metadata = { title: "Admin — Alerta Patriota" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700;800;900&display=swap');
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        body { background:#08080f; color:#fff; font-family:'Inter',sans-serif; overflow-x:hidden; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:#08080f; }
        ::-webkit-scrollbar-thumb { background:linear-gradient(to bottom,#ffd700,#ff8c00); border-radius:4px; }
      `}</style>
      <div style={{ display:"flex", minHeight:"100vh" }}>
        <AdminSidebar />
        <main style={{ flex:1, marginLeft:220, minHeight:"100vh", background:"#08080f" }}>
          <div style={{ height:52, display:"flex", alignItems:"center", padding:"0 24px", borderBottom:"1px solid rgba(255,255,255,0.05)", background:"rgba(255,255,255,0.02)", justifyContent:"space-between", position:"sticky", top:0, zIndex:50 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"#22c55e", boxShadow:"0 0 8px #22c55e" }} />
              <span style={{ fontSize:12, color:"#444" }}>Sistema operacional</span>
            </div>
            <a href="/" target="_blank" style={{ fontSize:12, color:"#333", textDecoration:"none" }}>🌐 Ver site</a>
          </div>
          <div style={{ padding:"0" }}>{children}</div>
        </main>
      </div>
    </>
  );
}
