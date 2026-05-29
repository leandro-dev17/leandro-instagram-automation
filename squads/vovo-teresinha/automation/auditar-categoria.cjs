/**
 * auditar-categoria.cjs
 * Audita e corrige imagens de uma categoria específica usando Claude Vision + Stability AI.
 * Uso: node auditar-categoria.cjs cafe_manha
 */

const Anthropic = require("@anthropic-ai/sdk");
const https     = require("https");
const http      = require("http");
const crypto    = require("crypto");
const { neon }  = require("@neondatabase/serverless");

const CATEGORIA     = process.argv[2] || "cafe_manha";
const DB_URL        = "postgresql://neondb_owner:npg_ietKBb8P2uxa@ep-floral-smoke-apslvj9w-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const CLOUD_NAME    = "demazkgy2";
const CLD_KEY       = "266416614247189";
const CLD_SECRET    = "SYmybuhU5M5LoGlhf9LCJUN3AcQ";
const STABILITY_KEY = process.env.STABILITY_API_KEY;

const sql    = neon(DB_URL);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── HTTP helper ───────────────────────────────────────────────────────────────
function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      const c = []; res.on("data", d => c.push(d));
      res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(c) }));
      res.on("error", reject);
    });
    r.on("error", reject);
    if (body) r.write(body); r.end();
  });
}

async function download(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 15000 }, (res) => {
      if ([301,302].includes(res.statusCode)) return download(res.headers.location).then(resolve).catch(reject);
      const c = []; res.on("data", d => c.push(d));
      res.on("end", () => resolve(Buffer.concat(c)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ── Claude Vision: verificar se imagem bate com receita ──────────────────────
async function verificarLote(receitas) {
  const content = [];
  const validas = [];

  for (const r of receitas) {
    try {
      const b64 = (await download(r.foto_url)).toString("base64");
      const mt  = r.foto_url.includes(".png") ? "image/png" : "image/jpeg";
      content.push({ type: "image", source: { type: "base64", media_type: mt, data: b64 } });
      content.push({ type: "text", text: `ID ${r.id}: "${r.titulo}"` });
      validas.push(r);
    } catch { /* pular se não baixar */ }
  }

  if (!validas.length) return [];

  content.push({
    type: "text",
    text: `Para cada par imagem+receita, responda SOMENTE JSON:
[{"id":123,"ok":true/false,"descricao":"o que a imagem mostra em 1 frase curta","motivo":"por que não bate (se ok=false)"}]
ok=false somente se a imagem mostra claramente um ALIMENTO DIFERENTE do nome da receita.
Seja criterioso mas justo — variações visuais de apresentação são aceitáveis.`,
  });

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content }],
  });

  const m = resp.content[0].text.match(/\[[\s\S]*\]/);
  try { return m ? JSON.parse(m[0]) : []; } catch { return []; }
}

