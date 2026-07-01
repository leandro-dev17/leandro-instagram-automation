import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET!;
const COOKIE_NAME = process.env.COOKIE_NAME || "vovo-session";

export type JWTPayload = {
  id: number;
  email: string;
  tipo_usuario: "free" | "premium" | "aluna_leandro" | "admin";
  nome: string;
};

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(senha: string): Promise<string> {
  return bcrypt.hash(senha, 12);
}

export async function comparePassword(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function getSessionFromRequest(req: NextRequest): JWTPayload | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function cookieOptions() {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  };
}

export function isTrialActive(trial_fim: string | null): boolean {
  if (!trial_fim) return false;
  return new Date(trial_fim) > new Date();
}

export function trialDaysLeft(trial_fim: string | null): number {
  if (!trial_fim) return 0;
  const diff = new Date(trial_fim).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function isPremium(tipo: string, trial_fim: string | null, plano?: string | null): boolean {
  if (tipo === "aluna_leandro" || tipo === "admin") return true;
  if (tipo === "premium" && plano !== "caderninho") return true;
  if (tipo === "free" && isTrialActive(trial_fim)) return true;
  return false;
}

export function isBasico(tipo: string, plano?: string | null): boolean {
  return tipo === "premium" && plano === "caderninho";
}

export class WebhookValidationError extends Error {
  constructor(
    public code: string,
    public statusCode: number
  ) {
    super(code);
    this.name = "WebhookValidationError";
  }
}

export function validateMercadoPagoWebhook(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new WebhookValidationError("webhook_mp_payload_required", 400);
  }
  if (!("id" in payload || "type" in payload || "data" in payload)) {
    throw new WebhookValidationError("webhook_mp_invalid_structure", 400);
  }
  return true;
}

export function extractMercadoPagoSignature(headers: Record<string, string | string[]>): string {
  const signature = headers["x-signature"] || headers["X-Signature"];

  if (!signature) {
    throw new WebhookValidationError("webhook_mp_signature_missing", 401);
  }

  const signatureStr = Array.isArray(signature) ? signature[0] : signature;

  if (typeof signatureStr !== "string" || signatureStr.trim().length === 0) {
    throw new WebhookValidationError("webhook_mp_signature_invalid", 401);
  }

  return signatureStr.trim();
}

export function validateMercadoPagoSignature(
  signature: string,
  requestId: string,
  secret: string
): boolean {
  if (!signature || !requestId || !secret) {
    throw new WebhookValidationError("webhook_mp_validation_params_missing", 403);
  }

  const crypto = require("crypto");
  const data = `id=${requestId}`;
  const hash = crypto.createHmac("sha256", secret).update(data).digest("hex");

  return signature === hash;
}
