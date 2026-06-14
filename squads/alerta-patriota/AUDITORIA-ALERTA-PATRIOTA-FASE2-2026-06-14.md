# Auditoria Alerta Patriota — Fase 2 (2026-06-14)

Continuação da auditoria de 2026-06-13 (`AUDITORIA-ALERTA-PATRIOTA-2026-06-14.md`). Esta fase cobre:
1. Itens MÉDIO/BAIXO restantes (21-46) — corrigidos ou revisados.
2. Auditoria completa da automação, com foco em **detecção/correção de erros pelos agentes** e na **hierarquia/escalonamento entre agentes**.

---

## PARTE 1 — Itens MÉDIO/BAIXO

### Corrigidos (commit `cbd43fc`)

| Item | Arquivo | Correção |
|---|---|---|
| 21 | `gerente-clientes/route.ts` | Passou a consumir o array `variacoes` real gravado pelo `carlos-cargo` (antes a checagem de queda de membros era um no-op, pois lia uma estrutura que não existia). |
| 22 | `fiscal-codigo-performance/route.ts` | Comentário explicando a janela 2h (detecção de loop) vs 6h (taxa geral de erro) — diferença intencional. |
| 23 | `fiscal-mrr/route.ts` | Adicionado `snapshot_anterior_encontrado` no log, para diferenciar "sem variação" de "sem snapshot anterior". |
| 25 | `revisor-schema/route.ts` | Match de `"tabela.coluna"` completo em vez de só a coluna — evita `ALTER TABLE` na tabela errada. |
| 27 | `agente-limpeza/route.ts` | `RETURNING id` nos 4 `DELETE`s — `.length` agora reflete linhas realmente apagadas. |
| 28 | `fiscal-agendamento/route.ts` | Removido parâmetro morto `_tipo` de `gruposAfetados()`. |
| 29 | `fiscal-fontes/route.ts` | Removida condição redundante `=== null` (TS já garante `number` ali). |
| 30 | `gerente-conteudo/route.ts` | Comentário explicando que o servidor roda em UTC e `toLocaleString` converte corretamente para BRT. |
| 31 | `claude-revisor/route.ts` | Removido `LIMIT 1` (que tornava `tentativas >= 2` impossível) e adicionado `status = 'erro'` no filtro — agora a escalação para Claude Resolver após 2 falhas funciona de fato. |
| 32 | `cards-elite-global/route.ts` | `SELECT` + `UPDATE` separados trocados por `UPDATE ... RETURNING` com `FOR UPDATE SKIP LOCKED` — elimina condição de corrida na Fila Elite entre `cards-elite-global`, `gerar-card` e `publicar-noticias`. |
| 34 (BAIXO) | `fiscal-whatsapp/route.ts` | Estado `"connecting"` da Evolution API agora é tratado como `'aviso'` (transitório), não dispara alerta crítico. Arquivo estava sem rastreamento no git — adicionado. |
| 38 (BAIXO) | `fiscal-apis-externas/route.ts` | Removida condição redundante `&& res.status !== 200`. |

Typecheck confirmado sem novos erros (todos os erros pré-existentes de TS em outros arquivos não foram tocados nem agravados).

### Revisados — já corretos, sem ação necessária

- **Item 24 — `revisor-logica/route.ts` (~linha 49)**: a "branch morta" apontada (`msg.includes("nenhuma notícia coletada") || msg.includes("coletor pode estar parado")`) é uma autocorreção válida — dispara `coletar-noticias` quando o pipeline trava. As strings batem com mensagens reais geradas por `fiscal-fontes`/`fiscal-noticias`. Não há bug de fato, apenas redundância textual aceitável entre as duas condições.
- **Item 26 — `agente-heartbeat/route.ts` (~linhas 50-101)**: a checagem `ultimaExecucao === null` já não é necessária — `avaliarAgente(rows)` trata array vazio (`rows.length === 0`) corretamente como "nunca executou", sem acessar `.created_at` de um valor nulo. Código correto como está.

### Revisados — BAIXO restantes (35-46), aceitos sem alteração

