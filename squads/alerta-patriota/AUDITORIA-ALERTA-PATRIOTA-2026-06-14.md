# Auditoria — Alerta Patriota (2026-06-14)

## Resumo executivo

O sistema está em geral bem estruturado: autenticação JWT com cookies httpOnly, `CRON_SECRET` fail-closed em praticamente todas as rotas `/api/cron/*` e `/api/admin/*`, webhooks com validação HMAC fail-closed, e sem secrets hardcoded. **Porém, o helper `lib/ai.ts` recém-criado tem um bug crítico de detecção de erro de cota** que pode fazer o fallback Groq NUNCA disparar quando a Anthropic realmente bate no limite. Na Parte 3, foram encontrados 2 bugs críticos de lógica em campanhas de e-mail/retenção (sequências que provavelmente nunca disparam para a maioria dos usuários) e 1 cron (`fix-encoding`) sem qualquer tratamento de erro. Não há referências vivas a planos "Básico"/"Patriota" descontinuados — a migração para VIP/Elite está limpa.

---

## PARTE 1 — Cobertura do fallback Groq

**Cobertura: BOA.** Nenhum arquivo chama `new Anthropic(...)`/`anthropic.messages.create` fora de `lib/ai.ts`. Os 21 arquivos esperados importam `gerarTexto` corretamente.

### 1. `lib/ai.ts:17-20` — CRÍTICO
```ts
function ehErroDeLimite(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("usage limit") || msg.includes("rate_limit") || msg.includes("429") || msg.includes("overloaded");
}
```
A SDK `@anthropic-ai/sdk` lança erros com `err.status` (número, ex: 429/529) e `err.error?.type` (ex: "rate_limit_error", "overloaded_error"), que não necessariamente aparecem em `String(err)`. Erros de "usage limit" (cota mensal esgotada) podem vir como erro 400 com mensagem específica de billing, sem conter literalmente nenhuma dessas substrings. Risco: o fallback Groq não dispara justamente quando mais precisaria.
**Correção sugerida:** checar `err.status` (429/529/503) e `err.error?.type` (rate_limit_error/overloaded_error) além das strings.

### 2. `lib/ai.ts:9` — OK
`GROQ_API_KEY` referenciado corretamente.

### 3. `lib/ai.ts:52-55` — ALTO
Sem log explícito quando o Groq TAMBÉM falha — o erro propaga, mas sem indicar que era um "double fallback failure", dificultando diagnóstico.

---

## PARTE 2 — Segurança

- **Autenticação:** todas as 73 rotas `/api/cron/*` chamam `verificarCronSecret`. Rotas `/api/admin/*` (fix-encoding, limpar-fontes, setup) também protegidas corretamente, fail-closed.
- **Middleware/auth.ts:** JWT com `JWT_SECRET` de env (fail-fast se ausente), cookie `HttpOnly; SameSite=Lax; Secure` em produção. `verificarCronSecret` fail-closed.
- **Webhooks (MP e WhatsApp):** ambos fail-closed se o secret de env não existir — HMAC validado corretamente.
- **Secrets hardcoded:** nenhum encontrado.
- **SQL injection:** todas as queries usam `sql\`...\`` com interpolação segura.

### 5. `cron/revisor-schema/route.ts:50` — MÉDIO
Usa `sql.unsafe(sqlCmd)`, mas `sqlCmd` vem de dicionário `AUTOCORRECT` 100% hardcoded — não é injeção hoje, mas é um padrão perigoso a documentar/vigiar.

- **Auto-commit (claude-resolver):** `ARQUIVOS_PROTEGIDOS` (lib/auth.ts, lib/db.ts, middleware.ts) e `TAMANHO_MAX_AUTOFIX` (12000) presentes e verificados antes de qualquer escrita via GitHub API — correto. Recomenda-se confirmar se `claude-revisor/route.ts` reusa essas mesmas constantes ou tem cópia própria.

### 6. `webhooks/claude-resolver/route.ts:48` — BAIXO
Email de committer fixo não-verificável (`guardiao@bionexus.digital`) — cosmético.

### 7. `api/leads/registrar/route.ts` — MÉDIO
Rota pública sem rate limiting; `ON CONFLICT (email) DO NOTHING` mitiga parcialmente, mas permite flood/teste de e-mails em massa.

### 8. `api/assinaturas/criar/route.ts` — BAIXO
Exige usuário logado, sem problemas adicionais identificados.

---

## PARTE 3 — Lógica dos Agentes

Mapeados ~73 crons. Migração VIP/Elite confirmada limpa: nenhuma lógica viva referenciando planos "Básico"/"Patriota" descontinuados (apenas uso de "Patriota" como vocativo/branding).

### CRÍTICO

**9. `cron/campanha-recuperacao/route.ts:51`** — `dias_cancelado` é congelado no dia da detecção (gravado por `cacador-desistentes`) e nunca recalculado. `SEQUENCIA` só tem chaves {1,3,7,10,15,20,25,30}; quem não bateu exatamente nesses valores no dia da detecção é pulado **para sempre**. A sequência de retenção de 30 dias provavelmente não atinge a maioria dos cancelados.
**Correção:** recalcular `dias_cancelado` dinamicamente na própria query (`EXTRACT(DAY FROM NOW() - usuarios.updated_at)`).

