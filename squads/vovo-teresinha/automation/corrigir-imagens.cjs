/**
 * corrigir-imagens.cjs
 * Lê auditoria-imagens.json (124 receitas com imagem errada),
 * busca imagem correta no TheMealDB, faz upload no Cloudinary e atualiza o banco.
 */

const https   = require("https");
const http    = require("http");
const crypto  = require("crypto");
const fs      = require("fs");
const path    = require("path");
const { neon } = require("@neondatabase/serverless");

const DB_URL     = "postgresql://neondb_owner:npg_ietKBb8P2uxa@ep-floral-smoke-apslvj9w-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const CLOUD_NAME = "demazkgy2";
const API_KEY    = "266416614247189";
const API_SECRET = "SYmybuhU5M5LoGlhf9LCJUN3AcQ";
const sql = neon(DB_URL);

// ── Mapeamento PT → termos de busca em inglês ─────────────────────────────────
const TRADUCOES = [
  [/bolo.*banana/i,        "banana cake"],
  [/bolo.*cenoura/i,       "carrot cake"],
  [/bolo.*chocolate/i,     "chocolate cake"],
  [/bolo.*limao/i,         "lemon cake"],
  [/bolo.*laranja/i,       "orange cake"],
  [/bolo.*coco/i,          "coconut cake"],
  [/bolo.*aveia/i,         "oat cake"],
  [/bolo.*maca/i,          "apple cake"],
  [/bolo.*abacaxi/i,       "pineapple cake"],
  [/torta.*frango/i,       "chicken pie"],
  [/torta.*espinafre/i,    "spinach pie"],
  [/torta.*queijo/i,       "cheese pie"],
  [/torta.*limao/i,        "lemon tart"],
  [/torta.*ricota/i,       "ricotta pie"],
  [/omelete/i,             "omelette"],
  [/frango.*grelh/i,       "grilled chicken"],
  [/frango.*assado/i,      "roast chicken"],
  [/frango.*refog/i,       "chicken stew"],
  [/frango/i,              "chicken"],
  [/peixe.*grelh/i,        "grilled fish"],
  [/peixe/i,               "fish"],
  [/salmao/i,              "salmon"],
  [/atum/i,                "tuna"],
  [/carne.*mol/i,          "beef stew"],
  [/carne.*moida/i,        "ground beef"],
  [/carne/i,               "beef"],
  [/macarrao/i,            "pasta"],
  [/arroz.*integral/i,     "brown rice"],
  [/arroz/i,               "rice"],
  [/feijao/i,              "beans"],
  [/lentilha/i,            "lentils"],
  [/salada.*caesar/i,      "caesar salad"],
  [/salada.*grega/i,       "greek salad"],
  [/salada/i,              "salad"],
  [/sopa.*legumes/i,       "vegetable soup"],
  [/sopa.*creme/i,         "cream soup"],
  [/sopa/i,                "soup"],
  [/smoothie/i,            "smoothie"],
  [/vitamina.*banana/i,    "banana milkshake"],
  [/vitamina/i,            "milkshake"],
  [/suco.*laranja/i,       "orange juice"],
  [/pudim/i,               "pudding"],
  [/mousse.*chocolate/i,   "chocolate mousse"],
  [/mousse/i,              "mousse"],
  [/panqueca/i,            "pancake"],
  [/waffles?/i,            "waffles"],
  [/brownie/i,             "brownies"],
  [/cookie/i,              "cookies"],
  [/muffin/i,              "muffin"],
  [/cheesecake/i,          "cheesecake"],
  [/tapioca/i,             "crepes"],
  [/quiche/i,              "quiche"],
  [/risoto/i,              "risotto"],
  [/strogonoff/i,          "beef stroganoff"],
  [/hamburguer/i,          "burger"],
  [/pizza/i,               "pizza"],
  [/bruschetta/i,          "bruschetta"],
  [/wrap/i,                "wrap"],
  [/ceviche/i,             "ceviche"],
  [/pao.*queijo/i,         "cheese bread"],
  [/geleia/i,              "jam"],
  [/molho.*tomate/i,       "tomato sauce"],
  [/molho/i,               "sauce"],
  [/hummus/i,              "hummus"],
  [/guacamole/i,           "guacamole"],
];

