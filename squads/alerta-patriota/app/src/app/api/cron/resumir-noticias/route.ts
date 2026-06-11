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
Responda APENAS com o texto da análise, nada mais.`;

interface Noticia {
  id: number;
  titulo: string;
  conteudo: string;
  url: string;
  fonte: string;
  data_criacao: string;
  hash_conteudo: string;
}

interface Resumido {
  id: number;
  resumo_basico: string;
  resumo_patriota: string;
  resumo_vip: string;
  resumo_elite: string;
  processado_em: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Verificar secret do cron
    const secret = request.nextUrl.searchParams.get("secret");
    if (!verificarCronSecret(secret)) {
      return NextResponse.json(
        { erro: "Secret inválido" },
        { status: 401 }
      );
    }

    // Buscar notícias não processadas das últimas 6 horas
    const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    
    const noticias = await sql<Noticia[]>`
      SELECT id, titulo, conteudo, url, fonte, data_criacao, hash_conteudo
      FROM noticias
      WHERE data_criacao >= ${seisHorasAtras}
      AND id NOT IN (
        SELECT noticia_id FROM noticias_resumidas
      )
      GROUP BY id, titulo, conteudo, url, fonte, data_criacao, hash_conteudo
      LIMIT 100
    `;

    if (noticias.length === 0) {
      return NextResponse.json({
        mensagem: "Nenhuma notícia nova para processar",
        processadas: 0,
      });
    }

    const resumidas: Resumido[] = [];
    const erros: Array<{ id: number; erro: string }> = [];

    // Processar cada notícia
    for (const noticia of noticias) {
      try {
        const textoParaResumir = `Título: ${noticia.titulo}\n\nConteúdo: ${noticia.conteudo}`;

        // Gerar resumo básico
        const respostaBasica = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: `${PROMPT_BRAGA_BASICO}\n\nNotícia:\n${textoParaResumir}`,
            },
          ],
        });

        const resumoBasico =
          respostaBasica.content[0].type === "text"
            ? respostaBasica.content[0].text
            : "";

        // Gerar resumo patriota
        const respostaPatriota = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: `${PROMPT_BRAGA_PATRIOTA}\n\nNotícia:\n${textoParaResumir}`,
            },
          ],
        });

        const resumoPatriota =
          respostaPatriota.content[0].type === "text"
            ? respostaPatriota.content[0].text
            : "";

        // Gerar resumo VIP
        const respostaVip = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 700,
          messages: [
            {
              role: "user",
              content: `${PROMPT_BRAGA_VIP}\n\nNotícia:\n${textoParaResumir}`,
            },
          ],
        });

        const resumoVip =
          respostaVip.content[0].type === "text"
            ? respostaVip.content[0].text
            : "";

        // Gerar resumo elite
        const respostaElite = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 700,
          messages: [
            {
              role: "user",
              content: `${PROMPT_CAVALCANTI_ELITE}\n\nNotícia:\n${textoParaResumir}`,
            },
          ],
        });

        const resumoElite =
          respostaElite.content[0].type === "text"
            ? respostaElite.content[0].text
            : "";

        // Inserir na base de dados
        await sql`
          INSERT INTO noticias_resumidas (noticia_id, resumo_basico, resumo_patriota, resumo_vip, resumo_elite, processado_em, hash_conteudo)
          VALUES (${noticia.id}, ${resumoBasico}, ${resumoPatriota}, ${resumoVip}, ${resumoElite}, NOW(), ${noticia.hash_conteudo})
          ON CONFLICT (noticia_id) DO NOTHING
        `;

        resumidas.push({
          id: noticia.id,
          resumo_basico: resumoBasico,
          resumo_patriota: resumoPatriota,
          resumo_vip: resumoVip,
          resumo_elite: resumoElite,
          processado_em: new Date().toISOString(),
        });
      } catch (erro) {
        const mensagemErro = erro instanceof Error ? erro.message : String(erro);
        erros.push({
          id: noticia.id,
          erro: mensagemErro,
        });
        console.error(`Erro ao processar notícia ${noticia.id}:`, erro);
      }
    }

    // Alertar Telegram se houver erros
    if (erros.length > 0) {
      await alertarTelegram(
        `⚠️ Resumidor: ${erros.length} erros ao processar ${noticias.length} notícias`
      );
    }

    return NextResponse.json({
      mensagem: "Resumidor executado",
      processadas: resumidas.length,
      erros: erros.length,
      detalhes: {
        sucesso: resumidas.length,
        falhas: erros.length,
        erros: erros.slice(0, 5),
      },
    });
  } catch (erro) {
    console.error("Erro no resumidor:", erro);
    const mensagemErro = erro instanceof Error ? erro.message : String(erro);
    
    await alertarTelegram(
      `❌ Resumidor: Erro fatal - ${mensagemErro}`
    );

    return NextResponse.json(
      {
        erro: "Erro ao processar resumos",
        detalhes: mensagemErro,
      },
      { status: 500 }
    );
  }
}
```