import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** httpOnly session cookie. The value is an HMAC, not the admin key. */
export const ADMIN_COOKIE = "haebom_admin";

export const MIN_ADMIN_KEY_LENGTH = 16;

export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 14;

const SESSION_LABEL = "haebom-admin-v1";

export type AdminEnv = {
  HAEBOM_ADMIN_KEY?: string;
};

export type AdminDecision =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/** Empty or short keys are treated as unset so a weak placeholder cannot unlock the API. */
export function configuredAdminKey(env?: AdminEnv | NodeJS.ProcessEnv): string | null {
  const raw = (env ?? process.env).HAEBOM_ADMIN_KEY;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key.length < MIN_ADMIN_KEY_LENGTH) return null;
  return key;
}

export function adminSessionToken(key: string): string {
  return createHmac("sha256", key).update(SESSION_LABEL).digest("base64url");
}

/** SHA-256 both sides so unequal lengths still compare in constant time. */
export function secretsEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value || null;
  }
  return null;
}

function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  return match?.[1] ?? null;
}

export function authorizeAdmin(input: {
  cookieHeader: string | null;
  authorization: string | null;
  env?: AdminEnv;
}): AdminDecision {
  const key = configuredAdminKey(input.env);
  if (!key) {
    return { ok: false, status: 503, error: "연구자 접근 키가 설정되지 않았습니다." };
  }
  const bearer = bearerToken(input.authorization);
  const cookie = readCookie(input.cookieHeader, ADMIN_COOKIE);
  const bearerOk = bearer !== null && secretsEqual(bearer, key);
  const cookieOk = cookie !== null && secretsEqual(cookie, adminSessionToken(key));
  if (bearerOk || cookieOk) return { ok: true };
  return { ok: false, status: 401, error: "인증이 필요합니다." };
}

export function adminCookie(value: string, maxAge: number) {
  return {
    name: ADMIN_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}
