/**
 * Gerador de cards visuais — Alerta Patriota
 * Renderiza via @vercel/og (Satori), sem Puppeteer/Chromium — compatível com serverless da Vercel.
 * Dois estilos fiéis às referências aprovadas pelo usuário.
 */
import * as fs from "fs";
import * as path from "path";
import type { Plano } from "@/lib/db";

const DIR = () => path.join(process.cwd(), "public", "personas");
const FONT_DIR = () => path.join(process.cwd(), "public", "fonts");

function b64(nome: string): string {
  const p = path.join(DIR(), nome);
  if (!fs.existsSync(p)) return "";
  return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
}

function pick(fotos: string[]): string {
  return fotos[new Date().getDate() % fotos.length];
}

// Fotos disponíveis nas pastas de persona — todas usadas em rotação diária
const FOTOS_BRAGA = [
  "braga-01.png", "braga-02.png", "braga-03.png", "braga-04.png", "braga-05.png",
  "braga-06.png", "braga-07.png", "braga-08.png", "braga-09.png",
  "braga-mesa.png", "braga-microfone.png",
];
const FOTOS_CAVA = [
  "cavalcanti-01.png", "cavalcanti-02.png", "cavalcanti-03.png", "cavalcanti-04.png",
  "cavalcanti-05.png", "cavalcanti-06.png", "cavalcanti-07.png", "cavalcanti-08.png",
  "cavalcanti-09.png", "cavalcanti-capitolio.png", "cavalcanti-londres.png",
  "cavalcanti-microfone.png", "cavalcanti-parlamento.png", "cavalcanti-perfil.png",
];

// ─── FONTES (carregadas uma vez, embutidas no ImageResponse) ──────────────────
let fontsCache: { name: string; data: Buffer; weight: 400 | 700 | 800 | 900; style: "normal" }[] | null = null;

export function getCardFonts() {
  if (fontsCache) return fontsCache;
  const dir = FONT_DIR();
  fontsCache = [
    { name: "Bebas Neue", data: fs.readFileSync(path.join(dir, "bebasneue-400.ttf")), weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: fs.readFileSync(path.join(dir, "inter-400.ttf")), weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: fs.readFileSync(path.join(dir, "inter-700.ttf")), weight: 700 as const, style: "normal" as const },
    { name: "Inter", data: fs.readFileSync(path.join(dir, "inter-800.ttf")), weight: 800 as const, style: "normal" as const },
    { name: "Inter", data: fs.readFileSync(path.join(dir, "inter-900.ttf")), weight: 900 as const, style: "normal" as const },
  ];
  return fontsCache;
}

