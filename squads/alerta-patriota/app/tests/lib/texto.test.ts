import { describe, it, expect } from "vitest";
import { cortarNoFimDeFrase } from "@/lib/texto";

// Fase 31: cortar a legenda no meio de uma frase ficava feio no Instagram.
// Fase 37: extraída de gerar-card/route.ts para lib/texto.ts (testabilidade).
describe("cortarNoFimDeFrase", () => {
  it("não corta se o texto já está dentro do limite", () => {
    const texto = "Frase curta.";
    expect(cortarNoFimDeFrase(texto, 100)).toBe(texto);
  });

  it("corta no último fim de frase real antes do limite", () => {
    const s1 = "Primeira frase aqui.";
    const s2 = " Segunda frase um pouco mais longa aqui.";
    const texto = `${s1}${s2} Terceira frase que passa do limite.`;
    // max cobre s1+s2 por inteiro mais um pouco (garante que o ". " de s2 entra na janela)
    const max = s1.length + s2.length + 3;
    const r = cortarNoFimDeFrase(texto, max);
    expect(r).toBe(s1 + s2);
  });

  it("não trata abreviações como 'Dr.' como fim de frase — continua buscando um ponto real anterior", () => {
    const s1 = "Você já leu sobre isso.";
    const meio = " Pergunte ao Dr.";
    const texto = `${s1}${meio} Carneiro sobre o caso depois.`;
    // max cobre até o ". " logo após "Dr." (que deve ser pulado por ser abreviação),
    // forçando a busca a recuar até o ponto real de s1.
    const max = (s1 + meio).length + 3;
    const r = cortarNoFimDeFrase(texto, max);
    expect(r).toBe(s1);
  });

  it("cai pro fallback de palavra + reticências quando não há fim de frase real no intervalo", () => {
    const texto = "Esta é uma frase única, bem longa, sem nenhum ponto final, exclamação ou interrogação dentro dela toda";
    const r = cortarNoFimDeFrase(texto, 50);
    expect(r.endsWith("…")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(51);
  });

  it("não corta no meio de uma palavra no fallback", () => {
    const texto = "Palavraumadepoisdaoutrasemespacosnenhumaaquisemfimdefrasenuncamaistexto";
    const r = cortarNoFimDeFrase(texto, 30);
    expect(r.endsWith("…")).toBe(true);
  });
});