// ── Stability AI: gerar imagem correta ───────────────────────────────────────
async function gerarImagem(titulo) {
  const prompt = [
    `Authentic Brazilian breakfast food photography of "${titulo}"`,
    "simple homemade style",
    "natural daylight on a wooden breakfast table",
    "warm cozy atmosphere",
    "visible ingredients and textures",
    "rustic Brazilian home kitchen aesthetic",
    "food magazine quality",
    "overhead or 45 degree angle shot",
    "no people no text no watermark",
  ].join(", ");

  const body = JSON.stringify({
    text_prompts: [
      { text: prompt, weight: 1 },
      { text: "person, human, text, watermark, logo, nsfw, cartoon, illustration, surreal", weight: -1 },
    ],
    cfg_scale: 7, height: 1024, width: 1024, samples: 1, steps: 40, style_preset: "photographic",
  });

  const r = await req({
    hostname: "api.stability.ai",
    path: "/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
    method: "POST",
    headers: {
      Authorization: `Bearer ${STABILITY_KEY}`,
      "Content-Type": "application/json", Accept: "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  }, body);

  if (r.status !== 200) throw new Error(`Stability ${r.status}: ${r.buffer.toString().slice(0, 200)}`);
  const json = JSON.parse(r.buffer.toString());
  return Buffer.from(json.artifacts[0].base64, "base64");
}

// ── Cloudinary upload ─────────────────────────────────────────────────────────
async function uploadCld(buf, slug) {
  const ts  = Math.floor(Date.now() / 1000).toString();
  const pid = `vovo-teresinha/receitas/${slug}`;
  const sig = crypto.createHash("sha1").update(`public_id=${pid}&timestamp=${ts}${CLD_SECRET}`).digest("hex");
  const bd  = `----CldB${Date.now()}`;
  const p   = [`--${bd}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${CLD_KEY}\r\n`,
               `--${bd}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${ts}\r\n`,
               `--${bd}\r\nContent-Disposition: form-data; name="public_id"\r\n\r\n${pid}\r\n`,
               `--${bd}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${sig}\r\n`];
  const full = Buffer.concat([
    Buffer.from(p.join("")),
    Buffer.from(`--${bd}\r\nContent-Disposition: form-data; name="file"; filename="${slug}.png"\r\nContent-Type: image/png\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${bd}--\r\n`),
  ]);
  const r = await req({ hostname: "api.cloudinary.com", path: `/v1_1/${CLOUD_NAME}/image/upload`, method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${bd}`, "Content-Length": full.length } }, full);
  const json = JSON.parse(r.buffer.toString());
  if (!json.secure_url) throw new Error("CLD sem URL: " + JSON.stringify(json).slice(0,200));
  return json.secure_url;
}

function slugify(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rows = await sql`SELECT id, titulo, foto_url FROM receitas WHERE categoria = ${CATEGORIA} AND is_personal = false AND foto_url IS NOT NULL ORDER BY id`;
  console.log(`\n🔍 ${rows.length} receitas em "${CATEGORIA}" para auditar\n`);

  const erradas = [];
  const LOTE = 5;

  for (let i = 0; i < rows.length; i += LOTE) {
    const lote = rows.slice(i, i + LOTE);
    process.stdout.write(`  Auditando ${i+1}-${Math.min(i+LOTE, rows.length)}/${rows.length}...`);
    try {
      const res = await verificarLote(lote);
      const bad = res.filter(r => !r.ok);
      bad.forEach(b => {
        const rec = lote.find(r => r.id === b.id);
        if (rec) erradas.push({ ...rec, descricao: b.descricao, motivo: b.motivo });
      });
      process.stdout.write(` ${bad.length} problemas\n`);
    } catch(e) { process.stdout.write(` erro: ${e.message.slice(0,50)}\n`); }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`❌ Imagens erradas encontradas: ${erradas.length}`);
  erradas.forEach(r => console.log(`  ID ${r.id}: "${r.titulo}"\n    Imagem mostra: ${r.descricao}\n    Motivo: ${r.motivo}`));

  if (!erradas.length) { console.log("\n✅ Todas as imagens estão corretas!"); return; }

  console.log(`\n🎨 Regenerando ${erradas.length} imagens com Stability AI...\n`);
  let corrigidas = 0;

  for (const r of erradas) {
    process.stdout.write(`  ID ${r.id} "${r.titulo.slice(0,45)}"... gerando...`);
    try {
      const img = await gerarImagem(r.titulo);
      process.stdout.write(" upload...");
      const url = await uploadCld(img, slugify(r.titulo));
      await sql`UPDATE receitas SET foto_url = ${url} WHERE id = ${r.id}`;
      process.stdout.write(" ✅\n");
      corrigidas++;
    } catch(e) { process.stdout.write(` ❌ ${e.message.slice(0,60)}\n`); }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n✅ Corrigidas: ${corrigidas}/${erradas.length}`);
}

main().catch(console.error);
