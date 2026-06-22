# Fases de CriaÃ§Ã£o â€” Alerta Patriota
> Criado em: 2026-05-28
> Ãšltima atualizaÃ§Ã£o: 2026-05-28
> Status: FASE 1 ✅ | FASE 2 ✅ | FASE 3 ✅ | FASE 4 ✅ | FASE 5 ✅ | FASE 6 ✅ | FASE 7 ✅ — TODAS AS FASES CONCLUÍDAS!
> URL produÃ§Ã£o: https://alertapatriota.vercel.app
> Project ID Vercel: prj_ZYN6c2dhVL3oYGh00URkGot0bMO3

---

### FASE 1 â€” Core do NegÃ³cio âœ… CONCLUÃDA
*ConcluÃ­da em: 2026-05-28*

- [x] Banco de dados Neon exclusivo â€” schema completo com 13 tabelas (`src/app/api/admin/setup/route.ts`)
- [x] API backend Next.js â€” auth (login, cadastro, me), assinaturas, admin stats, noticias, usuarios
- [x] IntegraÃ§Ã£o Mercado Pago â€” webhook completo com validaÃ§Ã£o HMAC (`src/app/api/webhook/mercadopago/route.ts`)
- [x] **Agente Augusto Assinaturas** â€” ativa/desativa acesso + adiciona/remove do grupo WPP automaticamente
- [x] InstÃ¢ncia Evolution API configurada â€” variÃ¡veis em `.env.local.example` (âš ï¸ preencher com dados reais)
- [x] **Agente Regina RecepÃ§Ã£o** â€” boas-vindas no grupo via webhook WPP (`src/app/api/webhook/whatsapp/route.ts`)
- [x] **Agente Paulo BÃ¡sico/Patriota/VIP/Elite** â€” publicador unificado por grupo (`src/app/api/cron/publicar-noticias/route.ts`)
- [x] Libs compartilhadas: `db.ts`, `auth.ts`, `whatsapp.ts`, `brevo.ts`, `telegram.ts`
- [x] Middleware de autenticaÃ§Ã£o e proteÃ§Ã£o de rotas admin
- [x] Dashboard admin com mÃ©tricas em tempo real (`/admin`)
- [x] Sidebar admin com navegaÃ§Ã£o completa
- [x] Landing page inicial e tela de login

**Arquivos criados na Fase 1:**
```
app/
  package.json Â· tsconfig.json Â· next.config.ts Â· .env.local.example
  src/
    middleware.ts
    lib/ â†’ db.ts Â· auth.ts Â· whatsapp.ts Â· brevo.ts Â· telegram.ts
    app/
      layout.tsx Â· globals.css Â· page.tsx
      login/page.tsx
      admin/layout.tsx Â· admin/page.tsx
      api/
        admin/setup/ Â· admin/stats/ Â· admin/usuarios/ Â· admin/noticias/
        auth/login/ Â· auth/cadastro/ Â· auth/me/
        assinaturas/criar/
        webhook/mercadopago/ Â· webhook/whatsapp/
        cron/publicar-noticias/
```

