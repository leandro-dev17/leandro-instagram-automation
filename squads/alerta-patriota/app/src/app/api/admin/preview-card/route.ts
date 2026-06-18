import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { requireAdmin } from "@/lib/auth";
import { gerarCardElement, getCardFonts } from "@/lib/card-generator";

const HOOKS: Record<string, string> = {
  vip:      "Governo quer censurar redes sociais sem ordem judicial",
  elite:    "O Judiciário como arena política: o que nenhum analista está dizendo",
};

const CORPOS: Record<string, string> = {
  vip:      "Medida ameaça a liberdade de expressão e o direito à informação dos brasileiros.",
  elite:    "O padrão se repete em democracias em crise de legitimidade. Trump, Milei e Orbán passaram pelo mesmo processo — a resposta que funcionou nunca foi o silêncio.",
};

export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return new NextResponse("Acesso negado", { status: 403 }); }

  const { searchParams } = new URL(req.url);
  const plano   = (searchParams.get("plano") || "elite") as "vip"|"elite";
  const urgente = searchParams.get("urgente") === "1";
  const hook    = searchParams.get("hook")  || HOOKS[plano];
  const corpo   = searchParams.get("corpo") || CORPOS[plano];
  const fonte   = searchParams.get("fonte") || "Revista Oeste";

  const element = gerarCardElement({ plano, hook, corpo, fonte, urgente });
  const imagem = new ImageResponse(element, { width: 1080, height: 1080, fonts: getCardFonts() });
  const pngBase64 = Buffer.from(await imagem.arrayBuffer()).toString("base64");

  const preview = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Preview — ${plano}</title>
<style>
  body { margin:0; background:#08080f; display:flex; flex-direction:column; align-items:center; padding:24px 16px 60px; font-family:sans-serif; gap:16px; }
  h2 { color:#ffd700; font-size:13px; letter-spacing:3px; text-transform:uppercase; margin:0; }
  .nav { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
  .nav a { padding:8px 18px; border-radius:999px; font-size:13px; font-weight:700; text-decoration:none; border:1px solid; }
  .vip      { background:${plano==="vip"     ?"rgba(220,38,38,.15)":"transparent"}; color:#ef4444; border-color:#ef4444; }
  .elite    { background:${plano==="elite"   ?"rgba(168,85,247,.15)":"transparent"}; color:#a855f7; border-color:#a855f7; }
  .urgente-btn { background:rgba(220,38,38,.15); color:#ef4444; border-color:#ef4444; }
  .frame { width:540px; height:540px; border-radius:12px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.8); flex-shrink:0; }
  .frame img { width:1080px; height:1080px; transform:scale(0.5); transform-origin:top left; display:block; }
  .info { color:#444; font-size:12px; text-align:center; }
</style>
</head>
<body>
  <h2>Preview Card — ${plano.toUpperCase()}</h2>
  <div class="nav">
    <a href="?plano=vip"       class="vip">🔥 VIP</a>
    <a href="?plano=elite"     class="elite">🎖️ Elite</a>
    <a href="?plano=${plano}&urgente=1" class="urgente-btn">🚨 Urgente</a>
  </div>
  <div class="frame">
    <img src="data:image/png;base64,${pngBase64}" alt="Card ${plano}" />
  </div>
  <p class="info">Card real: 1080×1080px · Renderizado via @vercel/og · Esta visualização está em 50%</p>
</body>
</html>`;

  return new NextResponse(preview, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
