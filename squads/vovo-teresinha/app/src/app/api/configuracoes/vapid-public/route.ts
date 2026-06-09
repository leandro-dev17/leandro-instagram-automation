import { NextResponse } from "next/server";

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return NextResponse.json({ erro: "VAPID não configurado" }, { status: 404 });
  }
  return NextResponse.json({ vapidPublicKey: key });
}
