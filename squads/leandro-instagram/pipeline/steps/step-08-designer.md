---
type: agent
agent: designer
task: tasks/create-slides.md
execution: inline
inputFile: squads/leandro-instagram/output/carousel-copy.md
outputFile: squads/leandro-instagram/output/slides/
format: instagram-feed
---

# Criar Slides — Diana Design 🎨

**Agent:** Diana Design — Designer de Slides
**Task:** create-slides.md
**Execution:** inline
**Input:** carousel-copy.md (copy aprovado pelo usuário)
**Output:** output/slides/ (8 imagens PNG 1080x1440px)

---

## Instruções para Diana Design

Leia `squads/leandro-instagram/output/carousel-copy.md` para obter o copy completo de todos os 8 slides.

Crie um arquivo HTML/CSS por slide e renderize cada um como imagem PNG usando o `image-creator` skill.

### Design System @leandro_personall

```css
/* Cores */
--navy: #1A1F36;
--cream: #F8F6F1;
--coral: #E8614A;
--white: #FFFFFF;
--text-dark: #1A1F36;
--text-light: #F8F6F1;

/* Tipografia (Google Fonts — @import Inter) */
--font: 'Inter', sans-serif;
--hero: 72px / 700;
--headline: 58px / 700;
--body: 38px / 500;
--caption: 28px / 500;
--handle: 26px / 400;

/* Viewport */
width: 1080px;
height: 1440px;

/* Spacing base unit: 48px */
```

### Regras de criação

1. **Um arquivo HTML por slide** — slide-01.html, slide-02.html, ..., slide-08.html
2. **HTML 100% self-contained** — CSS inline, sem arquivos externos, sem JS
3. **Fontes:** Google Fonts via @import (única exceção de recurso externo permitida)
4. **Body:** width:1080px, height:1440px, margin:0, padding:0, overflow:hidden
5. **Hierarquia:** Headline grande e negrito + Supporting text menor e regular
6. **Backgrounds:** Alternar dark (navy) e light (cream) entre slides (cover = always navy)
7. **Watermark:** "@leandro_personall" no topo direito, 26px, peso 400, opacidade 70%
8. **Palavras de destaque:** Accent keywords em coral (#E8614A) via `<span style="color:#E8614A">`
9. **Sem números de slide** nas imagens — Instagram mostra navegação nativa
10. **Verifica o slide 1 antes de prosseguir** — renderiza, visualiza, confirma qualidade

### Processo de renderização

Para cada slide:
1. Crie o HTML em `squads/leandro-instagram/output/slides/slide-NN.html`
2. Use o `image-creator` skill para renderizar o HTML como PNG
3. Salve o PNG como `squads/leandro-instagram/output/slides/slide-NN.png`
4. Verifique visualmente que texto está legível e nada está cortado

### Entrega final

Ao concluir todos os 8 slides:
- Confirme que `output/slides/` contém 8 arquivos PNG
- Apresente um resumo visual dos slides renderizados ao usuário
- Passe o caminho `output/slides/` para o próximo agente (Rosa Revisão)
