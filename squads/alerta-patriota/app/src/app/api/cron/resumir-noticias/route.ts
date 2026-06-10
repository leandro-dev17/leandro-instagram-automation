```typescript
/**
 * AGENTE BERNARDO RESUMIDOR
 * Usa Claude para reescrever notícias no tom do Capitão Braga (3 versões).
 * Versão básica: só resumo | Patriota: + comentário | VIP: + gancho urgente
 * GET /api/cron/resumir-noticias
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT_BRAGA_BASICO = `Você é o Capitão Braga, ex-militar evangélico, direto e patriota.
Reescreva esta notícia em 3-4 linhas no ponto de vista conservador.
Seja direto e use linguagem simples que o brasileiro comum entende.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label no início. Comece direto com o conteúdo.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com a linha: Deus, Pátria e Família — sempre.
Responda APENAS com o texto da mensagem, nada mais.`;

const PROMPT_BRAGA_PATRIOTA = `Você é o Capitão Braga, ex-militar evangélico, direto e indignado.
Reescreva esta notícia em 4-6 linhas: primeiro o fato, depois seu comentário apaixonado.
Conecte ao impacto na família brasileira.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label no início. Comece direto com o conteúdo.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com a linha: Deus, Pátria e Família — sempre.
Responda APENAS com o texto da mensagem, nada mais.`;

const PROMPT_BRAGA_VIP = `Você é o Capitão Braga, ex-militar evangélico, analítico e contundente.
Crie um GANCHO forte na primeira linha que prenda a atenção imediatamente.
Em seguida escreva 5-7 linhas: fato + análise profunda + o que isso significa para o Brasil.
Mostre o que está por trás, o que a mídia não conta.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label antes do gancho. Comece direto com o gancho forte.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com a linha: Deus, Pátria e Família — sempre.
Responda APENAS com o texto da mensagem, nada mais.`;

const PROMPT_CAVALCANTI_ELITE = `Você é o Prof. Bernardo Cavalcanti, ex-professor da USP, consultor político global.
Escreva uma análise de 5-7 linhas com perspectiva conservadora e global.
Conecte ao cenário político mais amplo e, quando relevante, a movimentos como Milei, Trump, etc.
Use linguagem sofisticada mas acessível. Seja preciso e analítico, sem exagero emocional.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label. Comece direto com a análise.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com: Análise do Prof. Cavalcanti.
Responda APENAS com o texto da mensagem, nada mais.`;

interface Noticia {
  id: number;
  titulo: string;
  conteudo: string;
  fonte: string;
  url: string;
  data_publicacao: string;
  resumido: boolean;
  hash_conteudo: string;
}

interface NoticiaComResumos {
  id: number;
  titulo: string;
  conteudo: string;
  fonte: string;
  url: string;
  data_publicacao: string;
  resumido: boolean;
  hash_conteudo: string;
  resumo_braga_basico?: string;
  resumo_braga_patriota?: string;
  resumo_braga_vip?: string;
  resumo_cavalcanti_elite?: string;
}

async function gerarResumo(conteudo: string, prompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\nNotícia:\n${conteudo}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}

async function obterNoticiasNaoResumidas(): Promise<Noticia[]> {
  try {
    const noticias = await sql<Noticia[]>`
      SELECT 
        id, 
        titulo, 
        conteudo, 
        fonte, 
        url, 
        data_publicacao, 
        resumido,
        hash_conteudo
      FROM noticias 
      WHERE resumido = false 
        AND data_publicacao > NOW() - INTERVAL '6 hours'
      ORDER BY data_publicacao DESC
      LIMIT 50
    `;
    return noticias;
  } catch (error) {
    console.error("Erro ao buscar notícias:", error);
    throw error;
  }
}

async function atualizarNoticiaComResumos(
  noticiaId: number,
  resumos: {
    braga_basico?: string;
    braga_patriota?: string;
    braga_vip?: string;
    cavalcanti_elite?: string;
  }
): Promise<void> {
  try {
    await sql`
      UPDATE noticias 
      SET 
        resumo_braga_basico = ${resumos.braga_basico || null},
        resumo_braga_patriota = ${resumos.braga_patriota || null},
        resumo_braga_vip = ${resumos.braga_vip || null},
        resumo_cavalcanti_elite = ${resumos.cavalcanti_elite || null},
        resumido = true,
        data_resumo = NOW()
      WHERE id = ${noticiaId}
    `;
  } catch (error) {
    console.error(`Erro ao atualizar notícia ${noticiaId}:`, error);
    throw error;
  }
}

async function deduplicarNoticias(): Promise<number> {
  try {
    const resultado = await sql<{ count: number }[]>`
      WITH ranked AS (
        SELECT 
          id,
          ROW_NUMBER() OVER (PARTITION BY hash_conteudo ORDER BY data_publicacao DESC) as rn
        FROM noticias
        WHERE data_publicacao > NOW() - INTERVAL '6 hours'
          AND hash_conteudo IS NOT NULL
      )
      DELETE FROM noticias
      WHERE id IN (
        SELECT id FROM ranked WHERE rn > 1
      )
      RETURNING COUNT(*) as count
    `;
    
    return resultado.length > 0 ? resultado[0].count : 0;
  } catch (error) {
    console.error("Erro ao deduplicar notícias:", error);
    return 0;
  }
}

async function marcarDuplicatasComRemocao(): Promise<number> {
  try {
    const duplicatas = await sql<{ id: number }[]>`
      SELECT id FROM noticias n1
      WHERE data_publicacao > NOW() - INTERVAL '6 hours'
        AND EXISTS (
          SELECT 1 FROM noticias n2 
          WHERE n1.hash_conteudo = n2.hash_conteudo
            AND n1.id > n2.id
            AND n1.hash_conteudo IS NOT NULL
        )
    `;

    if (duplicatas.length > 0) {
      const ids = duplicatas.map((d) => d.id);
      await sql`
        DELETE FROM noticias 
        WHERE id = ANY(${ids})
      `;
      return duplicatas.length;
    }

    return 0;
  } catch (error) {
    console.error("Erro ao marcar duplicatas:", error);
    return 0;
  }
}

export async function GET(request: NextRequest) {
  try {
    const secret = request.headers.get("x-cron-secret");
    if (!verificarCronSecret(secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Passo 1: Deduplicar notícias
    console.log("Iniciando deduplicação de notícias...");
    const removidas = await marcarDuplicatasComRemocao();
    console.log(`${removidas} notícias duplicadas removidas`);

    // Passo 2: Buscar notícias não resumidas
    const noticias = await obterNoticiasNaoResumidas();
    console.log(`Encontradas ${noticias.length} notícias para resumir`);

    if (noticias.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Nenhuma notícia para resumir",
        duplicatasRemovidas: removidas,
      });
    }

    // Passo 3: Gerar resumos
    const resumosGerados: { noticiaId: number; success: boolean }[] = [];

    for (const noticia of noticias) {
      try {
        console.log(`Processando notícia ${noticia.id}: ${noticia.titulo}`);

        const resumos = await Promise.all([
          gerarResumo(noticia.conteudo, PROMPT_BRAGA_BASICO),
          gerarResumo(noticia.conteudo, PROMPT_BRAGA_PATRIOTA),
          gerarResumo(noticia.conteudo, PROMPT_BRAGA_VIP),
          gerarResumo(noticia.conteudo, PROMPT_CAVALCANTI_ELITE),
        ]);

        await atualizarNoticiaComResumos(noticia.id, {
          braga_basico: resumos[0],
          braga_patriota: resumos[1],
          braga_vip: resumos[2],
          cavalcanti_elite: resumos[3],
        });

        resumosGerados.push({ noticiaId: noticia.id, success: true });
        console.log(`Notícia ${noticia.id} resumida com sucesso`);
      } catch (error) {
        console.error(`Erro ao processar notícia ${noticia.id}:`, error);
        resumosGerados.push({ noticiaId: noticia.id, success: false });

        await alertarTelegram(
          `❌ Erro ao resumir notícia ${noticia