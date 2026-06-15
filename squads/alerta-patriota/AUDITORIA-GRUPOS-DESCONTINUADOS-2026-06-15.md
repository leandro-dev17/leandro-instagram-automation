# Auditoria — Grupos descontinuados "Alerta Patriota" / "Alerta Patriota Básico" (2026-06-15)

Solicitação: identificar e corrigir qualquer parte da automação ainda direcionada aos grupos
"ALERTA PATRIOTA" e "ALERTA PATRIOTA BÁSICO" (descontinuados), garantindo que todos os agentes
trabalhem apenas para alimentar os grupos **VIP** e **ELITE**.

## Achado

A tabela `grupos_whatsapp` (Neon) tinha 4 grupos, todos com `ativo = true`:

| id | nome | plano | ativo (antes) |
|---|---|---|---|
| 1 | Alerta Patriota - Basico | `basico` | true |
| 2 | Alerta Patriota | `patriota` | true |
| 3 | VIP Premium - Alerta Patriota | `vip` | true |
| 4 | Elite Global - Alerta Patriota | `elite` | true |

O tipo `Plano` em `lib/db.ts` já é `"vip" | "elite"` e o envio real de mensagens
(`lib/whatsapp.ts` — `enviarMensagemGrupo`, `adicionarMembroGrupo`, `removerMembroGrupo`)
já bloqueia qualquer `plano` fora de `["vip","elite"]` (`GRUPOS_ATIVOS`) e usa IDs fixos de
`WPP_GROUP_VIP`/`WPP_GROUP_ELITE`. **Nenhum agente estava enviando mensagens reais para os
grupos 1/2.**

Porém, 2 pontos da automação ainda "trabalhavam" para os grupos descontinuados por estarem
com `ativo = true`:

1. **`webhook/whatsapp/route.ts` (Regina Recepção)** — `getPlanoByGroupId()` filtra só
   `ativo = true`. Com os grupos 1/2 ativos, uma entrada de novo membro nesses grupos
   disparava toda a lógica de boas-vindas (gravava `membros_grupos`, `agentes_log` com
   `agente='regina-recepcao'`), mesmo que `enviarMensagemGrupo` não enviasse nada de fato.

2. **`fiscal-grupos/route.ts` (Carlos Cargo)** — consultava `grupos_whatsapp` **sem filtro**,
   monitorando variação de membros e disparando alertas no Telegram para os 4 grupos,
   incluindo os 2 descontinuados.

## Correções aplicadas

1. **Banco de dados (Neon, produção)**:
   ```sql
   UPDATE grupos_whatsapp SET ativo = false WHERE id IN (1, 2);
   ```
   Grupos "Alerta Patriota - Basico" (id=1) e "Alerta Patriota" (id=2) marcados como
   `ativo = false`. Histórico preservado (nenhum registro apagado).
   Efeito imediato: `getPlanoByGroupId` (webhook Regina Recepção) passa a retornar `null`
   para esses grupos e ignora qualquer evento vindo deles.

2. **`squads/alerta-patriota/app/src/app/api/cron/fiscal-grupos/route.ts`** — adicionado
   filtro explícito na query principal:
   ```sql
   SELECT id, nome, plano, membros_ativos, max_membros
   FROM grupos_whatsapp
   WHERE ativo = true AND plano IN ('vip', 'elite')
   ORDER BY plano, nome
   ```
   Carlos Cargo agora monitora e alerta apenas sobre VIP e Elite. Como `carlos-cargo`
   alimenta a checagem de variação de membros em `gerente-clientes` (item 21 da auditoria
   anterior), esse efeito se propaga automaticamente — o Coronel de Clientes também passa
   a olhar só para VIP/Elite.

Typecheck confirmado sem novos erros.

## Não alterado (avaliado e considerado fora do escopo)

- **`admin/stats`** e **`admin/grupos`** — continuam listando os 4 grupos (incluindo os
  2 inativos), mas já retornam o campo `ativo`, então o painel pode exibi-los como
  desativados. São telas de gestão/visibilidade para Leandro, não agentes de automação —
  manter o histórico visível ali é útil.
- Strings de branding "Alerta Patriota" em e-mails/mensagens (`sequencia-nao-conversao`,
  `whatsapp.ts`, etc.) — são apenas o nome da marca/persona, não referência aos grupos
  descontinuados. Já avaliado na auditoria anterior (item 46).