**10. `cron/sequencia-nao-conversao/route.ts` (~linhas 168-180)** — janelas de envio dependem de `horasDesde` cair em faixas estreitas (`<2h`, `22-26h`, `46-50h`). Um cron diário em horário fixo dificilmente cobre as 3 janelas para todos os leads, então os e-mails 2 e 3 raramente disparam.
**Correção:** usar dias completos (ex: `>=24 AND <48`) com dedup por `ultimo_email_enviado`.

**11. `cron/fix-encoding/route.ts`** — sem try/catch nem log em `agentes_log`/Telegram. Erro de SQL gera 500 silencioso.
**Correção:** envolver em try/catch, logar erro e alertar Telegram.

### ALTO

**12. `cron/radar-economico/route.ts:52` e `cron/enquete-dia/route.ts:59`** — dedup usa `INTERVAL '20 hours'` em vez de 24h, abrindo janela de 4h/dia para duplicação de postagem.

**13. `cron/facebook-comentarios/route.ts:22`** — preço hardcoded "R$12,90/mês" não corresponde aos valores reais (VIP R$9,90, Elite R$19,90) — risco de divulgar preço errado publicamente.

**14. `cron/modo-crise/route.ts:66-76`** — fetch de auto-ativação sem try/catch e sem validar resultado; retorna `modoAtivo: false` independente do sucesso real.

**15. `cron/fiscal-pagamentos/route.ts:20-35`** — `qtdMembros`/`qtdWebhooks` calculados mas não usados na detecção de problema; lógica de comparação parece incompleta.

**16. `cron/fiscal-workflow/route.ts:107-112`** — `falhasJobCritico` conta todos os runs, mas o texto do alerta diz "X/3 runs" — pode mostrar X > 3.

**17. `cron/fiscal-agendamento/route.ts:82-90`** — `horaBRTParaUTC()` pode gerar `utcHora` 24-27 (sem normalizar para próximo dia), gerando datas inválidas na janela das 22h BRT.

**18. `cron/bot-responder/route.ts`** — cron crítico para resposta automática em VIP/Elite, sem log em `agentes_log` nem alerta Telegram em falha.

### MÉDIO

**19.** 14 crons com try/catch presente mas sem log de erro estruturado em `agentes_log`/Telegram: `cacador-desistentes`, `moderacao-grupo`, `campanha-recuperacao`, `cards-elite-global`, `upgrade-comportamental`, `termometro`, `resumo-noite`, `personagem-semana`, `facebook-comentarios`, `enquete-dia`, `dossie-elite`, `semana-em-revista`, `bom-dia`, `publicar-noticias`.

**20.** `gerente-clientes`/`gerente-tecnico` — `.catch()` silenciosos engolem erros parciais sem log.

**21-31.** Diversos itens menores:
- `gerente-clientes:47` — estrutura de snapshot não confirmada
- `fiscal-codigo-performance:39-47` — janela 2h vs 6h inconsistente
- `fiscal-mrr:65-79` — fallback silencioso se faltar snapshot
- `revisor-logica:49` — branch morta (string de match que talvez nunca ocorra)
- `revisor-schema:47-57` — match de coluna por nome parcial pode atingir tabela errada
- `agente-heartbeat:60-101` — sem validar `ultimaExecucao === null`
- `agente-limpeza:36-52` — `.length` para contar deletes
- `fiscal-agendamento:109-112` — `gruposAfetados` retorna sempre `["vip","elite"]`, código morto
- `fiscal-fontes:95` — condição redundante
- `gerente-conteudo:83` — `hora >= 10` sem TZ explícito, depende de UTC
- `claude-revisor:123-125` — contagem de tentativas sem diferenciar tipo

**32.** Fila Elite compartilhada sem coordenação entre `cards-elite-global`, `gerar-card` e `publicar-noticias` — condição de corrida latente.

**33.** `revisor-schema:50` `sql.unsafe` — já citado na Parte 2 (item 5).

### BAIXO

Itens 34-46: pequenas inconsistências cosméticas/de baixo risco — `fiscal-whatsapp:29` (whitelist de estados), `escalar-claude:51` (header sem validação prévia), `fiscal-especiais` (falsos negativos antes do horário), `fiscal-cards:72`/`fiscal-apis-externas:36` (condições redundantes), `fiscal-facebook:95` (stub documentado), `fiscal-inadimplentes:39` (fallback de plano desconhecido como VIP), `termometro:16`/`personagem-semana:48` (cálculo de semana não-ISO, mitigado por `ON CONFLICT`), `facebook-postar:48` (janela de dedup estreita), `curar-noticias:151-159` (heurística anti-duplicata fraca), `webhooks/claude-resolver:114` (committer email fixo), `sequencia-nao-conversao` (fallback "Patriota" como nome de plano em e-mails — confuso, mas não é o bug de plano descontinuado).

---

## Priorização recomendada

1. **`lib/ai.ts` — `ehErroDeLimite`** (item 1): corrigir antes que a cota da Anthropic realmente esgote.
2. **`campanha-recuperacao`** (item 9) e **`sequencia-nao-conversao`** (item 10): impactam receita/retenção diretamente.
3. **`fix-encoding`** (item 11): correção rápida, adicionar try/catch + log.
4. **`bot-responder`** sem log de erro (item 18): afeta experiência nos grupos pagos.
5. **`radar-economico`/`enquete-dia`** dedup 20h→24h (item 12): risco de duplicação visível.
6. **`facebook-comentarios`** preço hardcoded (item 13): risco de imagem pública.
7. Itens MÉDIO/BAIXO podem entrar na rotina normal dos próprios agentes `revisor-logica`/`gerente-codigo`.
