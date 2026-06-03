/**
 * ATENÇÃO: Este arquivo é um alias legado de /api/fiscal-banco.
 * O endpoint canônico e ativo é /api/cron/fiscal-banco/route.ts
 *
 * Este arquivo foi mantido apenas para não quebrar chamadas externas
 * que ainda apontem para o caminho antigo. Ele delega toda a lógica
 * ao handler canônico via import direto.
 *
 * NÃO adicione lógica de negócio aqui. Toda manutenção deve ocorrer em:
 *   app/api/cron/fiscal-banco/route.ts
 */
export { GET } from "@/app/api/cron/fiscal-banco/route";
