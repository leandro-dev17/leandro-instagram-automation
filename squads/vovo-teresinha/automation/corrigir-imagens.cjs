/**
 * corrigir-imagens.cjs
 * Gera imagens corretas com Stability AI (SDXL) para as 124 receitas com imagem errada,
 * faz upload ao Cloudinary e atualiza o banco Neon.
 * Não baixa nenhuma imagem da internet — tudo gerado por IA.
 */

const https   = require("https");
const crypto  = require("crypto");
const fs      = require("fs");
const path    = require("path");
const { neon } = require("@neondatabase/serverless");

// ── Credenciais ───────────────────────────────────────────────────────────────
const DB_URL         = "postgresql://neondb_owner:npg_ietKBb8P2uxa@ep-floral-smoke-apslvj9w-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const CLOUD_NAME     = "demazkgy2";
const CLD_API_KEY    = "266416614247189";
const CLD_API_SECRET = "SYmybuhU5M5LoGlhf9LCJUN3AcQ";
const STABILITY_KEY  = "sk-THgTWZjHtVXDbfooa4ira9dEjSTXH0KPC9vIuN5WdELELtGz";

const sql = neon(DB_URL);

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Prompt de comida fotorrealista ────────────────────────────────────────────
function buildPrompt(titulo) {
  return [
    `Professional food photography of "${titulo}"`,
    "Brazilian home cooking style",
    "overhead flat lay shot on rustic wooden table",
    "natural soft window light",
    "fresh ingredients visible",
    "vibrant colors",
    "appetizing",
    "food magazine quality",
    "shallow depth of field",
    "no text no watermark no logo no people"
  ].join(", ");
}

// ── Gerar imagem com Stability AI SDXL ───────────────────────────────────────
async function gerarImagem(titulo) {
  const prompt = buildPrompt(titulo);
  const negative = "person, human, face, body, text, watermark, logo, nsfw, cartoon, illustration, drawing";

  const body = JSON.stringify({
    text_prompts: [
      { text: prompt,   weight: 1 },
      { text: negative, weight: -1 },
    ],
    cfg_scale:    7,
    height:       1024,
    width:        1024,
    samples:      1,
    steps:        35,
    style_preset: "photographic",
  });

  const res = await request({
    hostname: "api.stability.ai",
    path:     "/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
    method:   "POST",
    headers: {
      Authorization:  `Bearer ${STABILITY_KEY}`,
      "Content-Type": "application/json",
      Accept:         "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  }, body);

  if (res.status !== 200) {
    throw new Error(`Stability AI ${res.status}: ${res.buffer.toString().slice(0, 200)}`);
  }

  const json = JSON.parse(res.buffer.toString());
  const artifact = json.artifacts?.[0];
  if (!artifact?.base64) throw new Error("Stability AI: sem artefato");
  return Buffer.from(artifact.base64, "base64");
}

// ── Upload Cloudinary ─────────────────────────────────────────────────────────
async function uploadCloudinary(imageBuffer, slug) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId  = `vovo-teresinha/receitas/${slug}`;
  const sigStr    = `public_id=${publicId}&timestamp=${timestamp}${CLD_API_SECRET}`;
  const signature = crypto.createHash("sha1").update(sigStr).digest("hex");

  const boundary = `----CldBound${Date.now()}`;
  const parts = [];
  const add = (k, v) => parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
  );
  add("api_key",   CLD_API_KEY);
  add("timestamp", timestamp);
  add("public_id", publicId);
  add("signature", signature);

  const head = Buffer.from(parts.join(""));
  const filePart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${slug}.png"\r\nContent-Type: image/png\r\n\r\n`),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const fullBody = Buffer.concat([head, filePart]);

  const res = await request({
    hostname: "api.cloudinary.com",
    path:     `/v1_1/${CLOUD_NAME}/image/upload`,
    method:   "POST",
    headers: {
      "Content-Type":   `multipart/form-data; boundary=${boundary}`,
      "Content-Length": fullBody.length,
    },
  }, fullBody);

  const json = JSON.parse(res.buffer.toString());
  if (!json.secure_url) throw new Error("Cloudinary sem URL: " + JSON.stringify(json).slice(0, 200));
  return json.secure_url;
}

function slugify(titulo) {
  return titulo.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const auditoria = JSON.parse(fs.readFileSync("auditoria-imagens.json", "utf8"));
  const flagadas  = auditoria.flagadas;
  console.log(`🎨 Gerando ${flagadas.length} imagens com Stability AI SDXL...\n`);

  const resultado = { corrigidas: [], erros: [] };

  for (let i = 0; i < flagadas.length; i++) {
    const r = flagadas[i];
    process.stdout.write(`[${i + 1}/${flagadas.length}] ID ${r.id} "${r.titulo.slice(0, 45)}"...`);

    try {
      // 1. Gerar imagem
      process.stdout.write(" 🎨 gerando...");
      const imgBuffer = await gerarImagem(r.titulo);

      // 2. Upload Cloudinary
      process.stdout.write(" ☁️ upload...");
      const slug = slugify(r.titulo);
      const novaUrl = await uploadCloudinary(imgBuffer, slug);

      // 3. Atualizar banco
      await sql`UPDATE receitas SET foto_url = ${novaUrl} WHERE id = ${r.id}`;
      process.stdout.write(` ✅\n`);
      resultado.corrigidas.push({ id: r.id, titulo: r.titulo, url: novaUrl });

    } catch (e) {
      process.stdout.write(` ❌ ${e.message.slice(0, 60)}\n`);
      resultado.erros.push({ id: r.id, titulo: r.titulo, erro: e.message });
    }

    // Pausa entre gerações para respeitar rate limit
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Corrigidas: ${resultado.corrigidas.length}`);
  console.log(`❌ Erros:      ${resultado.erros.length}`);

  fs.writeFileSync("correcao-resultado.json", JSON.stringify(resultado, null, 2));
  console.log(`\n💾 Salvo em correcao-resultado.json`);
}

main().catch(console.error);
