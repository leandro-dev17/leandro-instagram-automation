import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Estas rotas de cron já causaram processamento duplicado em execuções concorrentes
// (duas invocações da Vercel rodando ao mesmo tempo pegavam a mesma notícia). A correção
// em cada caso foi um claim atômico: ou `FOR UPDATE SKIP LOCKED` numa CTE seguida de
// UPDATE ... RETURNING, ou um UPDATE condicional em campo sentinela ('__PROCESSANDO__').
// Como não há banco de teste, este teste faz inspeção do texto-fonte: garante que o
// padrão de claim continua presente e que existe um caminho de rollback em caso de falha.
// Não é um teste comportamental — é uma trava contra reintrodução do bug por refactor.

const ROUTES_DIR = path.join(__dirname, "..", "..", "src", "app", "api", "cron");

function lerRota(relPath: string): string {
  return fs.readFileSync(path.join(ROUTES_DIR, relPath), "utf-8");
}

describe("claim atômico — proteção contra processamento duplicado em crons concorrentes", () => {
  it("bot-responder usa FOR UPDATE SKIP LOCKED para reivindicar mensagens", () => {
    const src = lerRota("bot-responder/route.ts");
    expect(src).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(src).toMatch(/RETURNING/);
  });

  it("publicar-noticias usa FOR UPDATE SKIP LOCKED para reivindicar notícias", () => {
    const src = lerRota("publicar-noticias/route.ts");
    expect(src).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(src).toMatch(/RETURNING/);
  });

  it("resumir-noticias usa claim sentinela '__PROCESSANDO__' com rollback para NULL em falha", () => {
    const src = lerRota("resumir-noticias/route.ts");
    expect(src).toMatch(/__PROCESSANDO__/);
    expect(src).toMatch(/=\s*NULL/);
  });

  it("resumir-noticias-global usa claim sentinela '__PROCESSANDO__' com rollback para NULL em falha", () => {
    const src = lerRota("resumir-noticias-global/route.ts");
    expect(src).toMatch(/__PROCESSANDO__/);
    expect(src).toMatch(/=\s*NULL/);
  });
});
