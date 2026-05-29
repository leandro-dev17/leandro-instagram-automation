/**
 * fix-cirurgico.cjs
 * Corrige imagens específicas com prompts manuais ultraespecíficos.
 */

const https   = require("https");
const crypto  = require("crypto");
const { neon } = require("@neondatabase/serverless");

const DB_URL        = "postgresql://neondb_owner:npg_ietKBb8P2uxa@ep-floral-smoke-apslvj9w-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const CLOUD_NAME    = "demazkgy2";
const CLD_KEY       = "266416614247189";
const CLD_SECRET    = "SYmybuhU5M5LoGlhf9LCJUN3AcQ";
const STABILITY_KEY = process.env.STABILITY_API_KEY;
const sql = neon(DB_URL);

// ── Receitas a corrigir com prompts manuais ultraespecíficos ─────────────────
const FIXES = [
  {
    id: 222,
    titulo: "Espetinho de Frango com Pimentão e Cebola Grelhado",
    slug: "espetinho-de-frango-com-pimentao-e-cebola-grelhado",
    prompt: "Chicken skewers on metal skewers with alternating grilled red and green bell pepper chunks and white onion pieces, char grill marks, rustic wooden board, close-up food photography",
  },
  {
    id: 130,
    titulo: "Espetinho de Frango Grelhado",
    slug: "espetinho-de-frango-grelhado",
    prompt: "Grilled chicken skewers on metal skewers with char marks, juicy golden-brown chicken pieces, rustic wooden cutting board, parsley garnish, close-up food photography",
  },
  {
    id: 282,
    titulo: "Crepioca Fit",
    slug: "crepioca-fit",
    prompt: "Thin Brazilian tapioca crepe crepioca folded in half on white ceramic plate, lightly golden edges, slightly translucent center, simple minimalist presentation, natural light",
  },
  {
    id: 117,
    titulo: "Crepioca Fit (Ovo e Tapioca)",
    slug: "crepioca-fit-ovo-e-tapioca",
    prompt: "Brazilian tapioca egg crepe crepioca on plate, thin folded crepe made of tapioca starch and egg, golden edges, melted cheese filling visible, natural light",
  },
  {
    id: 280,
    titulo: "Panqueca Saudável de Aveia e Banana",
    slug: "panqueca-saudavel-de-aveia-e-banana",
    prompt: "Stack of three golden-brown oat banana pancakes on white plate, sliced banana coins arranged on top, light drizzle of honey, overhead view, natural morning light",
  },
  {
    id: 59,
    titulo: "Granola de Frigideira Rápida",
    slug: "granola-de-frigideira-rapida",
    prompt: "Crunchy homemade granola toasted in pan, oats clusters with honey glaze, mixed nuts and dried fruits, served in small white ceramic bowl, overhead shot, no eggs, no people",
  },
];

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(opts, body) {
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

// ── Stability AI ──────────────────────────────────────────────────────────────
async function gerarImagem(promptBase) {
  const prompt = `${promptBase}, professional food photography, rustic wooden table, natural soft window light, food magazine quality, no people no text no watermark no logo`;

  const body = JSON.stringify({
    text_prompts: [
      { text: prompt, weight: 1 },
      { text: "person, human, text, watermark, logo, nsfw, cartoon, illustration, blurry, wrong food", weight: -1 },
    ],
    cfg_scale: 9, height: 1024, width: 1024, samples: 1, steps: 50, style_preset: "photographic",
  });

  const r = await request({
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
  return Buffer.from(JSON.parse(r.buffer.toString()).artifacts[0].base64, "base64");
}

// ── Cloudinary upload ─────────────────────────────────────────────────────────
async function uploadCld(buf, slug) {
  const ts  = Math.floor(Date.now() / 1000).toString();
  const pid = `vovo-teresinha/receitas/${slug}`;
  const sig = crypto.createHash("sha1").update(`public_id=${pid}&timestamp=${ts}${CLD_SECRET}`).digest("hex");
  const bd  = `----CldB${Date.now()}`;
  const parts = [
    `--${bd}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${CLD_KEY}\r\n`,
    `--${bd}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${ts}\r\n`,
    `--${bd}\r\nContent-Disposition: form-data; name="public_id"\r\n\r\n${pid}\r\n`,
    `--${bd}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${sig}\r\n`,
  ];
  const full = Buffer.concat([
    Buffer.from(parts.join("")),
    Buffer.from(`--${bd}\r\nContent-Disposition: form-data; name="file"; filename="${slug}.png"\r\nContent-Type: image/png\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${bd}--\r\n`),
  ]);
  const r = await request({
    hostname: "api.cloudinary.com",
    path: `/v1_1/${CLOUD_NAME}/image/upload`,
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${bd}`, "Content-Length": full.length },
  }, full);
  const json = JSON.parse(r.buffer.toString());
  if (!json.secure_url) throw new Error("CLD sem URL: " + JSON.stringify(json).slice(0, 200));
  return json.secure_url;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🎯 Corrigindo ${FIXES.length} receitas com prompts cirúrgicos\n`);

  for (const fix of FIXES) {
    process.stdout.write(`ID ${fix.id} "${fix.titulo}"...\n  Prompt: "${fix.prompt.slice(0, 80)}..."\n  Gerando...`);
    try {
      const img = await gerarImagem(fix.prompt);
      process.stdout.write(" upload...");
      const url = await uploadCld(img, fix.slug);
      await sql`UPDATE receitas SET foto_url = ${url} WHERE id = ${fix.id}`;
      process.stdout.write(` ✅\n  URL: ${url}\n\n`);
    } catch (e) {
      process.stdout.write(` ❌ ${e.message.slice(0, 80)}\n\n`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log("✅ Concluído!");
}

main().catch(console.error);
