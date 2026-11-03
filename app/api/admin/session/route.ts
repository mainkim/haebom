import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_MAX_AGE,
  adminCookie,
  adminSessionToken,
  authorizeAdmin,
  configuredAdminKey,
  secretsEqual
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: Request) {
  const decision = authorizeAdmin({
    cookieHeader: req.headers.get("cookie"),
    authorization: req.headers.get("authorization")
  });
  if (!decision.ok) return json({ error: decision.error }, decision.status);
  return json({ ok: true });
}

export async function POST(req: Request) {
  const key = configuredAdminKey();
  if (!key) return json({ error: "연구자 접근 키가 설정되지 않았습니다." }, 503);

  let presented = "";
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const candidate = (body as { key?: unknown }).key;
      if (typeof candidate === "string") presented = candidate.trim();
    }
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }

  if (!presented || !secretsEqual(presented, key)) {
    return json({ error: "인증에 실패했습니다." }, 401);
  }

  const res = json({ ok: true });
  res.cookies.set(adminCookie(adminSessionToken(key), ADMIN_COOKIE_MAX_AGE));
  return res;
}

export async function DELETE(_req: Request) {
  const res = json({ ok: true });
  res.cookies.set(adminCookie("", 0));
  return res;
}
