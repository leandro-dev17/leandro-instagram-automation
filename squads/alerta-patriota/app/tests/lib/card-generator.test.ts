import { describe, it, expect } from "vitest";
import { pick } from "@/lib/card-generator";

// Fase 25: antes desta função, a foto era escolhida por `new Date().getDate()` — todos os
// cards postados no mesmo dia usavam a mesma foto. Agora o seed é o id da notícia no banco.
describe("pick — seleção de foto por seed", () => {
  const fotos = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"];

  it("retorna sempre um índice dentro do array para seeds positivos", () => {
    for (let seed = 0; seed < 20; seed++) {
      const resultado = pick(fotos, seed);
      expect(fotos).toContain(resultado);
    }
  });

  it("não lança exceção e fica dentro do array para seeds negativos", () => {
    for (const seed of [-1, -2, -5, -100]) {
      const resultado = pick(fotos, seed);
      expect(fotos).toContain(resultado);
    }
  });

  it("não lança exceção e fica dentro do array para seeds muito grandes", () => {
    expect(fotos).toContain(pick(fotos, 999999999));
  });

  it("é determinístico: o mesmo seed sempre retorna a mesma foto", () => {
    expect(pick(fotos, 7)).toBe(pick(fotos, 7));
  });

  it("seeds diferentes tendem a variar a foto escolhida (regressão Fase 25)", () => {
    const escolhas = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((seed) => pick(fotos, seed)));
    expect(escolhas.size).toBeGreaterThan(1);
  });
});
