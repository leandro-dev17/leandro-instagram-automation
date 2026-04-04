---
type: agent
agent: publisher
task: tasks/publish.md
execution: inline
inputFiles:
  - squads/leandro-instagram/output/carousel-copy.md
  - squads/leandro-instagram/output/slides/
outputFile: squads/leandro-instagram/output/kit-publicacao/PUBLICAR.md
---

# Montar Kit de Publicação — Paula Post 📦

**Agent:** Paula Post — Empacotadora de Conteúdo
**Task:** publish.md
**Execution:** inline
**Input:** slides PNG + caption + hashtags do carousel-copy.md
**Output:** `output/kit-publicacao/` — pasta pronta para baixar e publicar manualmente

---

## Instruções para Paula Post

Leia:
- `squads/leandro-instagram/output/{run_id}/carousel-copy.md` — para extrair caption e hashtags
- `squads/leandro-instagram/output/{run_id}/slides/` — localizar todos os slides PNG gerados

### Processo

1. Liste os slides PNG em `output/{run_id}/slides/` com Bash: `ls squads/leandro-instagram/output/{run_id}/slides/*.png`
   - Copie-os para `output/{run_id}/kit-publicacao/`
   - Renomeie em sequência: `01.png`, `02.png`, etc. (nomes simples para facilitar upload)
2. Crie `output/{run_id}/kit-publicacao/PUBLICAR.md` com caption + hashtags prontos para copiar
3. **Copie todos os arquivos do kit para a pasta do OneDrive com subpasta de data:**
   - Obtenha a data: `DATE=$(echo {run_id} | cut -c1-10)`
   - Crie a pasta: `mkdir -p "C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/$DATE"`
   - Copie: `cp squads/leandro-instagram/output/{run_id}/kit-publicacao/*.png "C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/$DATE/"`
   - Copie: `cp squads/leandro-instagram/output/{run_id}/kit-publicacao/PUBLICAR.md "C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/$DATE/"`
4. Confirme o inventário final e informe ao usuário que os arquivos estão prontos em:
   `C:\Users\lelus\OneDrive\Pictures\Automação Claude post\{data}\`

### Formato do arquivo PUBLICAR.md

```markdown
# Kit de Publicação — @leandro_personall

**Gerado em:** YYYY-MM-DD
**Slides:** 8 imagens PNG (01.png a 08.png nesta pasta)

---

## CAPTION (copie e cole no Instagram)

[Caption completa, exatamente como deve aparecer no post]

---

## HASHTAGS (inclua no final da caption)

[Lista de hashtags]

---

## CHECKLIST DE PUBLICAÇÃO

- [ ] Faça upload dos 8 slides na ordem: 01.png → 08.png
- [ ] Cole a caption no campo de descrição
- [ ] Adicione as hashtags ao final da caption
- [ ] Publique!
```