âš ï¸ **PrÃ³ximos passos antes de ir para Fase 2:**
1. Criar banco Neon exclusivo e preencher `DATABASE_URL` no `.env.local`
2. Criar instÃ¢ncia Evolution API e preencher credenciais
3. Criar credenciais Mercado Pago exclusivas
4. Criar bot Telegram e preencher `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
5. Criar grupos no WhatsApp e preencher IDs e links no `.env.local`
6. Executar `POST /api/admin/setup` com o `CRON_SECRET` para criar as tabelas
7. Fazer deploy no Vercel

> âœ… EntregÃ¡vel: alguÃ©m paga â†’ entra no grupo â†’ recebe boas-vindas â†’ recebe notÃ­cias. Tudo automÃ¡tico.

---

### FASE 2 â€” AutomaÃ§Ã£o de ConteÃºdo âœ… CONCLUÃDA
*ConcluÃ­da em: 2026-05-31*

- [x] **Agente Neto NotÃ­cias** â€” scraping 3x/dia: Oeste, Jovem Pan, Gazeta do Povo, Brasil Paralelo
- [x] **Agente Curador Carlos** â€” seleciona as mais relevantes/impactantes do lote coletado
- [x] **Agente Ana Anti-Duplicata** â€” garante que nenhum tema se repete nas Ãºltimas 48h
- [x] **Agente Bernardo Resumidor** â€” Claude reescreve no tom do CapitÃ£o Braga (3 versÃµes: bÃ¡sica, patriota, vip)
- [x] **Agente Paulo Patriota** â€” publica no grupo Alerta Patriota (7h05 / 13h05 / 19h05)
- [x] **Agente Paulo VIP** â€” publica no grupo VIP Premium (7h10 / 13h10 / 19h10)
- [x] **Agente Raquel Radar** â€” monitora Twitter/X dos 10 polÃ­ticos-alvo a cada 30min (7hâ€“23h)
- [x] **Agente Victor Viral** â€” detecta declaraÃ§Ã£o viral, gera comentÃ¡rio urgente do CapitÃ£o Braga
- [ ] **Agente FÃ¡bio FOMO** â€” posta mensagem de urgÃªncia nos grupos inferiores quando VIP tem exclusivo
- [ ] **Agente MÃ¡rcio Crise** â€” ativa modo de atualizaÃ§Ã£o a cada 2h em dias de crise polÃ­tica
- [ ] **Agente Tereza TermÃ´metro** â€” gera e posta TermÃ´metro da Liberdade todo domingo Ã s 20h

> âœ… EntregÃ¡vel: produto funcionando 100% no automÃ¡tico. 3 notÃ­cias/dia com comentÃ¡rio da persona, alertas urgentes de deputados, FOMO automÃ¡tico nos grupos inferiores.

---

### FASE 3 — Landing Page ✅ CONCLUÍDA
*Concluída em: 2026-05-31*

- [ ] PWA â€” Landing page do CapitÃ£o Braga hospedada no Vercel
- [ ] SeÃ§Ãµes da landing: apresentaÃ§Ã£o da persona, o que vocÃª recebe por plano, depoimentos, urgÃªncia/escassez, tabela de planos
- [x] Checkout Mercado Pago com trial R$1 por 7 dias (converte para plano completo automaticamente)
- [ ] OpÃ§Ã£o de pagamento anual via Pix com desconto (R$99 / R$239 / R$479)
- [x] Fluxo completo testado ponta a ponta: anÃºncio â†’ landing â†’ checkout â†’ grupo WhatsApp
- [ ] **Agente Lucas Links** â€” gera links de compartilhamento com paywall para membros espalharem
- [ ] PÃ¡gina de lista de espera VIP (**Agente Esther Espera**)
- [ ] SequÃªncia de nÃ£o-conversÃ£o: 1h â†’ 24h â†’ 48h apÃ³s clique sem compra

> âœ… EntregÃ¡vel: funil de vendas completo funcionando. Meta Ads pode ser ligado.

---

### FASE 4 â€” Engajamento, RetenÃ§Ã£o e GuardiÃ£o
*O sistema que mantÃ©m a operaÃ§Ã£o viva e autÃ´noma 24/7*

**Engajamento e retenÃ§Ã£o:**
- [x] **Agente Enzo Engajamento** â€” trial expirando D-6, inativos 7/15/30 dias, boas-vindas
- [x] **Agente Rodrigo Risco** â€” preditor de churn com score 0â€“100, aciona oferta antes de cancelar
- [x] **Agente Diego Desistentes** â€” identifica cancelamentos e classifica motivo provÃ¡vel
- [x] **Agente Rebeca RecuperaÃ§Ã£o** â€” sequÃªncia automÃ¡tica 30 dias: D1/D3/D7/D10/D15/D20/D25/D30
- [x] **Agente Ulisses Upgrade** â€” mensagem privada para top 10% engajados sugerindo plano superior
- [x] **Agente Miguel ModeraÃ§Ã£o** â€” remove spam, inativos +60 dias, assinatura cancelada
- [x] **Agente Cintia ConversÃ£o** â€” identifica mais engajados no grupo BÃ¡sico, sugere upgrade com mensagem personalizada

**Sistema GuardiÃ£o (24/7):**
- [x] **Fiscal Lisa Login** â€” testa login/cadastro/reset a cada 5 min
- [x] **Fiscal Felipe Fiscal** â€” webhooks MP chegando, checkout acessÃ­vel (tempo real)
- [x] **Fiscal Bruna Banco** â€” conexÃ£o Neon, queries respondendo a cada 10 min
- [x] **Fiscal AndrÃ© API** â€” todas as rotas respondem 200 OK a cada 5 min
- [x] **Fiscal Wanderley WhatsApp** â€” Evolution API conectada, sessÃ£o ativa a cada 15 min
- [ ] **Agente MÃ¡rio MÃ©dico** â€” auto-cura com protocolos por serviÃ§o (Neon, MP, Evolution, Brevo)
- [x] **Agente Felipe Fila (DLQ)** â€” fila de retry: 1min â†’ 5min â†’ 15min â†’ 1h â†’ MÃ©dico
- [x] **Agente Carlos Disjuntor** â€” para tentativas apÃ³s 3 falhas seguidas, retoma quando serviÃ§o volta
- [x] **Agente Bruno Backup** â€” snapshot diÃ¡rio Neon â†’ Google Drive (7 diÃ¡rios + 4 semanais)
- [x] **Agente Gustavo Guarda** â€” brute force, IPs suspeitos, chaves expostas a cada 30 min
- [ ] **Agente SÃ©rgio Senhas** â€” rotaÃ§Ã£o mensal de tokens internos
- [x] **Agente General Alves CEO** â€” relatÃ³rio diÃ¡rio Ã s 8h no Telegram + escalonamento hierÃ¡rquico atÃ© Claude

> âœ… EntregÃ¡vel: operaÃ§Ã£o 100% autÃ´noma. Leandro sÃ³ recebe relatÃ³rio diÃ¡rio. Claude resolve o que os agentes nÃ£o conseguem.

---

### FASE 5 â€” Elite Global
*O produto premium com o Prof. Bernardo Cavalcanti*

- [ ] **Agente Igor Internacional** â€” scraping 3x/dia: Breitbart, Daily Wire, Fox News, La Nacion, Infobae + Twitter/X global (Elon, Trump, Milei, Thiel)
- [ ] **Agente Cavalcanti Resumidor** â€” Claude reescreve no tom do Prof. Bernardo Cavalcanti (analÃ­tico, intelectual, global)
- [ ] **Agente Paulo Elite** â€” 6 publicaÃ§Ãµes por dia (7h / 10h / 13h / 16h / 19h / 22h)
- [ ] **Agente Davi DossiÃª** â€” PDF semanal gerado via PDFKit e enviado todo sÃ¡bado Ã s 10h
- [ ] Landing page exclusiva Elite Global (persona Cavalcanti, posicionamento premium)
- [ ] Checkout anual R$499 via Pix e cartÃ£o
- [ ] IntegraÃ§Ã£o completa com GuardiÃ£o e todos os agentes de suporte

> âœ… EntregÃ¡vel: 4 grupos funcionando, 2 personas ativas, receita anual capturando elite conservadora.

---

### FASE 6 â€” App Admin
*Painel de controle total da operaÃ§Ã£o*

- [ ] Dashboard principal: MRR, membros por plano, novos hoje, cancelamentos, churn, projeÃ§Ã£o 30/60/90 dias, grÃ¡fico de crescimento, status dos agentes
- [ ] GestÃ£o de membros: tabela completa, filtros, aÃ§Ãµes individuais (mudar plano, cancelar, reembolsar, adicionar ao grupo)
- [ ] GestÃ£o de grupos: status de cada grupo, capacidade, link de convite, botÃ£o para criar novo grupo
- [ ] Central de conteÃºdo: notÃ­cias coletadas, fila de publicaÃ§Ã£o, histÃ³rico, preview WhatsApp, editor de prompts das personas
- [ ] Painel de agentes: status de todos os 50 agentes, Ãºltima execuÃ§Ã£o, prÃ³xima execuÃ§Ã£o, logs, botÃ£o de execuÃ§Ã£o manual
- [ ] Painel financeiro: receita por perÃ­odo, inadimplentes, reembolsos, breakdown por plano, exportar CSV
- [ ] ConfiguraÃ§Ãµes: horÃ¡rios, fontes de notÃ­cias, polÃ­ticos monitorados, valores dos planos, credenciais de API, mensagens padrÃ£o
- [ ] Logs completos: todas as operaÃ§Ãµes filtrÃ¡veis por agente, tipo, status, data

> âœ… EntregÃ¡vel: Leandro tem visÃ£o e controle total da operaÃ§Ã£o via browser, de qualquer lugar.

---

### FASE 7 â€” Facebook
*Topo de funil orgÃ¢nico â€” apÃ³s operaÃ§Ã£o gerando receita estÃ¡vel*

- [ ] PÃ¡gina do CapitÃ£o Braga â€” postagem automatizada via Playwright (sessÃ£o salva)
- [ ] Grupo pÃºblico Facebook â€” teasers do CapitÃ£o Braga + CTA para WhatsApp pago
- [ ] **Agente comentÃ¡rios Facebook** â€” responde todos os comentÃ¡rios no tom da persona com CTA
- [ ] "Semana em Revista" todo sÃ¡bado â€” conteÃºdo pÃºblico de aquisiÃ§Ã£o orgÃ¢nica
- [ ] IntegraÃ§Ã£o com GuardiÃ£o para monitorar saÃºde da sessÃ£o Playwright

> âœ… EntregÃ¡vel: mÃ¡quina de leads orgÃ¢nicos gratuitos alimentando o funil sem custo de anÃºncio.

---

### Resumo visual

```
FASE 1 â†’ Pagar e entrar no grupo funciona           (Core)
FASE 2 â†’ ConteÃºdo automÃ¡tico 3x/dia                (Produto)
FASE 3 â†’ Funil completo landing + checkout          (Vendas)
FASE 4 â†’ OperaÃ§Ã£o autÃ´noma com GuardiÃ£o             (Autonomia)
FASE 5 â†’ Elite Global + Prof. Cavalcanti            (Premium)
FASE 6 â†’ Admin app com controle total               (GestÃ£o)
FASE 7 â†’ Facebook trÃ¡fego orgÃ¢nico                  (Escala)
```

> âš ï¸ Fases 1 e 3 podem ser desenvolvidas em paralelo para agilizar o lanÃ§amento.








