import { NextResponse } from "next/server";

const COOKIE_NAME = process.env.COOKIE_NAME || "vovo-session";

export async function POST() {
  const res = NextResponse.json({ dados: { ok: true } });
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
