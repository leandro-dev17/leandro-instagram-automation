// Palavras que terminam com "." mas não são fim de frase real
// (Fase 31: evita cortar "Prof." ou "Dr." como se fossem ponto final)
const ABREVIACOES = new Set(["prof", "dr", "dra", "sr", "sra", "srta", "eng", "exa", "av", "art", "min", "gen", "cap", "cel", "ed"]);

export function cortarNoFimDeFrase(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  let limite = max;
  while (limite > max * 0.4) {
    const cortado = texto.slice(0, limite);
    const pontoIdx = Math.max(cortado.lastIndexOf(". "), cortado.lastIndexOf(".\n"), cortado.lastIndexOf("! "), cortado.lastIndexOf("? "));
    if (pontoIdx <= 0) break;
    const antes = cortado.slice(0, pontoIdx);
    const ultimaPalavra = (antes.match(/(\w+)$/) || [""])[0].toLowerCase();
    if (!ABREVIACOES.has(ultimaPalavra)) return cortado.slice(0, pontoIdx + 1);
    limite = pontoIdx;
  }
  const cortado = texto.slice(0, max);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  return `${cortado.slice(0, ultimoEspaco > 0 ? ultimoEspaco : max)}…`;
}