| Item | Local | Avaliação |
|---|---|---|
| 35 | `escalar-claude` — header sem validação prévia | Risco baixo: `verificarCronSecret` já valida antes; o header adicional é só contexto para o Claude, não controla acesso. |
| 36 | `fiscal-especiais` — falsos negativos antes do horário | Comportamento esperado/documentado: antes do horário de envio não há "atraso" a relatar. |
| 37 | `fiscal-cards:72` — condição redundante | Cosmético, não altera o resultado da checagem; deixar como está evita um diff de baixo valor. |
| 39 | `fiscal-facebook:95` — stub documentado | Já comentado no código como stub intencional (placeholder para renovação futura). |
| 40 | `fiscal-inadimplentes:39` — fallback de plano desconhecido como VIP | Fallback conservador (trata como o plano mais crítico/caro) — comportamento seguro por padrão. |
| 41-42 | `termometro:16` / `personagem-semana:48` — cálculo de semana não-ISO | Mitigado por `ON CONFLICT` — na pior hipótese gera duplicata de chave que é ignorada, não duplica conteúdo. |
| 43 | `facebook-postar:48` — janela de dedup estreita | Risco baixo de duplicação ocasional, sem impacto em receita/segurança. |
| 44 | `curar-noticias:151-159` — heurística anti-duplicata fraca | Aceitável: curadoria humana indireta via `vera-verificacao` cobre os casos que escapam da heurística. |
| 45 | `webhooks/claude-resolver:114` — committer email fixo | Cosmético — não afeta autoria real dos commits (mensagem já identifica o agente). |
| 46 | `sequencia-nao-conversao` — fallback "Patriota" como nome de plano em e-mails | Confuso, mas não é o bug de plano descontinuado (item já fechado na auditoria anterior); apenas texto de e-mail, sem efeito funcional. |

---

## PARTE 2 — Hierarquia e escalonamento dos agentes

### 🔴 NOVA DESCOBERTA (item 47 — ALTO) — `gerente-tecnico` com lista de agentes técnicos desatualizada

`squads/alerta-patriota/app/src/app/api/cron/gerente-tecnico/route.ts` mantém:

```ts
const AGENTES_TECNICOS = [
  "fiscal-login", "fiscal-api", "fiscal-whatsapp", "fiscal-banco",
  "fiscal-facebook", "guardiao-seguranca", "backup", "agente-medico",
  "fila-dlq", "carlos-disjuntor", "arturo-apis", "max-memoria", "wagner-workflow",
];
```

usado em:

```ts
const falhas = await sql`
  SELECT agente, COUNT(*) as total FROM agentes_log
  WHERE agente = ANY(${AGENTES_TECNICOS})
    AND status = 'erro'
    AND created_at > NOW() - INTERVAL '4 hours'
  GROUP BY agente
`;
```

Comparando com os `agente` reais gravados em `agentes_log` por cada cron:

| Entrada em `AGENTES_TECNICOS` | Slug real gravado | Situação |
|---|---|---|
| `"fiscal-login"` | `lisa-login` | ❌ nome errado — nunca casa |
| `"fiscal-api"` | `andre-api` | ❌ nome errado — nunca casa |
| `"fiscal-whatsapp"` | `wanderley-whatsapp` | ❌ nome errado — nunca casa |
| `"fiscal-banco"` | `bruna-banco` | ❌ nome errado — nunca casa |
| `"fiscal-facebook"` | `fiscal-facebook` | ⚠️ nome correto, **mas o cron só grava `status='sucesso'`** — nunca grava `'erro'`, então a checagem nunca dispara para esse agente |
| `"guardiao-seguranca"` | `gustavo-guarda` | ❌ nome errado — nunca casa |
| `"backup"` | `bruno-backup` | ❌ nome errado — nunca casa |
| `"agente-medico"` | `agente-medico` | ✅ correto e funcional |
| `"fila-dlq"` | (rota não existe) | ❌ entrada morta |
| `"carlos-disjuntor"` | (rota não existe) | ❌ entrada morta |
| `"arturo-apis"` | `arturo-apis` | ✅ correto e funcional |
| `"max-memoria"` | `max-memoria` (gravado por `agente-limpeza`) | ✅ correto e funcional |
| `"wagner-workflow"` | `wagner-workflow` (gravado por `fiscal-workflow`) | ✅ correto e funcional |

**Resultado: de 13 entradas, apenas 4 (`agente-medico`, `arturo-apis`, `max-memoria`, `wagner-workflow`) realmente funcionam.** As outras 9 nunca vão contar uma falha — ou seja, o "Coronel Técnico" (gerente-tecnico) está praticamente **cego** para erros de login, API, WhatsApp, banco, Facebook, segurança e backup, que são justamente os agentes mais críticos de infraestrutura.

**Prova de que isso é uma regressão conhecida e não corrigida em todos os lugares**: `agente-heartbeat/route.ts` já usa os nomes corretos e até documenta a correção:

