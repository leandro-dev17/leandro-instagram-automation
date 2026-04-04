---
type: agent
agent: creator
task: tasks/create-carousel.md
execution: inline
inputFile: squads/leandro-instagram/output/selected-angle.md
outputFile: squads/leandro-instagram/output/carousel-copy.md
format: instagram-feed
---

# Criar Carrossel — Ivan Instagram ✍️

**Agent:** Ivan Instagram — Criador de Carrosséis
**Task:** create-carousel.md
**Execution:** inline
**Input:** selected-angle.md (ângulo selecionado + tema)
**Output:** carousel-copy.md (copy completo + caption + hashtags)

---

## Instruções para Ivan Instagram

Leia:
- `squads/leandro-instagram/output/selected-angle.md` — ângulo selecionado
- `squads/leandro-instagram/output/selected-news.md` — tema base
- `squads/leandro-instagram/pipeline/data/tone-of-voice.md` — tom de voz do @leandro_personall
- `squads/leandro-instagram/pipeline/data/output-examples.md` — exemplos de qualidade
- `squads/leandro-instagram/pipeline/data/anti-patterns.md` — o que evitar

Crie um carrossel completo de **8 slides** para o @leandro_personall no formato definido pelo ângulo selecionado.

### Regras de criação

**Slide 1 (Cover):**
- Título: máximo 20 palavras, alto impacto
- Deve parar o scroll — pergunta provocativa OU afirmação contraintuitiva
- **photo_prompt:** descrição detalhada em INGLÊS para gerar foto realista. Sempre especifique: `Brazilian fitness woman, athletic build, upper body shot, no visible hands or fingers, natural appearance, professional gym` + iluminação da marca: `warm coral/orange rim light, dark navy blue background, cinematic lighting`
- **background: ai-image** — SEMPRE para o slide de capa (nunca navy sólido)

**Slides 2-7 (Corpo):**
- Cada slide: headline (60-80 palavras de headline + supporting text COMBINADOS)
- Hierarquia visual: headline em grande + supporting text menor
- Alterne backgrounds: light (#F8F6F1) e dark (#1A1F36)
- Accent keywords: palavras para destacar em coral (#E8614A)
- Cada slide avança a narrativa — sem repetição

**Slide 8 (CTA):**
- Headline de fechamento forte
- CTA específico com keyword (ex: "Comenta CICLO")
- Background: coral (#E8614A)

### Formato de saída

Salve em `squads/leandro-instagram/output/carousel-copy.md`:

```markdown
# Carrossel — [Título do tema]

**Ângulo:** [ângulo selecionado]
**Formato:** [formato de carrossel escolhido]
**Tom de voz:** [tom selecionado]
**Data:** YYYY-MM-DD

---

## SLIDES

### Slide 1 (Cover)
**Título:** [máximo 20 palavras]
**Subtítulo:** [opcional, máximo 10 palavras]
**Photo:** [descrição da imagem ideal]
**Background:** Navy (#1A1F36)

### Slide 2 — [Role/Papel]
**Headline:** [bold, large — a claim]
**Supporting text:** [2-3 sentences expanding the headline with evidence or context]
**Accent keywords:** [words to highlight in coral]
**Photo:** [photo description if applicable]
**Background:** Light (#F8F6F1) / Dark (#1A1F36)

[...repete para slides 3-7...]

### Slide 8 (CTA)
**Headline:** [closing statement]
**CTA:** [specific keyword CTA]
**Background:** Coral (#E8614A)

---

## CAPTION

[Hook paragraph — first 125 characters must compel "ver mais" tap]

[Body paragraph — expanded key points with line breaks]

[Closing question — open-ended, drives comments]

---

## HASHTAGS

#hashtag1 #hashtag2 #hashtag3 [8-12 hashtags, mix niche + mid-range + broad]

Anchor hashtags always: #emagrecimentometabolico #treinofeminino #ciclomenstrual #personaltrainerfeminino
```
