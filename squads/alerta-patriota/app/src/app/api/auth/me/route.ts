import { NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";

export async function GET() {
  try {
    const usuario = await getUsuarioLogado();
    if (!usuario) {
      return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    }
    const { senha_hash: _hash, ...dados } = usuario;
    void _hash;
    return NextResponse.json({ usuario: dados });
  } catch {
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
