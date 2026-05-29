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
    id: 56,
    titulo: "Overnight Oatmeal de Maçã e Canela",
    slug: "overnight-oatmeal-de-maca-e-canela",
    prompt: "Overnight oats in glass jar, cold soaked oats with apple slices and cinnamon on top, chia seeds, layered breakfast jar, NO eggs, no heat, refrigerator-style presentation",
  },
  {
    id: 48,
    titulo: "Overnight Oatmeal com Iogurte Grego e Banana",
    slug: "overnight-oatmeal-com-iogurte-grego-e-banana",
    prompt: "Overnight oats layered in glass jar with Greek yogurt and banana slices on top, chia seeds, cold breakfast jar, NO eggs, spoon beside jar, natural morning light",
  },
  {
    id: 300,
    titulo: "Overnight Oats com Manga e Chia",
    slug: "overnight-oats-com-manga-e-chia",
    prompt: "Overnight oats in glass jar topped with fresh mango chunks and chia seeds, tropical colors, cold soaked oats, NO eggs, overhead shot",
  },
  {
    id: 53,
    titulo: "Mingau de Banana com Aveia e Baunilha",
    slug: "mingau-de-banana-com-aveia-e-baunilha",
    prompt: "Warm oat porridge mingau in ceramic bowl with sliced banana on top, creamy texture, vanilla aroma implied by cinnamon dusting, NO eggs, cozy breakfast bowl, overhead shot",
  },
  {
    id: 289,
    titulo: "Mingau de Aveia e Chia",
    slug: "mingau-de-aveia-e-chia",
    prompt: "Warm oat porridge in ceramic bowl topped with chia seeds and honey drizzle, creamy beige texture, NO eggs, simple breakfast bowl, natural light overhead",
  },
  {
    id: 290,
    titulo: "Mingau de Aveia com Chia, Coco e Amêndoas",
    slug: "mingau-de-aveia-com-chia-coco-e-amendoas",
    prompt: "Warm oat porridge bowl topped with chia seeds, shredded coconut flakes and sliced almonds, creamy texture, NO eggs, rustic wooden table, overhead shot",
  },
  {
    id: 45,
    titulo: "Bolo de Caneca Fit com Cacau e Banana",
    slug: "bolo-de-caneca-fit-com-cacau-e-banana",
    prompt: "Single-serve chocolate banana mug cake in a white ceramic mug, fluffy dark cocoa cake visible at top of mug, banana slice on top, served on wooden saucer, close-up shot",
  },
  {
    id: 420,
    titulo: "Bolo de Caneca Fit de Cacau",
    slug: "bolo-de-caneca-fit-de-cacau",
    prompt: "Single-serve chocolate mug cake in a white ceramic mug, fluffy dark cocoa cake rising from mug, dusting of cocoa powder on top, rustic wooden table, close-up food photography",
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