```ts
buscarUltimo("lisa-login"),
buscarUltimo("andre-api"),        // corrigido: era "fiscal-api" (nome errado)
buscarUltimo("wanderley-whatsapp"),
buscarUltimo("bruna-banco"),
```

Ou seja, alguém já identificou e corrigiu esse mapeamento de nomes no `agente-heartbeat`, mas o mesmo ajuste não foi replicado em `gerente-tecnico`.

**Correção recomendada** em `gerente-tecnico/route.ts`:

```ts
const AGENTES_TECNICOS = [
  "lisa-login", "andre-api", "wanderley-whatsapp", "bruna-banco",
  "gustavo-guarda", "bruno-backup", "agente-medico",
  "arturo-apis", "max-memoria", "wagner-workflow",
];
```

(removendo `"fila-dlq"` e `"carlos-disjuntor"`, que não correspondem a nenhuma rota existente, e `"fiscal-facebook"`, que mantém mas — como observação separada — nunca grava `status='erro'`, então também não contribuirá para essa checagem até que o cron passe a logar falhas).

Além disso, vale registrar como observação separada (BAIXO): `fiscal-login`, `fiscal-api` e `fiscal-banco` **só gravam em `agentes_log` no caminho de sucesso** — falhas vão só para a tabela `alertas`, nunca para `agentes_log` com `status='erro'`. Mesmo corrigindo os nomes, a checagem de "falhas ≥ 3 em 4h" continuará sem efeito para esses três agentes a menos que os catches também gravem em `agentes_log`. Isso não é bloqueante (a tabela `alertas` já cobre o alerta imediato), mas reduz a utilidade do score consolidado do `gerente-tecnico` para esses agentes.

### Verificação geral da cadeia de escalonamento

Fluxo confirmado, ponta a ponta:

```
fiscal-* (detecção)
   → alertas (tabela) + agentes_log (status='erro'/'aviso')
   → gerente-* (consolida score 0-100)
        → score < 50 → relatorio-ceo (?origem=gerente-X&score=N)
   → claude-revisor (nível 1, auto-fix via Anthropic+GitHub+Vercel)
        → falhou 2x ou arquivo protegido/grande → escalar-claude
        → escalar-claude → webhooks/claude-resolver → notifica Leandro
```

| Gerente | Escala para `relatorio-ceo` quando score < 50? |
|---|---|
| `gerente-clientes` | ✅ confirmado |
| `gerente-conteudo` | ✅ confirmado |
| `gerente-financeiro` | ✅ confirmado |
| `gerente-tecnico` | ✅ confirmado (mas com detecção de falhas comprometida — ver item 47) |
| `gerente-codigo` | ✅ aciona `claude-revisor` diretamente (nível mais técnico, não passa por `relatorio-ceo` antes) |

A cadeia `claude-revisor → escalar-claude → webhooks/claude-resolver` está correta e a dedup de tentativas (`tentativas >= 2`) agora funciona de fato após o fix do item 31.

---

## Resumo executivo da Fase 2

- 12 dos 13 itens MÉDIO/BAIXO viáveis corrigidos e commitados (`cbd43fc`), 2 já estavam corretos (24, 26), 10 BAIXO revisados e aceitos sem necessidade de mudança.
- **Achado principal**: `gerente-tecnico` (Coronel Técnico) está usando uma lista `AGENTES_TECNICOS` desatualizada — 9 de 13 entradas não correspondem aos slugs reais gravados em `agentes_log`, tornando a checagem de "falhas técnicas recorrentes" praticamente inoperante para login, API, WhatsApp, banco, segurança e backup. Recomenda-se aplicar a correção acima como item ALTO prioritário.
- A cadeia de escalonamento `fiscal-* → gerente-* → relatorio-ceo` e `claude-revisor → escalar-claude → claude-resolver` está estruturalmente correta e, após os fixes desta fase (itens 31 e 32), funciona como projetada — exceto pela lacuna de detecção descrita no item 47.

---

## Priorização recomendada (Fase 2)

1. **Item 47 — `gerente-tecnico/AGENTES_TECNICOS`**: corrigir a lista de nomes (ALTO) — restaura a visibilidade do Coronel Técnico sobre falhas de login, API, WhatsApp, banco, segurança e backup.
2. (Opcional, BAIXO) Fazer `fiscal-login`, `fiscal-api`, `fiscal-banco` e `fiscal-facebook` gravarem `status='erro'`/`'aviso'` em `agentes_log` também no caminho de falha, para que a checagem de "≥3 erros em 4h" do `gerente-tecnico` tenha dados reais para esses agentes.
