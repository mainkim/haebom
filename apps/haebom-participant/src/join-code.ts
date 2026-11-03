/** Same rule as the participant API join check. */
export const JOIN_CODE_PATTERN = /^[a-z0-9]{4,16}$/i;

/** Session key for the code the participant entered or opened. Not a Toss identifier. */
export const SESSION_JOIN_CODE_KEY = "haebom_join_code";

export function normalizeJoinCode(raw: string): string | null {
  const code = raw.trim();
  if (!JOIN_CODE_PATTERN.test(code)) return null;
  return code.toUpperCase();
}

export function joinCodeFromLocation(location: { pathname: string; search: string }): string | null {
  const parts = location.pathname.split("/").filter(Boolean);
  const marker = parts.indexOf("p");
  if (marker >= 0) {
    const fromPath = normalizeJoinCode(parts[marker + 1] ?? "");
    if (fromPath) return fromPath;
  }

  const params = new URLSearchParams(location.search);
  const fromJoinCode = params.get("joinCode");
  const fromCode = params.get("code");
  return normalizeJoinCode(fromJoinCode ?? "") ?? normalizeJoinCode(fromCode ?? "");
}

export function readStoredJoinCode(storage: { getItem(key: string): string | null }): string | null {
  const raw = storage.getItem(SESSION_JOIN_CODE_KEY);
  if (!raw) return null;
  return normalizeJoinCode(raw);
}

export function resolveJoinCode(
  location: { pathname: string; search: string },
  storage: { getItem(key: string): string | null }
): string | null {
  return joinCodeFromLocation(location) ?? readStoredJoinCode(storage);
}
