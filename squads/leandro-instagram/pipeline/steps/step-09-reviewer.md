---
type: agent
agent: reviewer
task: tasks/review.md
execution: inline
inputFiles:
  - squads/leandro-instagram/output/carousel-copy.md
  - squads/leandro-instagram/output/slides/
outputFile: squads/leandro-instagram/output/review-verdict.md
---

# Revisar Conteúdo — Rosa Revisão ✅

**Agent:** Rosa Revisão — Revisora de Qualidade
**Task:** review.md
**Execution:** inline
**Input:** carousel-copy.md + slides PNG (output/slides/)
**Output:** review-verdict.md (APPROVE/REJECT com scores)

---

## Instruções para Rosa Revisão

Leia:
- `squads/leandro-instagram/output/carousel-copy.md` — o copy completo
- Os 8 slides renderizados em `squads/leandro-instagram/output/slides/` — as imagens finais
- `squads/leandro-instagram/pipeline/data/quality-criteria.md` — critérios de qualidade do @leandro_personall
- `squads/leandro-instagram/pipeline/data/anti-patterns.md` — anti-padrões a verificar

### Avalie cada critério (1-10)

1. **Hook Strength** (Slide 1) — Para o scroll?
2. **Scientific Accuracy** — Informações corretas e verificáveis?
3. **Brand Voice** — Soa como @leandro_personall?
4. **Audience Relevance** — Fala com mulheres buscando emagrecimento metabólico?
5. **Carousel Flow** — História coerente, cada slide avança a narrativa?
6. **CTA Effectiveness** — CTA específico e acionável?
7. **Caption Quality** — Primeiros 125 chars forçam "ver mais"?

### Veredicto automático

```
APPROVE: média ≥ 7.0 E nenhum critério < 4/10
CONDITIONAL APPROVE: média ≥ 7.0 COM critério não-crítico entre 4-6/10
REJECT: média < 7.0 OU qualquer critério crítico < 4/10
```

**Critérios críticos (rejeição automática se < 4):** Hook, Scientific Accuracy, Audience Relevance, Carousel Flow, CTA

### Formato de saída

Salve em `squads/leandro-instagram/output/review-verdict.md`:

```markdown
# Veredicto — Rosa Revisão

**Data:** YYYY-MM-DD
**Conteúdo revisado:** [título do carrossel]

## 🏆 VEREDICTO: [APPROVE / CONDITIONAL APPROVE / REJECT]

**Score geral:** X.X/10

## Scorecard

| Critério | Score | Justificativa |
|----------|-------|---------------|
| Hook Strength | X/10 | [justificativa específica] |
| Scientific Accuracy | X/10 | [justificativa] |
| Brand Voice | X/10 | [justificativa] |
| Audience Relevance | X/10 | [justificativa] |
| Carousel Flow | X/10 | [justificativa] |
| CTA Effectiveness | X/10 | [justificativa] |
| Caption Quality | X/10 | [justificativa] |

## Mudanças Obrigatórias (se REJECT ou CONDITIONAL APPROVE)

1. [Mudança específica com localização exata — ex: "Slide 3: reescrever headline..."]
2. [...]

## Sugestões Não-Bloqueantes

1. [Sugestão opcional que melhoraria a qualidade]
2. [...]

## Resumo
[2-3 frases explicando o veredicto]
```

### Se REJECT: instrua o Ivan Instagram a reescrever

Se o veredicto for REJECT, indique claramente:
- Quais slides precisam ser reescritos
- Quais critérios falharam e por quê
- O que especificamente deve ser corrigido
