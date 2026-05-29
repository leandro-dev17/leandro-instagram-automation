/**
 * Auditoria Visual de Imagens — Vovó Teresinha
 * Usa Claude Vision para verificar se cada imagem condiz com o nome da receita.
 * Analisa em lotes de 5 para controlar custo e velocidade.
 */

const Anthropic = require("@anthropic-ai/sdk");
const https = require("https");
const fs = require("fs");

const SECRET = "77ff5e2d98da7feec37a1598ae7d3909c83681359607b49779af237d21fc29ef";
const APP_URL = "https://receitinhas-vovo-teresinha.vercel.app";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchJSON(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ...opts, timeout: 30000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function downloadImageBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImageBase64(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      res.on("error", reject);
    }).on("error", reject).on("timeout", () => reject(new Error("timeout")));
  });
}

function mediaType(url) {
  if (url.includes(".png")) return "image/png";
  if (url.includes(".gif")) return "image/gif";
  if (url.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

async function verificarLote(receitas) {
  // Monta prompt com todas as receitas do lote
  const content = [];

  for (const r of receitas) {
    try {
      const b64 = await downloadImageBase64(r.foto_url);
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType(r.foto_url), data: b64 },
      });
      content.push({
        type: "text",
        text: `ID ${r.id}: "${r.titulo}" (categoria: ${r.categoria})`,
      });
    } catch (e) {
      console.error(`  Erro ao baixar imagem ID ${r.id}: ${e.message}`);
    }
  }

  if (content.length === 0) return [];

  content.push({
    type: "text",
    text: `Para cada par imagem+nome acima, responda APENAS com JSON no formato:
[{"id": 123, "ok": true/false, "descricao_imagem": "o que a imagem mostra em 1 frase", "motivo": "por que não bate (se ok=false)"}]
Seja criterioso: ok=false somente se a imagem claramente mostra um prato/alimento DIFERENTE do nome da receita.`,
  });

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content }],
  });

  const text = resp.content[0].text;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]); }
  catch { return []; }
}

async function main() {
  console.log("🔍 Buscando receitas...");
  const data = await fetchJSON(`${APP_URL}/api/cron/auditoria-imagens`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });

  const receitas = data.receitas.filter((r) => r.foto_url);
  console.log(`📋 ${receitas.length} receitas com imagem para verificar`);

  const mismatches = [];
  const LOTE = 5;

  for (let i = 0; i < receitas.length; i += LOTE) {
    const lote = receitas.slice(i, i + LOTE);
    process.stdout.write(`  Verificando ${i + 1}-${Math.min(i + LOTE, receitas.length)}/${receitas.length}...`);

    try {
      const resultados = await verificarLote(lote);
      const erros = resultados.filter((r) => !r.ok);
      if (erros.length > 0) mismatches.push(...erros);
      process.stdout.write(` ✅ (${erros.length} problemas)\n`);
    } catch (e) {
      process.stdout.write(` ⚠️ erro: ${e.message}\n`);
    }

    // Pausa entre lotes para não sobrecarregar
    if (i + LOTE < receitas.length) await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`❌ Imagens com mismatch: ${mismatches.length}`);
  console.log(`✅ Imagens corretas: ${receitas.length - mismatches.length}`);

  if (mismatches.length > 0) {
    console.log("\n=== RECEITAS COM IMAGEM ERRADA ===");
    mismatches.forEach((m) => {
      const r = receitas.find((x) => x.id === m.id);
      console.log(`\nID ${m.id}: "${r?.titulo}"`);
      console.log(`  Imagem mostra: ${m.descricao_imagem}`);
      console.log(`  Motivo: ${m.motivo}`);
      console.log(`  URL: ${r?.foto_url}`);
    });
  }

  // Salvar resultado para o próximo passo (correção)
  fs.writeFileSync(
    "auditoria-resultado.json",
    JSON.stringify({ mismatches, total: receitas.length, data: new Date().toISOString() }, null, 2)
  );
  console.log("\n💾 Resultado salvo em auditoria-resultado.json");
}

main().catch(console.error);
