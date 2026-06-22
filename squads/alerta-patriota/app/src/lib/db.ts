import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida — configure o .env.local");
}

export const sql = neon(process.env.DATABASE_URL);

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type Plano = "vip" | "elite";
export type StatusUsuario = "trial" | "ativo" | "inadimplente" | "cancelado";
export type TipoUsuario = "membro" | "admin";

export type Usuario = {
  id: number;
  nome: string;
  email: string;
  senha_hash: string;
  telefone: string | null;
  plano: Plano | null;
  status: StatusUsuario;
  tipo_usuario: TipoUsuario;
  mp_subscription_id: string | null;
  mp_customer_id: string | null;
  trial_inicio: string | null;
  trial_fim: string | null;
  assinatura_inicio: string | null;
  assinatura_fim: string | null;
  created_at: string;
  updated_at: string;
};

export type Assinatura = {
  id: number;
  usuario_id: number;
  plano: Plano;
  valor: number;
  ciclo: "mensal" | "anual";
  status: "ativa" | "cancelada" | "inadimplente";
  mp_subscription_id: string | null;
  created_at: string;
};

export type Pagamento = {
  id: number;
  assinatura_id: number;
  usuario_id: number;
  valor: number;
  status: "aprovado" | "pendente" | "rejeitado" | "reembolsado";
  mp_payment_id: string | null;
  metodo: "cartao" | "pix" | null;
  created_at: string;
};

export type GrupoWhatsApp = {
  id: number;
  nome: string;
  plano: Plano;
  link_convite: string | null;
  group_id_wa: string | null;
  max_membros: number;
  membros_ativos: number;
  ativo: boolean;
  created_at: string;
};

export type MembroGrupo = {
  id: number;
  usuario_id: number;
  grupo_id: number;
  data_entrada: string;
  data_saida: string | null;
  status: "ativo" | "removido";
};

export type Noticia = {
  id: number;
  titulo: string;
  fonte: string;
  url: string | null;
  conteudo_original: string | null;
  resumo_braga: string | null;
  resumo_cavalcanti: string | null;
  categoria: string | null;
  urgente: boolean;
  postada_vip: boolean;
  postada_elite: boolean;
  postada_vip_at: string | null;
  postada_elite_at: string | null;
  created_at: string;
};

export type PostWhatsApp = {
  id: number;
  grupo_id: number;
  noticia_id: number | null;
  conteudo: string;
  tipo: "noticia" | "urgente" | "termometro" | "analise" | "dossie" | "fomo" | "boas_vindas" | "moderacao";
  status: "enviado" | "erro";
  enviado_at: string;
};

export type AgenteLog = {
  id: number;
  agente: string;
  acao: string;
  status: "sucesso" | "erro" | "aviso";
  detalhes: Record<string, unknown> | null;
  duracao_ms: number | null;
  created_at: string;
};

export type Alerta = {
  id: number;
  tipo: string;
  severidade: "critico" | "alto" | "medio" | "baixo";
  mensagem: string;
  resolvido: boolean;
  resolvido_at: string | null;
  created_at: string;
};