// ═══════════════════════════════════════════════════════════
// ESTILO CAPITÃO BRAGA
// ═══════════════════════════════════════════════════════════
function CardBraga(p: {
  foto: string; logo: string; label1: string; label2: string;
  hookTitulo: string; headline: string; corpo: string;
  acento: string; barraTexto: string;
  nome: string; cargo: string; urgente?: boolean;
}) {
  const hl = p.headline.length;
  const headlineSize = hl > 70 ? 22 : hl > 55 ? 25 : hl > 40 ? 27 : 30;

  return (
    <div style={{ width: 1080, height: 1080, display: "flex", flexDirection: "column", background: "#000", fontFamily: "Inter" }}>
      {/* FOTO */}
      <div style={{ flex: 1, display: "flex", position: "relative", backgroundImage: `url(${p.foto})`, backgroundSize: "cover", backgroundPosition: "center top" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 90, display: "flex", backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))" }} />
        <div style={{ position: "absolute", top: 24, left: 32, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: "#ffd700", letterSpacing: 2, textTransform: "uppercase" }}>{p.label1}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", letterSpacing: 1.5, marginTop: 5 }}>{p.label2}</span>
        </div>
        {p.logo ? (
          <div style={{ position: "absolute", top: 20, right: 28, display: "flex" }}>
            <img src={p.logo} width={42} height={42} style={{ borderRadius: 21, border: "2px solid #ffd700" }} />
          </div>
        ) : null}
      </div>

      {/* CARD BRANCO */}
      <div style={{ background: "#fff", borderRadius: "22px 22px 0 0", boxShadow: "0 -5px 20px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 34px 14px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ width: 36, height: 36, background: "#c0392b", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#fff" }}>
              {p.urgente ? "🚨" : "⚠"}
            </div>
            <span style={{ fontFamily: "Bebas Neue", fontSize: 44, fontWeight: 400, color: p.urgente ? "#c0392b" : "#111", letterSpacing: 2 }}>{p.hookTitulo}</span>
          </div>
          <div style={{ fontSize: headlineSize, fontWeight: 800, color: "#111", lineHeight: 1.22, marginBottom: 7, display: "flex" }}>{p.headline}</div>
          <div style={{ fontSize: 17, color: "#666", lineHeight: 1.45, marginBottom: 9, display: "flex" }}>{p.corpo}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#c0392b", lineHeight: 1.3, display: "flex" }}>{p.acento}</div>
        </div>
        <div style={{ background: "#1a5c2e", padding: "14px 34px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase" }}>{p.barraTexto}</span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{p.nome}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: 0.5, marginTop: 1 }}>{p.cargo}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ESTILO PROF. BERNARDO CAVALCANTI
// ═══════════════════════════════════════════════════════════
function CardCavalcanti(p: { foto: string; logo: string; headline: string; corpo: string; urgente?: boolean }) {
  const hl = p.headline.length;
  const headlineSize = hl > 70 ? 26 : hl > 55 ? 29 : hl > 40 ? 32 : 35;

  return (
    <div style={{ width: 1080, height: 1080, display: "flex", flexDirection: "column", background: "#07071a", fontFamily: "Inter" }}>
      {/* FOTO (overlay escuro no lugar do filter:brightness, não suportado pelo Satori) */}
      <div style={{ flex: 1, display: "flex", position: "relative", backgroundImage: `url(${p.foto})`, backgroundSize: "cover", backgroundPosition: "center top" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", background: "rgba(0,0,0,0.15)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 90, display: "flex", backgroundImage: "linear-gradient(to bottom, rgba(4,4,20,0.65), rgba(4,4,20,0))" }} />
        <div style={{ position: "absolute", top: 24, left: 32, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: "#a855f7", letterSpacing: 3, textTransform: "uppercase" }}>ANÁLISE EXCLUSIVA</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.65)", letterSpacing: 2, marginTop: 5 }}>ELITE GLOBAL</span>
        </div>
        {p.logo ? (
          <div style={{ position: "absolute", top: 20, right: 28, display: "flex" }}>
            <img src={p.logo} width={42} height={42} style={{ borderRadius: 21, border: "2px solid #a855f7" }} />
          </div>
        ) : null}
      </div>

      {/* CARD ESCURO */}
      <div style={{ background: "#07071a", borderRadius: "22px 22px 0 0", borderTop: "1px solid rgba(168,85,247,0.3)", boxShadow: "0 -5px 24px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 36px 14px", display: "flex", flexDirection: "column" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-start",
            background: p.urgente ? "#5b21b6" : "rgba(88,28,135,0.5)",
            border: `1px solid ${p.urgente ? "#7c3aed" : "rgba(168,85,247,0.4)"}`,
            color: "#c4b5fd", fontSize: 13, fontWeight: 800,
            padding: "6px 16px", borderRadius: 4, letterSpacing: 2, textTransform: "uppercase", marginBottom: 13,
          }}>
            <div style={{ width: 6, height: 6, background: "#a855f7", borderRadius: 3, display: "flex" }} />
            {p.urgente ? "ANÁLISE URGENTE" : "PERSPECTIVA GLOBAL"}
          </div>
          <div style={{ fontSize: headlineSize, fontWeight: 900, color: "#fff", lineHeight: 1.2, marginBottom: 10, letterSpacing: -0.3, display: "flex" }}>{p.headline}</div>
          <div style={{ fontSize: 17, color: "rgba(255,255,255,0.6)", lineHeight: 1.45, marginBottom: 14, display: "flex" }}>{p.corpo}</div>
          <div style={{ width: "100%", height: 1, display: "flex", marginBottom: 12, backgroundImage: "linear-gradient(to right, rgba(168,85,247,0.4), rgba(168,85,247,0))" }} />
          <div style={{ fontSize: 19, fontWeight: 900, color: "#c4b5fd", letterSpacing: 0.3, display: "flex" }}>PROF. DR. BERNARDO CAVALCANTI</div>
          <div style={{ fontSize: 12, color: "rgba(196,181,253,0.45)", letterSpacing: 1, marginTop: 3, display: "flex" }}>ANALISTA POLÍTICO GLOBAL · ELITE GLOBAL</div>
        </div>
        <div style={{ background: "rgba(88,28,135,0.55)", borderTop: "1px solid rgba(168,85,247,0.2)", padding: "13px 36px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#c4b5fd", letterSpacing: 2, textTransform: "uppercase" }}>O MUNDO MUDA PARA QUEM ENXERGA ANTES.</span>
          {p.logo ? (
            <div style={{ display: "flex" }}>
              <img src={p.logo} width={30} height={30} style={{ borderRadius: 15, border: "1.5px solid rgba(168,85,247,0.5)", opacity: 0.8 }} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL — substitui a antiga gerarHTMLCard()
// ═══════════════════════════════════════════════════════════
export function gerarCardElement(params: {
  plano: Plano; hook: string; corpo?: string;
  fonte: string; urgente?: boolean;
}) {
  const { plano, hook, corpo, urgente } = params;
  const logo = b64("logo.png");

  const fotoNome = plano === "elite" ? pick(FOTOS_CAVA) : pick(FOTOS_BRAGA);
  const fotoData = b64(fotoNome);

  if (plano === "elite") {
    return CardCavalcanti({
      foto: fotoData,
      logo,
      headline: hook,
      corpo: corpo || "Uma análise que vai além da superfície. Entenda o que realmente está em jogo no tabuleiro político.",
      urgente,
    });
  }

  return CardBraga({
    foto: fotoData,
    logo,
    label1: "ANÁLISE VIP",
    label2: "O QUE A MÍDIA ESCONDE",
    hookTitulo: urgente ? "URGENTE!" : "ATENÇÃO!",
    headline: hook,
    corpo: corpo || "Entenda o que está acontecendo e o que isso significa para o Brasil.",
    acento: urgente ? "Isso não pode ficar sem resposta!" : "Até quando vamos aceitar isso?",
    barraTexto: "DEUS, PÁTRIA E FAMÍLIA — SEMPRE.",
    nome: "CAPITÃO ROBERTO BRAGA",
    cargo: "COMENTARISTA DO ALERTA PATRIOTA",
    urgente,
  });
}
