---
type: agent
agent: researcher
execution: subagent
inputFile: squads/leandro-instagram/output/research-focus.md
outputFile: squads/leandro-instagram/output/research-results.md
---

# Pesquisa de Notícias — Nara Notícias 🔍

**Agent:** Nara Notícias — Pesquisadora de Tendências Fitness Feminino
**Execution:** subagent (background)
**Input:** research-focus.md (topic + time range from checkpoint)
**Output:** research-results.md (ranked list of 3-5 stories)

---

## Instruções para Nara Notícias

Leia o arquivo `squads/leandro-instagram/output/research-focus.md` para obter o tema e período definidos no checkpoint anterior.

Com base nessas informações, execute as seguintes buscas usando `web_search` e `web_fetch`:

### Buscas obrigatórias (adapte ao tema definido)

1. `"{tema}" site:pubmed.ncbi.nlm.nih.gov OR site:journals.lww.com` — estudos científicos recentes
2. `"{tema} mulheres emagrecimento" -site:pinterest.com` — conteúdo fitness feminino
3. `"ciclo menstrual treino" OR "emagrecimento metabolico feminino" tendencias {ano}` — tendências do nicho
4. `"{tema}" personal trainer OR nutricionista brasil` — conteúdo especializado local

### Critérios de seleção e ranqueamento

Para cada notícia/estudo encontrado, avalie:
- **Relevância** (1-10): Quão diretamente afeta mulheres buscando emagrecimento metabólico
- **Ângulo potencial** (1-10): Suporta 3+ ângulos distintos (medo, oportunidade, educacional, contrário, inspiracional)
- **Expertise window** (1-10): Adiciona valor específico da especialização de @leandro_personall
- **Engajamento estimado** (1-10): Tema já mostrando alto engajamento no nicho fitness

**Score final = média dos 4 critérios**

### Formato de saída

Salve em `squads/leandro-instagram/output/research-results.md`:

```markdown
# Resultados da Pesquisa

**Data:** YYYY-MM-DD
**Tema buscado:** [tema do research-focus.md]
**Período:** [período do research-focus.md]

---

## Notícia/Tema 1 — Score: X.X/10

**Título:** [Título da notícia ou tema]
**Fonte:** [Nome da publicação/site]
**Data:** YYYY-MM-DD
**URL:** [URL]
**Relevância:** X/10 | **Ângulo potencial:** X/10 | **Expertise window:** X/10 | **Engajamento est.:** X/10

**Resumo (2-3 frases):** [O que é e por que importa para o público de @leandro_personall]

**Por que vale um carrossel:** [Específico — qual insight ou revelação torna isso viral no nicho]

---

## Notícia/Tema 2 — Score: X.X/10
[...repete o formato...]

---

## Notícia/Tema 3 — Score: X.X/10
[...]

(Mínimo 3 notícias, máximo 5)

---

## Recomendação da Nara
**Primeira escolha:** Notícia X — [razão em 1 frase]
**Segunda opção:** Notícia Y — [razão em 1 frase]
```
