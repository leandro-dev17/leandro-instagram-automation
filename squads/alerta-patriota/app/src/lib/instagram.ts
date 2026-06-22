/**
 * Instagram Graph API — Alerta Patriota
 * Conta: @roberto.braga.alerta.patriota
 * Credenciais via variáveis de ambiente (preenchidas após criar o App Meta)
 */

const IG_USER_ID    = process.env.IG_USER_ID    || "";   // ID numérico da conta
const IG_TOKEN      = process.env.IG_ACCESS_TOKEN || "";  // Token de longa duração
const IG_API        = "https://graph.facebook.com/v21.0";
const APP_URL       = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

// ── PUBLICAR REEL (vídeo MP4 via URL pública) ──────────────────────────────

export async function publicarReel(videoUrl: string, legenda: string): Promise<{ id?: string; erro?: string }> {
  if (!IG_USER_ID || !IG_TOKEN) return { erro: "Credenciais Instagram não configuradas (IG_USER_ID, IG_ACCESS_TOKEN)" };

  try {
    // Passo 1: criar container de mídia
    const container = await fetch(`${IG_API}/${IG_USER_ID}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type:   "REELS",
        video_url:    videoUrl,
        caption:      legenda,
        share_to_feed: true,
        access_token: IG_TOKEN,
      }),
    });
    const c = await container.json();
    if (c.error) return { erro: c.error.message };

    // Aguarda processamento do vídeo (máx 60s)
    await aguardarProcessamento(c.id);

    // Passo 2: publicar
    const pub = await fetch(`${IG_API}/${IG_USER_ID}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: c.id, access_token: IG_TOKEN }),
    });
    const p = await pub.json();
    if (p.error) return { erro: p.error.message };
    return { id: p.id };
  } catch (err) {
    return { erro: String(err) };
  }
}

// ── PUBLICAR STORY (vídeo MP4) ─────────────────────────────────────────────

export async function publicarStory(videoUrl: string): Promise<{ id?: string; erro?: string }> {
  if (!IG_USER_ID || !IG_TOKEN) return { erro: "Credenciais Instagram não configuradas" };

  try {
    const container = await fetch(`${IG_API}/${IG_USER_ID}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type:  "VIDEO",
        video_url:   videoUrl,
        media_category: "STORIES",
        access_token: IG_TOKEN,
      }),
    });
    const c = await container.json();
    if (c.error) return { erro: c.error.message };

    await aguardarProcessamento(c.id);

    const pub = await fetch(`${IG_API}/${IG_USER_ID}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: c.id, access_token: IG_TOKEN }),
    });
    const p = await pub.json();
    if (p.error) return { erro: p.error.message };
    return { id: p.id };
  } catch (err) {
    return { erro: String(err) };
  }
}

// ── BUSCAR COMENTÁRIOS RECENTES ────────────────────────────────────────────

export async function buscarComentariosIG(): Promise<Array<{
  id: string; texto: string; autor: string; mediaId: string;
}>> {
  if (!IG_USER_ID || !IG_TOKEN) return [];

  try {
    // Busca mídias recentes
    const midiasRes = await fetch(
      `${IG_API}/${IG_USER_ID}/media?fields=id,timestamp&limit=5&access_token=${IG_TOKEN}`
    );
    const midias = await midiasRes.json();
    if (!midias.data) return [];

    const comentarios: Array<{ id: string; texto: string; autor: string; mediaId: string }> = [];

    for (const m of midias.data) {
      const comRes = await fetch(
        `${IG_API}/${m.id}/comments?fields=id,text,username,timestamp&access_token=${IG_TOKEN}`
      );
      const coms = await comRes.json();
      if (!coms.data) continue;

      for (const c of coms.data) {
        comentarios.push({ id: c.id, texto: c.text || "", autor: c.username || "usuário", mediaId: m.id });
      }
    }

    return comentarios.slice(0, 30);
  } catch {
    return [];
  }
}

// ── RESPONDER COMENTÁRIO ───────────────────────────────────────────────────

export async function responderComentarioIG(comentarioId: string, mediaId: string, resposta: string): Promise<boolean> {
  if (!IG_TOKEN) return false;
  try {
    const res = await fetch(`${IG_API}/${mediaId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: resposta, access_token: IG_TOKEN }),
    });
    const d = await res.json();
    return !d.error;
  } catch {
    return false;
  }
}

// ── ENVIAR DM ─────────────────────────────────────────────────────────────

export async function enviarDMInstagram(recipientId: string, mensagem: string): Promise<boolean> {
  if (!IG_TOKEN) return false;
  try {
    const res = await fetch(`${IG_API}/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message:   { text: mensagem },
        access_token: IG_TOKEN,
      }),
    });
    const d = await res.json();
    return !d.error;
  } catch {
    return false;
  }
}

// ── ATUALIZAR BIO / LINK ────────────────────────────────────────────────────

export async function atualizarBioLink(novoLink: string): Promise<boolean> {
  if (!IG_USER_ID || !IG_TOKEN) return false;
  try {
    const res = await fetch(`${IG_API}/${IG_USER_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website: novoLink, access_token: IG_TOKEN }),
    });
    const d = await res.json();
    return !d.error;
  } catch {
    return false;
  }
}

// ── VERIFICAR TOKEN ────────────────────────────────────────────────────────

export async function verificarTokenIG(): Promise<{ valido: boolean; expira?: string; usuario?: string }> {
  if (!IG_TOKEN) return { valido: false };
  try {
    const res = await fetch(`${IG_API}/debug_token?input_token=${IG_TOKEN}&access_token=${IG_TOKEN}`);
    const d = await res.json();
    if (d.data?.is_valid) {
      const expira = d.data.expires_at
        ? new Date(d.data.expires_at * 1000).toLocaleDateString("pt-BR")
        : "Nunca";
      return { valido: true, expira, usuario: "@roberto.braga.alerta.patriota" };
    }
    return { valido: false };
  } catch {
    return { valido: false };
  }
}

// ── HELPERS ────────────────────────────────────────────────────────────────

async function aguardarProcessamento(containerId: string, tentativas = 12): Promise<void> {
  for (let i = 0; i < tentativas; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`${IG_API}/${containerId}?fields=status_code&access_token=${IG_TOKEN}`);
    const d = await res.json();
    if (d.status_code === "FINISHED") return;
    if (d.status_code === "ERROR")    throw new Error("Instagram rejeitou o vídeo");
  }
  throw new Error("Timeout aguardando processamento do vídeo no Instagram");
}

export function buildLegendaReel(titulo: string, noticiaId: number, hashtagsExtras = ""): string {
  return `🇧🇷 ${titulo}

Análise completa do Capitão Braga no link da bio 👆

${APP_URL}/noticias/${noticiaId}

#AlertaPatriota #Brasil #SemFiltro #DeusPátriaFamília #Conservador #BrasilConservador ${hashtagsExtras}`.trim();
}

export function buildLegendaStory(noticiaId: number): string {
  return `Ver análise completa → ${APP_URL}/noticias/${noticiaId}`;
}
