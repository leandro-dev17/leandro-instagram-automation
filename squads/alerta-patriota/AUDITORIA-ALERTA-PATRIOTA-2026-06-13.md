# Auditoria Completa — App Alerta Patriota
**Data:** 13/06/2026

Auditoria de funcionalidade, lógica de negócio, frontend, backend, banco de dados e segurança, feita por 5 agentes em paralelo cobrindo todo o código em `squads/alerta-patriota/app/src`.

---

## 🔴 CRÍTICOS (corrigir primeiro)

### 1. Pagamento via Pix anual nunca ativa a assinatura
- **Onde:** `src/app/api/assinaturas/criar-pix/route.ts:58` e `src/app/api/webhook/mercadopago/route.ts:231-236`
- **Problema:** `criar-pix` cria o pagamento no Mercado Pago com `metadata: { plano, ciclo, email }` — **sem `usuario_id`**. O webhook do MP lê `metadata.usuario_id` para liberar o acesso (`ativarAcesso`). Como esse campo nunca existe, **todo pagamento Pix aprovado fica sem efeito**: o cliente paga e não recebe o plano/grupo.
- **Correção:** incluir `usuario_id` no `metadata` enviado ao MP e usá-lo no webhook.

### 2. Webhook do Mercado Pago aceita requisições sem validação se o secret não estiver configurado
- **Onde:** `src/app/api/webhook/mercadopago/route.ts:142-143` (`validarWebhook`)
- **Problema:** se `MERCADOPAGO_WEBHOOK_SECRET` não estiver definida, a função retorna `true` (válido). Como essa rota é pública, um atacante poderia forjar um evento de pagamento aprovado e liberar acesso Elite de graça para qualquer `usuario_id`/`external_reference`.
- **Correção:** se o secret não estiver configurado, **rejeitar** a requisição (fail-closed), e garantir que a env var esteja sempre configurada em produção.

### 3. JWT_SECRET com fallback hardcoded
- **Onde:** `src/lib/auth.ts:6` — `const JWT_SECRET = process.env.JWT_SECRET || "alerta-patriota-secret"`
- **Problema:** se a variável de ambiente não estiver definida em algum ambiente (preview/staging), o segredo conhecido publicamente (`"alerta-patriota-secret"`) permite forjar tokens **de admin**.
- **Correção:** lançar erro se `JWT_SECRET` não estiver definido, igual já é feito para `CRON_SECRET`.

### 4. Webhook do WhatsApp sem validação de origem
- **Onde:** `src/app/api/webhook/whatsapp/route.ts:50` (POST)
- **Problema:** qualquer requisição externa pode inserir itens em `whatsapp_fila` (fazendo o `bot-responder` gastar créditos de IA e postar nos grupos VIP/Elite com a persona oficial) ou simular entrada/saída de membros em `membros_grupos`.
- **Correção:** validar um header secreto (`apikey`/`X-Webhook-Secret`) configurável na Evolution API, comparando com uma env var própria.

### 5. Agentes "claude-revisor" / "webhooks/claude-resolver" fazem auto-commit + redeploy em produção sem revisão humana
- **Onde:** `src/app/api/cron/claude-revisor/route.ts` e `src/app/api/webhooks/claude-resolver/route.ts`
- **Problema:** esses agentes enviam o conteúdo de arquivos do projeto (incluindo **`src/lib/auth.ts`** e **`src/lib/db.ts`**) para o Claude, pedem o "código corrigido" e **commitam direto no `main`**, disparando redeploy automático no Vercel — sem PR, sem teste, sem whitelist real. Como o conteúdo enviado é truncado (`.substring(0,8000)`/`.substring(0,3000)`), em arquivos grandes o commit pode **sobrescrever o arquivo com uma versão incompleta**, corrompendo `auth.ts` (quebrando login/admin/CRON_SECRET de todo o sistema) ou `db.ts` (quebrando a conexão com o banco).
- **Correção recomendada:** remover `lib/auth.ts` e `lib/db.ts` de qualquer mapa de arquivos auto-corrigíveis, desabilitar commit automático (trocar por "abrir PR" ou "gerar sugestão"), exigir aprovação humana antes de aplicar, e não truncar o conteúdo do arquivo.

---

## 🟠 MÉDIOS

