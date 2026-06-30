import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Fase 11/20: o body do sendMedia para a Evolution API precisa ser achatado (sem
// wrapper `mediaMessage`). gerar-card/route.ts importa @vercel/og + sharp no topo do
// arquivo, então não dá pra importar a rota diretamente num ambiente node de teste —
// este teste faz inspeção do texto-fonte para travar o formato do payload.

const ROUTE_PATH = path.join(__dirname, "..", "..", "src", "app", "api", "cron", "gerar-card", "route.ts");

describe("payload do sendMedia em gerar-card/route.ts", () => {
  const src = fs.readFileSync(ROUTE_PATH, "utf-8");

  it("usa o endpoint sendMedia da Evolution API", () => {
    expect(src).toMatch(/\/message\/sendMedia\//);
  });

  it("não usa o wrapper mediaMessage (formato antigo v1.8.x que quebrou o envio)", () => {
    expect(src).not.toMatch(/mediaMessage/);
  });

  it("manda os campos achatados na raiz do body: number, mediatype, media, caption", () => {
    expect(src).toMatch(/mediatype:\s*["']image["']/);
    expect(src).toMatch(/media:\s*jpegBase64/);
    expect(src).toMatch(/caption:\s*legenda/);
  });
});
