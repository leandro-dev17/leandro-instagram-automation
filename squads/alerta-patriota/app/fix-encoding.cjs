const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

// Lê DATABASE_URL do .env.local (nunca commitado) em vez de hardcoded —
// evita repetir a credencial em texto puro no histórico do git.
function carregarDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, ".env.local");
  const conteudo = fs.readFileSync(envPath, "utf8");
  const linha = conteudo.split("\n").find(l => l.startsWith("DATABASE_URL="));
  if (!linha) throw new Error("DATABASE_URL não encontrada em .env.local");
  return linha.slice("DATABASE_URL=".length).trim();
}

const sql = neon(carregarDatabaseUrl());

async function fix() {
  const count = await sql`SELECT COUNT(*) as total FROM noticias WHERE titulo ~ '[ÃÂ]'`;
  console.log("Corrompidos:", count[0].total);

  const r1 = await sql`UPDATE noticias SET titulo = convert_from(convert_to(titulo, 'LATIN1'), 'UTF8') WHERE titulo ~ '[ÃÂ]' RETURNING id`;
  console.log("Titulos OK:", r1.length);

  const r2 = await sql`UPDATE noticias SET resumo_braga = convert_from(convert_to(resumo_braga, 'LATIN1'), 'UTF8') WHERE resumo_braga IS NOT NULL AND resumo_braga ~ '[ÃÂ]' RETURNING id`;
  console.log("Resumos Braga OK:", r2.length);

  const r3 = await sql`UPDATE noticias SET resumo_cavalcanti = convert_from(convert_to(resumo_cavalcanti, 'LATIN1'), 'UTF8') WHERE resumo_cavalcanti IS NOT NULL AND resumo_cavalcanti ~ '[ÃÂ]' RETURNING id`;
  console.log("Resumos Cavalcanti OK:", r3.length);

  const amostra = await sql`SELECT titulo FROM noticias ORDER BY created_at DESC LIMIT 3`;
  amostra.forEach(n => console.log(">>", n.titulo));
}

fix().catch(console.error);
