---
type: agent
agent: creator
task: tasks/generate-angles.md
execution: inline
inputFile: squads/leandro-instagram/output/selected-news.md
outputFile: squads/leandro-instagram/output/angles.md
format: instagram-feed
---

# Gerar 5 Ângulos — Ivan Instagram ✍️

**Agent:** Ivan Instagram — Criador de Carrosséis
**Task:** generate-angles.md
**Execution:** inline
**Input:** selected-news.md (notícia/tema selecionado)
**Output:** angles.md (5 ângulos distintos)

---

## Instruções para Ivan Instagram

Leia `squads/leandro-instagram/output/selected-news.md` para obter o tema selecionado.

Gere **exatamente 5 ângulos distintos** para esse tema. Cada ângulo usa uma lente emocional diferente — são perspectivas diferentes sobre o MESMO tema, não temas diferentes.

### Os 5 Ângulos Obrigatórios

**Ângulo 1 — 🔴 Medo/Urgência**
Foca nas consequências de NÃO agir. Cria urgência. O leitor deve sentir que está perdendo algo ou que um risco real existe.
Hook template: "Em X meses, mulheres que [comportamento atual] vão [consequência negativa]"

**Ângulo 2 — 🟢 Oportunidade**
Foca no ganho positivo. Apresenta uma janela de oportunidade. O leitor deve sentir que chegou na hora certa.
Hook template: "Este [descoberta/método/protocolo] muda tudo para quem quer [resultado desejado]"

**Ângulo 3 — 📚 Educacional/Revelação**
Foca em ensinar algo novo. O leitor deve sentir que está aprendendo algo que poucos sabem.
Hook template: "O que a ciência já descobriu sobre [tema] que a maioria dos profissionais ainda não ensinou"

**Ângulo 4 — ↔️ Contrário/Provocativo**
Desafia uma crença comum. O leitor deve sentir "espera, isso não é o que eu pensava".
Hook template: "[Crença popular] — o que ninguém te fala sobre isso"

**Ângulo 5 — ⭐ Inspiracional/Transformação**
Foca em possibilidade e esperança. O leitor deve se sentir capaz.
Hook template: "Imagine [transformação específica] quando você finalmente entende [mecanismo]"

### Regras para os ângulos

- ✅ Cada ângulo deve gerar uma reação emocional DIFERENTE no leitor
- ✅ O hook (primeira linha) de cada ângulo deve ser completamente diferente
- ✅ O formato de carrossel recomendado pode variar por ângulo
- ❌ Não são temas diferentes — é o MESMO tema visto de perspectivas diferentes
- ❌ Ângulos não são apenas paráfrases uns dos outros

### Formato de saída

Salve em `squads/leandro-instagram/output/angles.md`:

```markdown
# 5 Ângulos — [Tema]

**Tema base:** [tema do selected-news.md]
**Gerado por:** Ivan Instagram
**Data:** YYYY-MM-DD

---

## Ângulo 1 — 🔴 Medo/Urgência

**Hook (Slide 1):** "[Hook completo — 15 palavras máximo]"
**Promessa:** [O que o leitor vai descobrir neste carrossel]
**Formato recomendado:** [Problema → Solução / Mito vs Realidade / etc.]
**CTA sugerido:** "[Ação específica — ex: 'Comenta RISCO que te explico']"
**Por que funciona:** [1-2 frases sobre a psicologia por trás deste ângulo para o público de @leandro_personall]

---

## Ângulo 2 — 🟢 Oportunidade

**Hook (Slide 1):** "[Hook]"
**Promessa:** [...]
**Formato recomendado:** [...]
**CTA sugerido:** "[...]"
**Por que funciona:** [...]

---

## Ângulo 3 — 📚 Educacional

[mesma estrutura]

---

## Ângulo 4 — ↔️ Contrário

[mesma estrutura]

---

## Ângulo 5 — ⭐ Inspiracional

[mesma estrutura]

---

## Recomendação do Ivan
**Melhor ângulo para engajamento:** Ângulo X — [razão em 1 frase baseada no perfil do público]
```
