/**
 * Facebook Pages API — lib de integração
 * Usa a Pages API para postar na página do Capitão Braga.
 * A sessão de login é mantida via token de longa duração.
 */

const FB_PAGE_ID    = process.env.FB_PAGE_ID    || "";
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN  || "";
const FB_API        = "https://graph.facebook.com/v21.0";

export async function publicarPostFacebook(mensagem: string, link?: string): Promise<{ id?: string; erro?: string }> {
  if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return { erro: "Credenciais Facebook não configuradas" };

  const body: Record<string, string> = {
    message:      mensagem,
    access_token: FB_PAGE_TOKEN,
  };
  if (link) body.link = link;

  try {
    const res = await fetch(`${FB_API}/${FB_PAGE_ID}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data.error) return { erro: data.error.message };
    return { id: data.id };
  } catch (err) {
    return { erro: String(err) };
  }
}

export async function buscarComentariosNaoRespondidos(): Promise<Array<{
  id: string; mensagem: string; autor: string; postId: string;
}>> {
  if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return [];

  try {
    // Busca posts recentes da página
    const postsRes = await fetch(
      `${FB_API}/${FB_PAGE_ID}/posts?fields=id,created_time&limit=5&access_token=${FB_PAGE_TOKEN}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const posts = await postsRes.json();
    if (!posts.data) return [];

    const comentarios: Array<{ id: string; mensagem: string; autor: string; postId: string }> = [];

    for (const post of posts.data) {
      const comRes = await fetch(
        `${FB_API}/${post.id}/comments?fields=id,message,from,can_reply_privately&filter=stream&access_token=${FB_PAGE_TOKEN}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const coms = await comRes.json();
      if (!coms.data) continue;

      for (const c of coms.data) {
        // Só comentários não respondidos pela página
        if (c.from?.id !== FB_PAGE_ID) {
          comentarios.push({
            id:       c.id,
            mensagem: c.message || "",
            autor:    c.from?.name || "Usuário",
            postId:   post.id,
          });
        }
      }
    }

    return comentarios.slice(0, 20); // máximo 20 por ciclo
  } catch {
    return [];
  }
}

export async function responderComentario(comentarioId: string, resposta: string): Promise<boolean> {
  if (!FB_PAGE_TOKEN) return false;
  try {
    const res = await fetch(`${FB_API}/${comentarioId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: resposta, access_token: FB_PAGE_TOKEN }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return !data.error;
  } catch {
    return false;
  }
}

export async function verificarTokenFacebook(): Promise<{ valido: boolean; expira?: string }> {
  if (!FB_PAGE_TOKEN) return { valido: false };
  try {
    const res = await fetch(`${FB_API}/debug_token?input_token=${FB_PAGE_TOKEN}&access_token=${FB_PAGE_TOKEN}`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (data.data?.is_valid) {
      const expira = data.data.expires_at
        ? new Date(data.data.expires_at * 1000).toLocaleDateString("pt-BR")
        : "Nunca (token permanente)";
      return { valido: true, expira };
    }
    return { valido: false };
  } catch {
    return { valido: false };
  }
}
