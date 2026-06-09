import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const sql = neon(process.env.DATABASE_URL);

export type Usuario = {
  id: number;
  nome: string;
  email: string;
  senha_hash: string;
  whatsapp: string | null;
  aceita_whatsapp: boolean;
  tipo_usuario: "free" | "premium" | "aluna_leandro" | "admin";
  plano: string | null;
  trial_inicio: string | null;
  trial_fim: string | null;
  assinatura_id: string | null;
  stripe_customer_id: string | null;
  created_at: string;
};

export type Receita = {
  id: number;
  titulo: string;
  descricao: string;
  categoria: string;
  tags_restricao: string[];
  ingredientes: string;
  modo_preparo: string;
  tempo_preparo: number;
  calorias: number | null;
  porcoes: number;
  foto_url: string | null;
  is_premium: boolean;
  is_free_rotativa: boolean;
  is_personal: boolean;
  created_at: string;
};

export type Favorito = {
  id: number;
  usuario_id: number;
  receita_id: number;
  created_at: string;
};

export type ListaCompras = {
  id: number;
  usuario_id: number;
  item: string;
  checked: boolean;
  created_at: string;
};

export type PlanoSemanal = {
  id: number;
  usuario_id: number;
  semana: string;
  segunda: string | null;
  terca: string | null;
  quarta: string | null;
  quinta: string | null;
  sexta: string | null;
  sabado: string | null;
  domingo: string | null;
};

export type Afiliado = {
  id: number;
  usuario_id: number;
  codigo: string;
  cpf: string | null;
  pix_chave: string | null;
  tier: number;
  created_at: string;
};

export type Assinatura = {
  id: number;
  usuario_id: number;
  plano: string;
  status: string;
  mp_subscription_id: string | null;
  mp_payment_id: string | null;
  valor: number;
  created_at: string;
};
