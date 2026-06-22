# Relatório de Alterações — Alerta Patriota
**Data:** 15–16 de junho de 2026  
**Sessão:** Correção checkout MP + 7 Bugs de automação + Redesign página sucesso

---

## 1. CHECKOUT MERCADO PAGO — Erros corrigidos em cascata

### Arquivos alterados
- `squads/alerta-patriota/app/src/app/api/assinaturas/criar-direto/route.ts`
- `squads/alerta-patriota/app/src/app/api/assinaturas/criar/route.ts`

### Correções
| Erro | Causa | Fix |
|------|-------|-----|
| "Erro ao processar cadastro" | `status = 'pendente'` viola CHECK constraint do DB | Alterado para `status = 'trial'` |
| `null value in column "senha_hash"` | INSERT sem o campo obrigatório | Adicionado `senha_hash = '__sem_senha__'` |
| "Seu e-mail não corresponde" | `payer_email` era placeholder gerado (`tel...@alertapatriota.com.br`) | Coleta email real no gate modal e usa como `payer_email` |
| "payer_email is required" | Tentativa de remover o campo | MP exige o campo — mantido com email real |
| Opção de pagar com saldo MP | Checkout sem restrição de meio | Adicionado `payment_methods_allowed: [{ id: "credit_card" }]` |
| `start_date` inválido | Data no passado rejeitada pelo MP | `start_date = now + 5 minutos` |

### Funcionalidades adicionadas
- **7 dias grátis** (`free_trial: { frequency: 7, frequency_type: "days" }`) para plano mensal — marketing
- Resposta de erro inclui campo `detalhe` para debug fácil no browser

---

## 2. PERFORMANCE DA LANDING PAGE

### Arquivos alterados
- `squads/alerta-patriota/app/src/app/page.tsx`
- `squads/alerta-patriota/app/src/app/layout.tsx` (criado)

### Correções
| Problema | Causa | Fix |
|----------|-------|-----|
| Gate modal demorava para aparecer | `useState(false)` + `useEffect` = espera JS executar | Invertido: `useState(true)` + fecha no effect se já autenticado |
| Fontes lentas | `@import url(fonts.googleapis.com)` no CSS inline — mais lento possível | Migrado para `next/font/google` (self-hosted no CDN Vercel) |
| Texto "R$1" inconsistente | Marketing diz "grátis" mas texto dizia "R$1" | Atualizado para "7 dias grátis" em todos os pontos |

### Gate modal — novos campos
- Coleta: `nome`, `email` (type="email" + validação regex), `telefone`
- Email salvo em localStorage como `ap_email`
- Email passado para a API de checkout como `email`

---

## 3. BUGS DE AUTOMAÇÃO — GitHub Actions

### Arquivos alterados
- `.github/workflows/alerta-patriota-crons.yml`
- `.github/workflows/alerta-patriota-noticias.yml` (NOVO)
- `.github/workflows/alerta-patriota-bom-dia.yml` (NOVO)

### Bug 1 — coletar/curar/resumir rodando em todos os triggers (CRÍTICO)
- **Causa:** Sem condição `if:`, esses 3 jobs disparavam no trigger `*/5 * * * *` também
- **Fix:** Adicionado `if: github.event_name == 'workflow_dispatch'` nos 3 jobs dentro do `crons.yml`

### Bug 2 — `publicar-noticias` nunca era chamado
- **Causa:** Não existia em nenhum workflow
- **Fix:** Criado `alerta-patriota-noticias.yml` com pipeline completo:
  `coletar → curar → resumir → publicar-vip + publicar-elite` (com `needs:` entre jobs)
  Roda 3x/dia: 9h, 15h, 21h UTC (6h, 12h, 18h BRT)

### Bug 3 — Bom Dia Patriota no horário errado (6h BRT em vez de 7h BRT)
- **Causa:** Estava no `crons.yml` que roda às 9h UTC = 6h BRT
- **Fix:** Criado `alerta-patriota-bom-dia.yml` isolado com `cron: '0 10 * * *'` (10h UTC = 7h BRT)

---

## 4. FLAGS DE CARD ISOLADAS — Bug 6 de colisão de flags

### Arquivos alterados
- `squads/alerta-patriota/app/src/app/api/cron/gerar-card/route.ts`
- `squads/alerta-patriota/automation/whatsapp-cards.cjs`

### Problema
`publicar-noticias` (textos) e `gerar-card` / `whatsapp-cards.cjs` (cards visuais) usavam os mesmos flags `postada_vip` / `postada_elite`. Quando os cards eram gerados primeiro, o publicador de texto não encontrava notícias para publicar.

### Fix
Adicionadas colunas separadas no DB para cards:
- `postada_vip_card BOOLEAN DEFAULT false`
- `postada_elite_card BOOLEAN DEFAULT false`  
- `postada_vip_card_at TIMESTAMPTZ`
- `postada_elite_card_at TIMESTAMPTZ`

Migração inline idempotente em `gerar-card/route.ts` (usa `ADD COLUMN IF NOT EXISTS`).

`whatsapp-cards.cjs` atualizado nas linhas 465, 466, 510, 511 para usar as novas colunas.

**Resultado:** Cards e textos de notícias são publicados independentemente, sem bloquear um ao outro.

---

## 5. REDESIGN PÁGINA DE SUCESSO PÓS-ASSINATURA

### Arquivo alterado
- `squads/alerta-patriota/app/src/app/pagamento/sucesso/page.tsx`

### Problemas anteriores
- Layout básico sem hierarquia visual
- Link do WhatsApp aparecia como link azul sublinhado (não como botão)
- Sem animações, sem feedback visual de sucesso
- Sem guia de como entrar no grupo

### Novo design
- **Check circle verde animado** com glow (CSS keyframes `scaleIn`)
- **Badge do plano** com efeito shimmer dourado (VIP PREMIUM / ELITE GLOBAL)
- **Título em Bebas Neue** amarelo + bold
- **Botão WhatsApp** verde pulsante com ícone SVG oficial e animação `pulse-green`
- **Passos 1-2-3** visuais para guiar o usuário a entrar no grupo
- **Quote da persona** (Capitão Braga ou Prof. Cavalcanti, detecta pelo plano) em card dourado
- Animações de entrada escalonadas: `fadeUp` + `scaleIn` com delays
- Detecta plano via `?plano=` na URL ou `localStorage.ap_plano`

---

## Status final

| Área | Status |
|------|--------|
| Checkout MP (criar-direto) | ✅ Funcionando — trial 7 dias + cartão only |
| Checkout MP (criar) | ✅ Funcionando |
| Performance landing page | ✅ Modal instantâneo + fontes self-hosted |
| GitHub Actions — pipeline notícias | ✅ 3x/dia no horário correto |
| GitHub Actions — bom dia | ✅ 7h BRT no workflow isolado |
| Flags de card isoladas | ✅ Colunas separadas, sem colisão |
| Página de sucesso redesignada | ✅ Visual profissional e impactante |
| Deploy Vercel | ⏳ Aguarda CI/CD automático via push no GitHub |