function traduzirParaIngles(titulo) {
  // Normalizar: remover acentos, lowercase
  const norm = titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [pattern, termo] of TRADUCOES) {
    if (pattern.test(norm)) return termo;
  }
  // Fallback: usar as 2 primeiras palavras relevantes
  const palavras = norm.split(/\s+/).filter(p => p.length > 3 && !["com","sem","para","uma","mas","que","fit","low","carb"].includes(p));
  return palavras.slice(0, 2).join(" ") || titulo;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject).on("timeout", (req) => { req?.destroy(); reject(new Error("timeout")); });
  });
}

async function buscarNoMealDB(termo) {
  const url = `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(termo)}`;
  const buf = await get(url);
  const data = JSON.parse(buf.toString());
  return data.meals ? data.meals[0] : null;
}

// ── Upload Cloudinary ─────────────────────────────────────────────────────────

async function uploadCloudinary(imageBuffer, slug) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const publicId  = `vovo-teresinha/receitas/${slug}`;
    const sigStr    = `public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`;
    const signature = crypto.createHash("sha1").update(sigStr).digest("hex");

    const boundary  = `----CloudBoundary${Date.now()}`;
    const parts     = [];
    const add = (k, v) => parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
    );
    add("api_key",   API_KEY);
    add("timestamp", timestamp);
    add("public_id", publicId);
    add("signature", signature);

    let body = Buffer.from(parts.join(""));
    const filePart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${slug}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    body = Buffer.concat([body, filePart]);

    const req = https.request({
      hostname: "api.cloudinary.com",
      path: `/v1_1/${CLOUD_NAME}/image/upload`,
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error("Cloudinary parse error: " + d.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function slugify(titulo) {
  return titulo.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const auditoria = JSON.parse(fs.readFileSync("auditoria-imagens.json", "utf8"));
  const flagadas  = auditoria.flagadas;
  console.log(`📋 ${flagadas.length} receitas com imagem errada para corrigir\n`);

  const resultados = { corrigidas: [], nao_encontradas: [], erros: [] };

  for (let i = 0; i < flagadas.length; i++) {
    const r = flagadas[i];
    const termoBusca = traduzirParaIngles(r.titulo);
    process.stdout.write(`[${i + 1}/${flagadas.length}] ID ${r.id} "${r.titulo.slice(0, 40)}" → buscando "${termoBusca}"...`);

    try {
      const meal = await buscarNoMealDB(termoBusca);
      if (!meal?.strMealThumb) {
        process.stdout.write(" ⚠️ não encontrado\n");
        resultados.nao_encontradas.push(r.id);
        continue;
      }

      process.stdout.write(` ✅ "${meal.strMeal}" — baixando...`);
      const imgBuffer = await get(meal.strMealThumb);
      const slug = slugify(r.titulo);

      process.stdout.write(" uploading Cloudinary...");
      const upload = await uploadCloudinary(imgBuffer, slug);

      if (!upload.secure_url) throw new Error("sem secure_url: " + JSON.stringify(upload).slice(0, 100));

      // Atualizar banco
      await sql`UPDATE receitas SET foto_url = ${upload.secure_url} WHERE id = ${r.id}`;
      process.stdout.write(` 💾 salvo!\n`);
      resultados.corrigidas.push({ id: r.id, titulo: r.titulo, nova_url: upload.secure_url });

    } catch (e) {
      process.stdout.write(` ❌ erro: ${e.message.slice(0, 60)}\n`);
      resultados.erros.push({ id: r.id, erro: e.message });
    }

    // Pausa para não sobrecarregar
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Corrigidas: ${resultados.corrigidas.length}`);
  console.log(`⚠️  Não encontradas: ${resultados.nao_encontradas.length}`);
  console.log(`❌ Erros: ${resultados.erros.length}`);

  fs.writeFileSync("correcao-resultado.json", JSON.stringify(resultados, null, 2));
  console.log(`\n💾 Resultado salvo em correcao-resultado.json`);
}

main().catch(console.error);
