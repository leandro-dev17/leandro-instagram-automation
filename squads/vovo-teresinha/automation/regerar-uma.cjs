const https   = require("https");
const crypto  = require("crypto");
const { neon } = require("@neondatabase/serverless");

const DB_URL         = "postgresql://neondb_owner:npg_ietKBb8P2uxa@ep-floral-smoke-apslvj9w-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const CLOUD_NAME     = "demazkgy2";
const CLD_API_KEY    = "266416614247189";
const CLD_API_SECRET = "SYmybuhU5M5LoGlhf9LCJUN3AcQ";
const STABILITY_KEY  = process.env.STABILITY_API_KEY;
const sql = neon(DB_URL);

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

async function gerarImagem(titulo) {
  const prompt = `Professional food photography of "${titulo}", Brazilian home cooking style, overhead flat lay shot on rustic wooden table, natural soft window light, fresh ingredients visible, vibrant colors, appetizing, food magazine quality, shallow depth of field, no text no watermark no logo no people`;
  const body = JSON.stringify({
    text_prompts: [{ text: prompt, weight: 1 }, { text: "person, human, text, watermark, logo, nsfw, cartoon", weight: -1 }],
    cfg_scale: 7, height: 1024, width: 1024, samples: 1, steps: 35, style_preset: "photographic",
  });
  const res = await request({
    hostname: "api.stability.ai",
    path: "/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
    method: "POST",
    headers: { Authorization: `Bearer ${STABILITY_KEY}`, "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(body) },
  }, body);
  if (res.status !== 200) throw new Error(`Stability AI ${res.status}: ${res.buffer.toString().slice(0, 200)}`);
  const json = JSON.parse(res.buffer.toString());
  return Buffer.from(json.artifacts[0].base64, "base64");
}

async function uploadCloudinary(imageBuffer, slug) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId = `vovo-teresinha/receitas/${slug}`;
  const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${CLD_API_SECRET}`).digest("hex");
  const boundary = `----CldBound${Date.now()}`;
  const parts = [`--${boundary}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${CLD_API_KEY}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${timestamp}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="public_id"\r\n\r\n${publicId}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${signature}\r\n`];
  const head = Buffer.from(parts.join(""));
  const filePart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${slug}.png"\r\nContent-Type: image/png\r\n\r\n`), imageBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const fullBody = Buffer.concat([head, filePart]);
  const res = await request({ hostname: "api.cloudinary.com", path: `/v1_1/${CLOUD_NAME}/image/upload`, method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": fullBody.length } }, fullBody);
  const json = JSON.parse(res.buffer.toString());
  if (!json.secure_url) throw new Error("sem URL: " + JSON.stringify(json).slice(0, 200));
  return json.secure_url;
}

async function main() {
  const titulo = "Salada com Atum e Iogurte";
  const id = 239;
  const slug = titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  console.log(`Gerando: "${titulo}"...`);
  const img = await gerarImagem(titulo);
  const url = await uploadCloudinary(img, slug);
  await sql`UPDATE receitas SET foto_url = ${url} WHERE id = ${id}`;
  console.log(`✅ Salvo: ${url}`);
}
main().catch(console.error);
