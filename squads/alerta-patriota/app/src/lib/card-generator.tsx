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

// FASE 25: pick() usava new Date().getDate() — todos os posts do mesmo dia
// caíam na mesma foto, só mudando no dia seguinte. Agora a foto é escolhida
// por um seed único por notícia (o próprio id da linha em `noticias`), então
// cada card publicado varia mesmo que sejam vários no mesmo dia.
function pick(fotos: string[], seed: number): string {
  return fotos[((seed % fotos.length) + fotos.length) % fotos.length];
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
  hookTitulo: string; headline: string; urgente?: boolean;
}) {
  const hl = p.headline.length;
  // FASE 24b: menos texto na imagem (selo + 1 hook só) sobrevive melhor à
  // compressão do WhatsApp — fonte bem maior já que corpo/rodapé saíram.
  const headlineSize = hl > 90 ? 32 : hl > 70 ? 38 : hl > 50 ? 44 : 50;

  return (
    <div style={{ width: 1080, height: 1080, display: "flex", flexDirection: "column", background: "#000", fontFamily: "Inter" }}>
      {/* FOTO */}
      <div style={{ flex: 1, display: "flex", position: "relative", backgroundImage: `url(${p.foto})`, backgroundSize: "cover", backgroundPosition: "center top" }}>
        {/* FASE 25c: medição com grade pixel a pixel sobre a referência — altura de letra
            real de "ANÁLISE VIP" = 40px de caixa-alta (fontSize≈54); largura da faixa é
            consequência do texto, não um valor fixo. */}
        <div style={{ position: "absolute", top: 52, left: 0, display: "flex", alignItems: "center", height: 73, background: "#e6b018", padding: "0 34px 0 30px" }}>
          <span style={{ fontSize: 54, fontWeight: 900, color: "#15110a", letterSpacing: 1, textTransform: "uppercase", display: "flex" }}>{p.label1}</span>
        </div>
        {/* "O QUE A MÍDIA ESCONDE" medido: caixa-alta com 20-21px de altura → fontSize≈28 (era 18, por isso ficou pequeno) */}
        <div style={{ position: "absolute", top: 128, left: 30, display: "flex" }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: 1, textTransform: "uppercase" }}>{p.label2}</span>
        </div>
        {/* FASE 25c: logo medida com grade — diâmetro real ≈350px, margem topo≈34, direita≈30;
            recorte circular obrigatório pois logo.png não tem alpha (fundo quadrado preto) */}
        {p.logo ? (
          <div style={{ position: "absolute", top: 34, right: 30, display: "flex" }}>
            <img src={p.logo} width={350} height={350} style={{ borderRadius: "50%" }} />
          </div>
        ) : null}
      </div>

      {/* CARD BRANCO — só selo + hook */}
      <div style={{ background: "#fff", borderRadius: "22px 22px 0 0", boxShadow: "0 -5px 20px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", padding: "30px 36px 32px" }}>
        {/* FASE 25c: selo "URGENTE!"/"ATENÇÃO!" medido: caixa-alta com 32px de altura → fontSize≈44 (era 32) */}
        <div style={{ display: "flex", alignSelf: "flex-start", marginBottom: 18 }}>
          <span style={{ fontSize: 44, fontWeight: 900, color: "#dc2626", letterSpacing: 1, textTransform: "uppercase", display: "flex" }}>
            {`${p.urgente ? "🚨" : "⚠️"} ${p.hookTitulo} ${p.urgente ? "🚨" : "⚠️"}`}
          </span>
        </div>
        <div style={{ fontSize: headlineSize, fontWeight: 800, color: "#111", lineHeight: 1.18, display: "flex" }}>{p.headline}</div>
      </div>
      {/* FASE 25: faixa dourada inferior — só no card VIP, conforme referência */}
      <div style={{ display: "flex", height: 14, background: "#e3b315" }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ESTILO PROF. BERNARDO CAVALCANTI
// ═══════════════════════════════════════════════════════════
function CardCavalcanti(p: { foto: string; logo: string; headline: string; urgente?: boolean }) {
  const hl = p.headline.length;
  // FASE 24b: menos texto na imagem (selo + 1 hook só) sobrevive melhor à
  // compressão do WhatsApp — fonte bem maior já que corpo/nome/rodapé saíram.
  const headlineSize = hl > 90 ? 34 : hl > 70 ? 40 : hl > 50 ? 46 : 52;

  return (
    <div style={{ width: 1080, height: 1080, display: "flex", flexDirection: "column", background: "#07071a", fontFamily: "Inter" }}>
      {/* FOTO (overlay escuro no lugar do filter:brightness, não suportado pelo Satori) */}
      <div style={{ flex: 1, display: "flex", position: "relative", backgroundImage: `url(${p.foto})`, backgroundSize: "cover", backgroundPosition: "center top" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", background: "rgba(0,0,0,0.15)" }} />
        {/* FASE 25c: "ANÁLISE EXCLUSIVA" medido: caixa-alta com 38px de altura → fontSize≈50 (era 32) */}
        <div style={{ position: "absolute", top: 48, left: 0, display: "flex", alignItems: "center", height: 73, background: "#6e2fd6", padding: "0 34px 0 30px" }}>
          <span style={{ fontSize: 50, fontWeight: 900, color: "#fff", letterSpacing: 1, textTransform: "uppercase", display: "flex" }}>ANÁLISE EXCLUSIVA</span>
        </div>
        {/* "ELITE GLOBAL" medido: caixa-alta com 20px de altura → fontSize≈28 (era 17) */}
        <div style={{ position: "absolute", top: 124, left: 30, display: "flex" }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase" }}>ELITE GLOBAL</span>
        </div>
        {/* FASE 25c: mesma logo medida do CardBraga (asset/posição idênticos nas 2 referências) */}
        {p.logo ? (
          <div style={{ position: "absolute", top: 34, right: 30, display: "flex" }}>
            <img src={p.logo} width={350} height={350} style={{ borderRadius: "50%" }} />
          </div>
        ) : null}
      </div>

      {/* CARD ESCURO — só selo + hook */}
      <div style={{ background: "#07071a", borderRadius: "22px 22px 0 0", borderTop: "1px solid rgba(168,85,247,0.3)", boxShadow: "0 -5px 24px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", padding: "30px 36px 38px" }}>
        {/* FASE 25c: chip medido: caixa do selo tem 45px de altura e o texto 23px de caixa-alta
            → fontSize≈26 (era 15, por isso ficou minúsculo) */}
        <div style={{
          display: "flex", alignSelf: "flex-start",
          background: "#6e2fd6",
          color: "#fff", fontSize: 26, fontWeight: 800,
          padding: "6px 20px", borderRadius: 6, letterSpacing: 1, textTransform: "uppercase", marginBottom: 18,
        }}>
          {p.urgente ? "ANÁLISE URGENTE" : "PERSPECTIVA GLOBAL"}
        </div>
        <div style={{ fontSize: headlineSize, fontWeight: 900, color: "#fff", lineHeight: 1.16, letterSpacing: -0.3, display: "flex" }}>{p.headline}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL — substitui a antiga gerarHTMLCard()
// ═══════════════════════════════════════════════════════════
export function gerarCardElement(params: {
  plano: Plano; hook: string; corpo?: string;
  fonte: string; urgente?: boolean; noticiaId?: number;
}) {
  // FASE 24b: corpo/fonte não são mais desenhados na imagem (ver CardBraga/
  // CardCavalcanti) — a legenda da mensagem (gerarLegenda em cron/gerar-card)
  // já traz nome da persona, data e fonte como texto simples do WhatsApp.
  const { plano, hook, urgente, noticiaId } = params;
  const logo = b64("logo.png");

  // FASE 25: seed por notícia (id da linha) em vez de data — ver pick() acima.
  const seed = noticiaId ?? Date.now();
  const fotoNome = plano === "elite" ? pick(FOTOS_CAVA, seed) : pick(FOTOS_BRAGA, seed);
  const fotoData = b64(fotoNome);

  if (plano === "elite") {
    return CardCavalcanti({
      foto: fotoData,
      logo,
      headline: hook,
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
    urgente,
  });
}