6. **Cards Elite marcados como "postados" antes da confirmação real** — `cards-elite-global/route.ts:76-80` marca `postada_elite = true` antes do script externo confirmar o envio; se falhar, a notícia se perde e nunca é reenviada.
7. **`gerar-card` depende de `puppeteer`, que não está instalado** — `src/app/api/cron/gerar-card/route.ts:94-95`: import dinâmico falha, cron responde `200 ok:false`, mas o card visual nunca é gerado e não há alerta. Decidir: instalar `puppeteer-core` + `@sparticuz/chromium` (compatível com Vercel) ou remover esse cron do fluxo.
8. **`bom-dia`/`resumo-noite`**: chamadas à IA para VIP e Elite em `Promise.all` — se uma falhar, **nenhum** dos dois grupos recebe a mensagem do dia. Trocar por `Promise.allSettled`.
9. **Reativação indevida por replay do MP**: `desativarAcesso` não limpa `mp_subscription_id`; um evento antigo `authorized` reenviado pelo MP pode reativar um usuário cancelado sem novo pagamento (`mercadopago/route.ts`).
10. **Idempotência do webhook MP só por 5 minutos** (`mercadopago/route.ts:182-191`) — reenvios do MP após esse intervalo reprocessam o evento inteiro (duplica contadores, reenvia boas-vindas).
11. **Cookie de sessão sem flag `Secure`** — `lib/auth.ts:45-49`, define `HttpOnly; SameSite=Lax` mas falta `Secure` em produção (HTTPS).
12. **Página `/admin/conteudo` busca endpoint inexistente** — `app/admin/conteudo/page.tsx:64` chama `/api/admin/mensagens` (plural, GET), mas a rota real é `/api/admin/mensagem` (singular, POST). A aba "Histórico" nunca carrega.
13. **`/admin/prompts` — botão "Restaurar padrão" usa o valor errado** — pega `Object.values(LABELS)[0]?.label` em vez do prompt padrão retornado pela API (`admin/prompts/page.tsx:81`).
14. **Possível squad de governança "morta"**: `guardiao-seguranca` (que dispara toda a cadeia fiscal → revisor → claude-revisor/escalar-claude) **não está no `vercel.json`** — se não estiver agendado em outro lugar (ex: GitHub Actions), os ~38 crons fiscais/gerentes nunca executam.
15. **Risco de custo recorrente de API Claude sem circuit breaker** — se um alerta não for marcado como `resolvido` por falha silenciosa em `claude-revisor`, o ciclo fiscal pode reacioná-lo repetidamente.
16. **Mapas de auto-fix duplicados** entre `claude-revisor`, `escalar-claude` e `webhooks/claude-resolver` (`AUTO_FIX_ROTAS`/`MAPA_ARQUIVOS` quase idênticos) — risco de divergência na manutenção.
17. **GET com efeitos colaterais**: `api/admin/fix-encoding` e `api/admin/limpar-fontes` fazem `UPDATE` em massa via `GET` (protegidos por `CRON_SECRET`, mas GET com side-effect pode ser cacheado/pré-buscado).
18. **`moderacao-grupo` não cumpre o que o comentário promete** — diz remover "inativos há +60 dias", mas só remove `cancelado`/`inadimplente`. Documentação desatualizada / feature não implementada.

---

## 🟡 BAIXOS / observações

- Botão "Entrar por R$1" aparece também no ciclo anual em `/assinar`, o que pode confundir sobre o valor real cobrado via Pix (R$99/R$199).
- `lib/db.ts`: tipo `Noticia` não inclui a coluna `global` (existe na tabela e é usada no código) — drift de tipos, sem impacto funcional.
- Páginas admin órfãs/duplicadas fora do menu: `/admin/usuarios` (vs `/admin/membros`) e `/admin/noticias` (vs `/admin/conteudo`) — código morto.
- `leads/registrar` e `lista-de-espera` não têm rate-limiting/anti-flood (apenas `ON CONFLICT DO NOTHING`).
- Vários crons (`bot-responder`, `moderacao-grupo`, `facebook-comentarios`, `cacador-desistentes`, `upgrade-comportamental`, `dossie-elite`, `semana-em-revista`, `termometro`, `radar-economico`, `personagem-semana`) não enviam alerta no Telegram em caso de erro — inconsistente com os demais crons.
- `fiscal-mrr` conta trials como MRR "assumindo conversão" — premissa otimista, já documentada no relatório mas pode confundir leitura rápida.

---

## ✅ O que está funcionando corretamente

- **Autenticação CRON_SECRET**: todos os ~75 crons e rotas admin protegidas verificam corretamente, fail-closed.
- **Autenticação admin**: todas as rotas `/api/admin/*` exigem JWT + `tipo_usuario = "admin"`.
- **Sem SQL injection**: todas as queries usam template literals parametrizados do Neon.
- **bcrypt** correto em cadastro/login.
- **Preços consistentes** entre landing page, `/assinar`, backend de assinaturas e painel financeiro: VIP R$9,90/mês ou R$99/ano; Elite R$19,90/mês ou R$199/ano.
- **Limpeza VIP/Elite** (feita nesta sessão) está completa: nenhuma página/rota admin, cron fiscal ou query residual referencia "basico"/"patriota" como plano.
- Sem segredos (`DATABASE_URL`, `CRON_SECRET`, chaves de API) expostos no frontend.
- `whatsapp.ts` trata erros de envio sem derrubar processos.
- Schema do banco (`setup/route.ts`) consistente com as queries, exceto o gap pontual já citado.

---

## Prioridades recomendadas

1. **Corrigir Pix anual** (item 1) — clientes pagando sem receber o produto.
2. **Fechar brechas de autenticação de webhooks** (itens 2 e 4) — risco de fraude/abuso.
3. **Remover fallback hardcoded do JWT_SECRET** (item 3).
4. **Colocar salvaguardas nos agentes de auto-commit** (item 5) — risco de derrubar o sistema inteiro sozinho.
5. Resolver `gerar-card`/Puppeteer e `cards-elite-global` (itens 6-7).
6. Corrigir bugs de UI do admin (itens 12-13) e confirmar se a squad de governança está agendada (item 14).
