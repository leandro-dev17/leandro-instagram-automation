"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const PLANOS = [
  {
    id: "vip", emoji: "🔥", nome: "VIP Premium", badge: "MAIS COMPLETO", badgeCls: "b-vip",
    precoMensal: "9,90", precoAnual: "99", mesesAnual: "8,25",
    cls: "vip", btn: "btn-red", btnTxt: "Começar 7 dias grátis",
    items: ["7 entregas por dia", "Alertas urgentes de deputados", "Enquete + Resumo da Noite", "Capitão Braga responde suas dúvidas", "Termômetro da Liberdade"],
  },
  {
    id: "elite", emoji: "🎖️", nome: "Elite Global", badge: "EXCLUSIVO", badgeCls: "b-elite",
    precoMensal: "19,90", precoAnual: "199", mesesAnual: "16,58",
    cls: "elite", btn: "btn-purple", btnTxt: "Começar 7 dias grátis",
    items: ["8 análises/dia — Brasil e mundo", "Prof. Cavalcanti exclusivo", "Radar Econômico diário", "Prof. Cavalcanti responde suas perguntas", "Dossiê Semanal em PDF"],
  },
];

export default function Home() {
  const [stickyVisible, setStickyVisible] = useState(false);
  const [ciclo, setCiclo] = useState<"mensal" | "anual">("mensal");
  const [progress, setProgress] = useState(0);
  const heroRef = useRef<HTMLElement>(null);

  // Gate modal — inicia aberto; fecha se já visitou (evita delay por useEffect)
  const [gateOpen, setGateOpen] = useState(true);
  const [gateNome, setGateNome] = useState("");
  const [gateEmail, setGateEmail] = useState("");
  const [gateTelefone, setGateTelefone] = useState("");
  const [gateErro, setGateErro] = useState("");
  const [gateLoading, setGateLoading] = useState(false);
  const [dadosUser, setDadosUser] = useState<{ nome: string; email: string; telefone: string } | null>(null);
  const [pendingPlano, setPendingPlano] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    const jaOk = localStorage.getItem("ap_gate_ok");
    if (jaOk) {
      const n = localStorage.getItem("ap_nome") || "";
      const e = localStorage.getItem("ap_email") || "";
      const t = localStorage.getItem("ap_tel") || "";
      if (n && e && t) setDadosUser({ nome: n, email: e, telefone: t });
      setGateOpen(false);
    }
  }, []);

  // Sticky CTA
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => setStickyVisible(!e.isIntersecting), { threshold: 0.2 });
    if (heroRef.current) obs.observe(heroRef.current);
    return () => obs.disconnect();
  }, []);

  // Progress bar
  useEffect(() => {
    const onScroll = () => {
      const p = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
      setProgress(Math.min(p * 100, 100));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Reveal on scroll
  useEffect(() => {
    const reveals = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    reveals.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const handleTilt = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-6px) scale(1.02)`;
  }, []);
  const resetTilt = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = "";
  }, []);

  async function handleGateSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setGateErro("");
    const fone = gateTelefone.replace(/\D/g, "");
    const emailVal = gateEmail.trim().toLowerCase();
    if (!gateNome.trim()) { setGateErro("Informe seu nome."); return; }
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) { setGateErro("Informe um e-mail válido."); return; }
    if (fone.length < 10) { setGateErro("WhatsApp inválido — informe com DDD."); return; }
    setGateLoading(true);

    fetch("/api/leads/registrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: gateNome.trim(), email: emailVal, telefone: fone, origem: "gate-modal" }),
    }).catch(() => {});

    localStorage.setItem("ap_gate_ok", "1");
    localStorage.setItem("ap_nome", gateNome.trim());
    localStorage.setItem("ap_email", emailVal);
    localStorage.setItem("ap_tel", fone);

    const dados = { nome: gateNome.trim(), email: emailVal, telefone: fone };
    setDadosUser(dados);

    if (pendingPlano) {
      try {
        const res = await fetch("/api/assinaturas/criar-direto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: dados.nome, email: dados.email, telefone: dados.telefone, plano: pendingPlano, ciclo }),
        });
        const data = await res.json();
        if (data.checkout_url) { window.location.href = data.checkout_url; return; }
        else { setGateLoading(false); alert("Erro ao gerar o link.\n\n" + (data.detalhe || data.erro || "Tente novamente.")); return; }
      } catch (e) { setGateLoading(false); alert("Erro de conexão: " + String(e)); return; }
    }

    setGateOpen(false);
    setGateLoading(false);
  }

  async function handleCheckout(planoId: string) {
    if (!dadosUser) {
      setPendingPlano(planoId);
      setGateOpen(true);
      return;
    }
    setCheckoutLoading(planoId);
    try {
      const res = await fetch("/api/assinaturas/criar-direto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: dadosUser.nome, email: dadosUser.email, telefone: dadosUser.telefone, plano: planoId, ciclo }),
      });
      const data = await res.json();
      if (data.checkout_url) { window.location.href = data.checkout_url; }
      else { alert("Erro ao gerar o link.\n\n" + (data.detalhe || data.erro || "Tente novamente.")); }
    } catch (e) { alert("Erro de conexão: " + String(e)); }
    finally { setCheckoutLoading(null); }
  }

  return (
    <>
      <style>{`
        *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
        html{scroll-behavior:smooth}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#0a0a14}
        ::-webkit-scrollbar-thumb{background:linear-gradient(to bottom,#ffd700,#ff8c00);border-radius:4px}
        body{background:#0a0a14;color:#fff;font-family:var(--font-inter),'Inter',sans-serif;overflow-x:hidden}
        body::after{content:'';position:fixed;inset:0;z-index:9998;pointer-events:none;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/></svg>");opacity:.028}

        @keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        @keyframes goldShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,215,0,.4)}50%{box-shadow:0 0 0 10px rgba(255,215,0,0)}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        .anim-1{animation:fadeUp .7s ease both .1s}
        .anim-2{animation:fadeUp .7s ease both .25s}
        .anim-3{animation:fadeUp .7s ease both .4s}
        .anim-4{animation:fadeUp .7s ease both .55s}
        .anim-5{animation:fadeUp .7s ease both .7s}
        .reveal{opacity:0;transform:translateY(24px);transition:opacity .65s ease,transform .65s ease}
        .reveal.visible{opacity:1;transform:none}

        /* ── GATE MODAL ──────────────────────────────────────── */
        @keyframes gateFadeIn{from{opacity:0}to{opacity:1}}
        @keyframes redSlide{0%{background-position:0% 0}100%{background-position:200% 0}}
        @keyframes redPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.6)}50%{box-shadow:0 0 0 18px rgba(220,38,38,0)}}
        @keyframes lineIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
        @keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
        @keyframes ticker{from{transform:translateX(100%)}to{transform:translateX(-200%)}}
        @keyframes staticFlicker{
          0%,88%,90%,95%,100%{opacity:1}
          89%{opacity:.8}
          94%{opacity:.88}
        }

        .gate-overlay{
          position:fixed;inset:0;z-index:99999;
          background:radial-gradient(ellipse at 50% 30%,#0d0000 0%,#020202 70%);
          display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
          padding:20px;animation:gateFadeIn .45s ease,staticFlicker 5s ease infinite;overflow-y:auto;
        }
        .gate-overlay::before{
          content:'';position:fixed;inset:0;
          background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.18) 2px,rgba(0,0,0,.18) 4px);
          pointer-events:none;z-index:1;
        }
        .gate-bar{
          position:fixed;top:0;left:0;right:0;height:4px;
          background:linear-gradient(90deg,#6b0000,#dc2626,#ff3333,#dc2626,#6b0000);
          background-size:200% 100%;animation:redSlide 1.4s linear infinite;z-index:100001;
        }
        .gate-ticker{
          position:fixed;bottom:0;left:0;right:0;
          background:#dc2626;height:28px;
          display:flex;align-items:center;z-index:100001;
        }
        .gate-ticker-label{
          background:#7b0000;color:#fff;font-size:10px;font-weight:900;
          padding:0 12px;height:100%;display:flex;align-items:center;
          letter-spacing:1.5px;flex-shrink:0;white-space:nowrap;
        }
        .gate-ticker-track{
          flex:1;overflow:hidden;height:100%;display:flex;align-items:center;
        }
        .gate-ticker-text{
          white-space:nowrap;animation:ticker 22s linear infinite;
          font-size:11px;font-weight:700;color:#fff;letter-spacing:.8px;
        }
        .gate-inner{max-width:430px;width:100%;padding:28px 0 60px;margin:auto 0;position:relative;z-index:2}
        .gate-live{
          display:flex;align-items:center;gap:7px;margin-bottom:20px;
          animation:lineIn .4s ease .05s both;
        }
        .gate-live-dot{
          width:9px;height:9px;border-radius:50%;background:#dc2626;
          animation:blink 1s steps(1) infinite;box-shadow:0 0 8px #dc2626;flex-shrink:0;
        }
        .gate-live-text{font-size:11px;font-weight:900;letter-spacing:2.5px;color:#dc2626;text-transform:uppercase}
        .gate-icon{font-size:56px;text-align:center;margin-bottom:16px;line-height:1}
        .gate-warnings{margin-bottom:18px;text-align:center}
        .gate-warn-line{
          display:block;color:#dc2626;font-weight:900;
          font-size:clamp(15px,3.8vw,19px);line-height:1.95;letter-spacing:.6px;
          animation:lineIn .5s ease both;
        }
        .gate-warn-line:nth-child(1){animation-delay:.1s}
        .gate-warn-line:nth-child(2){animation-delay:.25s}
        .gate-warn-line:nth-child(3){animation-delay:.4s}
        .gate-question{
          font-family:var(--font-bebas),'Bebas Neue',sans-serif;
          font-size:clamp(23px,6vw,34px);
          color:#fff;text-align:center;letter-spacing:1.5px;
          margin:0 0 18px;line-height:1.15;
          animation:lineIn .5s ease .55s both;
        }
        .gate-body{
          color:#5a5a5a;font-size:clamp(13px,2.5vw,15px);
          line-height:1.85;text-align:center;margin-bottom:4px;
          animation:lineIn .5s ease .65s both;
        }
        .gate-bold{
          color:#e0e0e0;font-weight:800;
          font-size:clamp(14px,3vw,17px);
          text-align:center;margin:14px 0 20px;line-height:1.7;
          animation:lineIn .5s ease .75s both;
        }
        .gate-urgency{
          color:#dc2626;font-size:clamp(12px,2.8vw,14px);font-weight:700;
          text-align:center;line-height:1.75;margin:0 0 22px;
          border:1px solid rgba(220,38,38,.25);background:rgba(220,38,38,.07);
          padding:12px 16px;border-radius:10px;
          animation:lineIn .5s ease .82s both;
        }
        .gate-input{
          width:100%;background:#080808;
          border:1px solid #1c1c1c;border-radius:11px;
          padding:15px 16px;color:#fff;font-size:16px;
          outline:none;box-sizing:border-box;display:block;
          transition:border-color .25s,box-shadow .25s;
          animation:lineIn .5s ease .9s both;
        }
        .gate-input:focus{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,.12)}
        .gate-input+.gate-input{margin-top:10px}
        .gate-erro{color:#dc2626;font-size:13px;margin:8px 0 0;text-align:center}
        .gate-btn{
          width:100%;
          background:linear-gradient(135deg,#991b1b,#dc2626,#b91c1c);
          color:#fff;font-weight:900;
          font-size:clamp(12px,3vw,15px);
          padding:17px 12px;border-radius:12px;border:none;
          cursor:pointer;margin-top:16px;letter-spacing:.8px;
          animation:redPulse 2s ease infinite;
          line-height:1.35;display:block;
        }
        .gate-btn:hover{opacity:.9}
        .gate-btn:disabled{opacity:.5;cursor:not-allowed;animation:none}
        .gate-skip{
          background:none;border:none;color:#1e1e1e;font-size:11px;
          cursor:pointer;display:block;width:100%;text-align:center;
          margin-top:14px;padding:4px;
        }
        .gate-skip:hover{color:#3a3a3a}

        /* PROGRESS */
        .progress-bar{position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#ffd700,#ff8c00);z-index:9999;transition:width .1s linear;border-radius:0 2px 2px 0}

        /* STICKY */
        .sticky-cta{position:fixed;bottom:0;left:0;right:0;z-index:9997;padding:10px 20px 18px;background:linear-gradient(to top,rgba(10,10,20,.98) 70%,transparent);display:flex;flex-direction:column;align-items:center;gap:4px;transform:translateY(100%);transition:transform .35s cubic-bezier(.4,0,.2,1);pointer-events:none}
        .sticky-cta.show{transform:translateY(0);pointer-events:all}
        .sticky-cta a{display:block;width:100%;max-width:420px;text-align:center;background:linear-gradient(90deg,#ffd700,#ff9500,#ffd700);background-size:200% 100%;color:#0a0a14;font-weight:900;font-size:17px;padding:15px 20px;border-radius:14px;text-decoration:none;animation:goldShine 3s ease infinite}
        .sticky-cta p{font-size:10px;color:#444}

        /* HERO */
        .hero{position:relative;min-height:100svh;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;padding:80px 20px 100px}
        .hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:60% 15%;filter:brightness(.3) saturate(.7)}
        .hero-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(10,10,20,.5) 0%,rgba(10,10,20,.1) 40%,rgba(10,10,20,.95) 100%)}
        .hero-content{position:relative;z-index:2;max-width:680px;width:100%}
        .logo-circle{width:100px;height:100px;border-radius:50%;border:3px solid #ffd700;box-shadow:0 0 40px rgba(255,215,0,.4),0 0 80px rgba(255,215,0,.15);margin:0 auto 20px;object-fit:cover;display:block;animation:float 4s ease-in-out infinite}
        .hero-badge{display:inline-block;background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.4);color:#ffd700;font-size:11px;font-weight:700;padding:6px 18px;border-radius:999px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:22px;backdrop-filter:blur(8px)}
        .hero h1{font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:clamp(44px,10vw,82px);font-weight:400;line-height:1;margin-bottom:8px;letter-spacing:1px;text-shadow:0 4px 30px rgba(0,0,0,.7)}
        .hero h1 .gold-grad{background:linear-gradient(90deg,#ffd700,#ff8c00,#ffe066,#ffd700);background-size:300% 100%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:goldShine 4s ease infinite}
        .hero-sub{font-size:clamp(14px,2.5vw,18px);color:#ccc;max-width:520px;margin:16px auto 28px;line-height:1.7;text-shadow:0 1px 10px rgba(0,0,0,.5)}
        .cta-main{display:inline-block;background:linear-gradient(90deg,#ffd700,#ff9500,#ffd700);background-size:200% 100%;color:#0a0a14;font-weight:900;font-size:clamp(15px,3.5vw,19px);padding:16px 48px;border-radius:14px;text-decoration:none;box-shadow:0 8px 32px rgba(255,215,0,.35);animation:goldShine 3s ease infinite,pulse 2.5s ease infinite;transition:transform .2s;border:none;cursor:pointer}
        .cta-main:hover{transform:scale(1.04)}
        .cta-note{color:#555;font-size:11px;margin-top:10px}
        .social-proof{display:flex;justify-content:center;gap:clamp(20px,6vw,52px);margin-top:38px;flex-wrap:wrap}
        .proof-item{text-align:center}
        .proof-num{font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:clamp(26px,6vw,36px);font-weight:400;color:#ffd700;display:block;letter-spacing:1px}
        .proof-label{font-size:11px;color:#555;letter-spacing:.5px}

        .urgency{background:linear-gradient(90deg,#5c0000,#a91e1e,#5c0000);padding:14px 20px;text-align:center;position:relative;z-index:2}
        .urgency p{font-size:clamp(12px,2.5vw,15px);font-weight:700;line-height:1.4}
        .urgency strong{color:#ffd700}

        .section-angled{clip-path:polygon(0 4%,100% 0,100% 96%,0 100%)}
        .section-angled-rev{clip-path:polygon(0 0,100% 4%,100% 100%,0 96%)}

        .benefits{background:#0c0c1a;padding:90px 20px;position:relative;z-index:1}
        .section-label{text-align:center;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#333;margin-bottom:10px}
        .section-title{text-align:center;font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:clamp(28px,6vw,52px);font-weight:400;line-height:1.1;margin-bottom:12px;letter-spacing:1px}
        .section-title .red{color:#ef4444}.section-title .gold2{color:#ffd700}
        .section-sub{text-align:center;color:#666;font-size:clamp(13px,2vw,16px);max-width:560px;margin:0 auto 50px;line-height:1.75}
        .benefits-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;max-width:960px;margin:0 auto}
        .benefit-glass{position:relative;border-radius:20px;padding:30px 26px;overflow:hidden;background:rgba(255,255,255,.04);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);transition:border-color .3s,box-shadow .3s}
        .benefit-glass:hover{border-color:rgba(255,215,0,.3);box-shadow:0 8px 40px rgba(255,215,0,.08)}
        .benefit-glass.gold2{border-color:rgba(255,215,0,.15)}.benefit-glass.red2{border-color:rgba(220,38,38,.15)}.benefit-glass.blue2{border-color:rgba(59,130,246,.15)}
        .bg-glow{position:absolute;top:-40px;right:-40px;width:140px;height:140px;border-radius:50%;opacity:.07}
        .bg-glow.gold{background:#ffd700}.bg-glow.red{background:#ef4444}.bg-glow.blue{background:#3b82f6}
        .b-icon{font-size:42px;margin-bottom:18px;display:block}
        .benefit-glass h3{font-size:clamp(14px,2.5vw,17px);font-weight:800;margin-bottom:10px}
        .ag{color:#ffd700}.ar{color:#ef4444}.ab{color:#60a5fa}
        .benefit-glass p{color:#777;font-size:13px;line-height:1.75}

        .personas-wrap{padding:90px 20px;max-width:1000px;margin:0 auto;position:relative;z-index:1}
        .personas-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:36px}
        .persona-glass{border-radius:24px;overflow:hidden;background:rgba(255,255,255,.03);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.07);transition:transform .3s,box-shadow .3s}
        .persona-glass:hover{transform:translateY(-4px)}
        .persona-glass.braga{border-color:rgba(255,215,0,.2);box-shadow:0 0 40px rgba(255,215,0,.04)}
        .persona-glass.cavalcanti{border-color:rgba(147,51,234,.2);box-shadow:0 0 40px rgba(147,51,234,.04)}
        .persona-glass img{width:100%;height:260px;object-fit:cover;object-position:top;display:block}
        .persona-body{padding:22px}
        .persona-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
        .persona-name{font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:22px;font-weight:400;letter-spacing:.5px}
        .pn-gold{color:#ffd700}.pn-purple{color:#a855f7}
        .persona-role{font-size:11px;color:#444;margin-top:2px}
        .persona-bio{color:#888;font-size:13px;line-height:1.75;margin-bottom:14px}
        .persona-quote{font-style:italic;font-size:13px;font-weight:700}
        .pq-gold{color:#ffd700}.pq-purple{color:#a855f7}
        .persona-serves{margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:#333}
        .persona-serves span{color:#aaa;font-weight:600}

        .plans-wrap{background:#080812;padding:90px 0 90px;position:relative;z-index:1}
        .plans-header{padding:0 20px;text-align:center;margin-bottom:32px}
        .plans-header h2{font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:clamp(28px,6vw,52px);font-weight:400;margin-bottom:10px;letter-spacing:1px}
        .plans-header h2 span{color:#ffd700}
        .toggle-wrap{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:32px}
        .toggle-label{font-size:13px;font-weight:600}
        .toggle-label.active{color:#fff}.toggle-label.inactive{color:#444}
        .toggle-btn{position:relative;width:52px;height:28px;border-radius:999px;background:#1e1e2e;border:1px solid #2e2e4e;cursor:pointer;transition:background .3s;flex-shrink:0}
        .toggle-btn.anual{background:#ffd700}
        .toggle-dot{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transition:transform .3s cubic-bezier(.4,0,.2,1)}
        .toggle-btn.anual .toggle-dot{transform:translateX(24px)}
        .toggle-save{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:#22c55e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px}
        .plans-carousel{display:flex;gap:16px;overflow-x:auto;padding:16px 24px 32px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
        .plans-carousel::-webkit-scrollbar{display:none}
        .plan-glass{scroll-snap-align:center;flex:0 0 min(280px,78vw);position:relative;border-radius:22px;padding:28px 22px;display:flex;flex-direction:column;background:rgba(255,255,255,.04);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.08);transition:border-color .3s,box-shadow .3s;will-change:transform}
        .plan-glass.vip{border-color:rgba(220,38,38,.3);box-shadow:0 0 30px rgba(220,38,38,.07)}
        .plan-glass.elite{border-color:rgba(147,51,234,.3);box-shadow:0 0 30px rgba(147,51,234,.07)}
        .plan-badge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:9px;font-weight:900;padding:4px 14px;border-radius:999px;white-space:nowrap;letter-spacing:1px}
        .b-vip{background:#dc2626;color:#fff}.b-elite{background:#7c3aed;color:#fff}
        .plan-emoji{font-size:28px;margin-bottom:10px}
        .plan-name{font-family:var(--font-bebas),'Bebas Neue',sans-serif;font-size:22px;font-weight:400;margin-bottom:4px;letter-spacing:.5px}
        .plan-price{font-size:34px;font-weight:900;color:#ffd700;transition:all .4s ease}
        .plan-period{font-size:12px;color:#444}
        .plan-economy{font-size:11px;color:#22c55e;margin:4px 0 16px;min-height:16px}
        .plan-items{list-style:none;flex:1;margin-bottom:20px;display:flex;flex-direction:column;gap:9px}
        .plan-items li{font-size:13px;color:#999;display:flex;align-items:flex-start;gap:8px;line-height:1.4}
        .plan-items li::before{content:'✓';color:#ffd700;font-weight:900;flex-shrink:0}
        .plan-btn{display:block;width:100%;text-align:center;padding:13px;border-radius:12px;font-weight:900;font-size:14px;text-decoration:none;transition:opacity .2s,transform .15s;cursor:pointer;border:none}
        .plan-btn:hover{opacity:.9;transform:translateY(-1px)}
        .plan-btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
        .btn-red{background:#dc2626;color:#fff}.btn-purple{background:#7c3aed;color:#fff}
        .carousel-hint{text-align:center;padding:0 20px}
        .carousel-hint p{font-size:11px;color:#2a2a3a}

        .footer{padding:50px 20px 110px;text-align:center;border-top:1px solid rgba(255,255,255,.04)}
        .footer img{width:44px;height:44px;border-radius:50%;opacity:.25;margin:0 auto 14px;display:block}
        .footer p{color:#2a2a3a;font-size:11px;margin-bottom:4px}
        .footer .quote{font-style:italic;color:#222}

        @media(min-width:768px){
          .plans-carousel{flex-wrap:wrap;overflow-x:visible;scroll-snap-type:none;justify-content:center;padding:16px 24px 32px}
          .plan-glass{flex:0 0 230px}
          .carousel-hint,.sticky-cta{display:none!important}
          .footer{padding-bottom:50px}
        }
        @media(max-width:767px){
          .benefits-grid,.personas-grid{grid-template-columns:1fr}
          .persona-glass img{height:220px}
          .section-angled,.section-angled-rev{clip-path:none}
        }
      `}</style>

      {/* ── GATE MODAL ─────────────────────────────────────────── */}
      {gateOpen && (
        <div className="gate-overlay">
          <div className="gate-bar" />
          <div className="gate-ticker">
            <div className="gate-ticker-label">⚠ URGENTE</div>
            <div className="gate-ticker-track">
              <div className="gate-ticker-text">
                CANAL SOB AMEAÇA · JÁ TENTARAM NOS TIRAR DO AR 3 VEZES · ACESSO PODE SER BLOQUEADO A QUALQUER MOMENTO · ENTRE ENQUANTO AINDA DÁ · CANAL SOB AMEAÇA · JÁ TENTARAM NOS TIRAR DO AR 3 VEZES · ACESSO PODE SER BLOQUEADO A QUALQUER MOMENTO ·&nbsp;
              </div>
            </div>
          </div>
          <div className="gate-inner">
            <div className="gate-live">
              <div className="gate-live-dot" />
              <span className="gate-live-text">Transmissão ao vivo</span>
            </div>
            <div className="gate-icon">⚠️</div>
            <div className="gate-warnings">
              <span className="gate-warn-line">Já derrubaram canal.</span>
              <span className="gate-warn-line">Já silenciaram perfil.</span>
              <span className="gate-warn-line">O WhatsApp é o próximo.</span>
            </div>
            <h2 className="gate-question">Você está vendo o que estão fazendo?</h2>
            <p className="gate-body">
              Globo esconde. STF blinda. Lula mente.<br />
              A TV faz de conta que tá tudo bem.
            </p>
            <p className="gate-bold">
              A maioria engoliu. Você não.<br />
              Seu lugar é aqui.
            </p>
            <p className="gate-urgency">
              Já tentaram nos tirar do ar 3 vezes.<br />Não sabemos quando vão conseguir.
            </p>
            <form onSubmit={handleGateSubmit}>
              <input
                className="gate-input"
                type="text"
                placeholder="Seu nome"
                value={gateNome}
                onChange={e => setGateNome(e.target.value)}
                required
              />
              <input
                className="gate-input"
                type="email"
                placeholder="Seu melhor e-mail"
                value={gateEmail}
                onChange={e => setGateEmail(e.target.value)}
                required
              />
              <input
                className="gate-input"
                type="tel"
                placeholder="WhatsApp com DDD"
                value={gateTelefone}
                onChange={e => setGateTelefone(e.target.value)}
                required
              />
              {gateErro && <p className="gate-erro">{gateErro}</p>}
              <button type="submit" className="gate-btn" disabled={gateLoading}>
                {gateLoading ? "Aguarde..." : "🇧🇷 ENTRAR ANTES QUE CENSUREM AQUI TAMBÉM"}
              </button>
            </form>
            <button className="gate-skip" onClick={() => setGateOpen(false)}>
              já sou membro →
            </button>
          </div>
        </div>
      )}

      {/* PROGRESS BAR */}
      <div className="progress-bar" style={{ width: `${progress}%` }} />

      {/* STICKY CTA */}
      <div className={`sticky-cta${stickyVisible ? " show" : ""}`}>
        <a href="#planos">📲 Começar 7 dias grátis</a>
        <p>Experimente grátis por 7 dias · Cancele quando quiser</p>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="hero" ref={heroRef}>
        <img src="/hero-bg.png" alt="" className="hero-bg" aria-hidden="true" />
        <div className="hero-overlay" />
        <div className="hero-content">
          <img src="/logo.png" alt="Alerta Patriota" className="logo-circle anim-1" />
          <span className="hero-badge anim-2">🇧🇷 Sem filtro · Sem censura · Direto no WhatsApp</span>
          <h1 className="anim-3">
            O BRASIL QUE A MÍDIA ESCONDE —<br />
            <span className="gold-grad">VOCÊ DESCOBRE PRIMEIRO</span>
          </h1>
          <p className="hero-sub anim-4">
            Notícias, análises e alertas urgentes sobre política e economia — com comentário direto do Capitão Braga, todo dia, no seu WhatsApp.
          </p>
          <a href="#planos" className="cta-main anim-5">📲 Começar 7 dias grátis</a>
          <p className="cta-note anim-5">Primeiros 7 dias completamente grátis — depois escolhe se quer continuar · Sem fidelidade</p>
          <div className="social-proof anim-5">
            {[{ num:"5.400+", label:"Patriotas ativos" }, { num:"3x/dia", label:"Notícias no WPP" }, { num:"2 grupos", label:"Exclusivos" }].map((p,i)=>(
              <div key={i} className="proof-item">
                <span className="proof-num">{p.num}</span>
                <span className="proof-label">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* URGENCY */}
      <div className="urgency">
        <p>⚠️ A Globo, o UOL e o G1 escolhem <strong>o que você pode saber</strong>. O Alerta Patriota mostra <strong>o que eles escondem</strong>.</p>
      </div>

      {/* ── BENEFÍCIOS ───────────────────────────────────────────── */}
      <section className="benefits section-angled">
        <p className="section-label reveal">Por que assinar</p>
        <h2 className="section-title reveal">
          Enquanto a mídia <span className="red">distorce e omite</span>,<br />
          você recebe a <span className="gold2">verdade sem filtro</span>
        </h2>
        <p className="section-sub reveal">Cada dia que passa, mais brasileiros percebem que os grandes veículos têm um lado. Aqui você recebe o que eles não querem que você veja.</p>
        <div className="benefits-grid">
          {[
            { cls:"gold2", glow:"gold", icon:"🚨", title:<><span className="ag">Você sabe primeiro.</span> Sempre.</>, desc:"Um discurso do Nikolas, uma votação polêmica no Congresso, uma decisão do STF — o alerta chega no seu WhatsApp em minutos, com análise real." },
            { cls:"red2",  glow:"red",  icon:"🎯", title:<>O que a <span className="ar">Globo não mostra</span> — você recebe</>, desc:"Votações que afetam sua família. Empresários que a mídia silencia. A agenda que aprovam enquanto ninguém está olhando." },
            { cls:"blue2", glow:"blue", icon:"📲", title:<>Simples assim: <span className="ab">chega no WhatsApp</span></>, desc:"Sem baixar app, sem criar conta, sem aprender nada novo. Chega no celular que você já usa — todo dia, na hora certa." },
          ].map((b,i)=>(
            <div key={i} className={`benefit-glass ${b.cls} reveal`}>
              <div className={`bg-glow ${b.glow}`} />
              <span className="b-icon">{b.icon}</span>
              <h3>{b.title}</h3>
              <p>{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PERSONAS ─────────────────────────────────────────────── */}
      <section className="personas-wrap">
        <p className="section-label reveal">Quem vai te guiar</p>
        <div className="personas-grid">
          <div className="persona-glass braga reveal">
            <img src="/capitao-braga.png" alt="Capitão Braga" />
            <div className="persona-body">
              <div className="persona-header">
                <span style={{fontSize:22}}>🎖️</span>
                <div>
                  <div className="persona-name pn-gold">Capitão Roberto Braga</div>
                  <div className="persona-role">Ex-militar · Evangélico · Patriota</div>
                </div>
              </div>
              <p className="persona-bio">32 anos de Exército. Saiu da farda indignado com o rumo do Brasil e criou o Alerta Patriota para falar o que ninguém tem coragem. Direto, sem rodeios — do jeito que o povo merece ser informado.</p>
              <p className="persona-quote pq-gold">"Deus, Pátria e Família — sempre."</p>
              <div className="persona-serves">Posta no grupo: <span>VIP</span></div>
            </div>
          </div>
          <div className="persona-glass cavalcanti reveal">
            <img src="/prof-cavalcanti.png" alt="Prof. Bernardo Cavalcanti" />
            <div className="persona-body">
              <div className="persona-header">
                <span style={{fontSize:22}}>🎓</span>
                <div>
                  <div className="persona-name pn-purple">Prof. Dr. Bernardo Cavalcanti</div>
                  <div className="persona-role">Ex-USP · Analista Global · Conservador</div>
                </div>
              </div>
              <p className="persona-bio">Ex-professor titular da USP. Consultor de governos em Washington e Buenos Aires. Acompanhou Milei, Trump e o avanço conservador global de perto. Traz o que o Brasil não vê — com profundidade real.</p>
              <p className="persona-quote pq-purple">"O mundo muda para quem enxerga antes."</p>
              <div className="persona-serves">Posta exclusivamente no: <span>Elite Global</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PLANOS ───────────────────────────────────────────────── */}
      <section className="plans-wrap section-angled-rev" id="planos">
        <div className="plans-header reveal">
          <h2>Escolha como quer ser <span>informado</span></h2>
          <div className="toggle-wrap">
            <span className={`toggle-label ${ciclo==="mensal"?"active":"inactive"}`}>Mensal</span>
            <div className={`toggle-btn${ciclo==="anual"?" anual":""}`} onClick={()=>setCiclo(c=>c==="mensal"?"anual":"mensal")} role="button" tabIndex={0}>
              <div className="toggle-dot" />
            </div>
            <span className={`toggle-label ${ciclo==="anual"?"active":"inactive"}`}>Anual</span>
            {ciclo==="anual" && <span className="toggle-save">2 meses grátis</span>}
          </div>
        </div>
        <div className="plans-carousel">
          {PLANOS.map(p => (
            <div key={p.id} className={`plan-glass ${p.cls} reveal`} onMouseMove={handleTilt} onMouseLeave={resetTilt}>
              {p.badge && <div className={`plan-badge ${p.badgeCls}`}>{p.badge}</div>}
              <div className="plan-emoji">{p.emoji}</div>
              <div className="plan-name">{p.nome}</div>
              <div>
                <span className="plan-price">R${ciclo==="anual" ? p.precoAnual : p.precoMensal}</span>
                <span className="plan-period">{ciclo==="anual" ? "/ano" : "/mês"}</span>
              </div>
              <div className="plan-economy">
                {ciclo==="anual" ? `▸ Equivale a R$${p.mesesAnual}/mês` : "▸ 7 dias grátis antes de ser cobrado"}
              </div>
              <ul className="plan-items">
                {p.items.map((item,i)=><li key={i}>{item}</li>)}
              </ul>
              <button
                onClick={() => handleCheckout(p.id)}
                className={`plan-btn ${p.btn}`}
                disabled={checkoutLoading === p.id}
              >
                {checkoutLoading === p.id ? "Aguarde..." : ciclo === "anual" ? "Assinar plano anual" : p.btnTxt}
              </button>
            </div>
          ))}
        </div>
        <div className="carousel-hint"><p>← Deslize para ver todos os planos →</p></div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="footer">
        <img src="/logo.png" alt="Alerta Patriota" />
        <p>© 2026 Alerta Patriota · Pagamento seguro via Mercado Pago</p>
        <p className="quote">"Deus, Pátria e Família — sempre." — Capitão Braga</p>
      </footer>
    </>
  );
}
