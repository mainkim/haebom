/**
 * Participant miniapp CORS.
 *
 * Defaults follow Apps in Toss FAQ (SDK 3.1.0+ and 1.x–2.x):
 * https://<appName>.apps.tossmini.com
 * https://<appName>.private-apps.tossmini.com
 * https://developers-apps-in-toss.toss.im/guide/faq
 *
 * SDK 3.0.0–3.0.x used *.web.tossmini.com. Those hosts are not guessed here.
 * Add them through HAEBOM_PARTICIPANT_CORS_ORIGINS if a 3.0.x bundle is still served.
 */

export const DEFAULT_PARTICIPANT_CORS_PATTERNS = [
  "https://<appName>.apps.tossmini.com",
  "https://<appName>.private-apps.tossmini.com"
] as const;

const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export type ParticipantCorsEnv = {
  HAEBOM_AIT_APP_NAME?: string;
  HAEBOM_PARTICIPANT_CORS_ORIGINS?: string;
};

function corsEnv(env?: ParticipantCorsEnv): ParticipantCorsEnv {
  if (env) return env;
  return {
    HAEBOM_AIT_APP_NAME: process.env.HAEBOM_AIT_APP_NAME,
    HAEBOM_PARTICIPANT_CORS_ORIGINS: process.env.HAEBOM_PARTICIPANT_CORS_ORIGINS
  };
}

export function participantCorsPatterns(env?: ParticipantCorsEnv): string[] {
  const raw = corsEnv(env).HAEBOM_PARTICIPANT_CORS_ORIGINS?.trim();
  if (!raw) return [...DEFAULT_PARTICIPANT_CORS_PATTERNS];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function participantAppName(env?: ParticipantCorsEnv): string | undefined {
  const name = corsEnv(env).HAEBOM_AIT_APP_NAME?.trim();
  if (!name || !APP_NAME_RE.test(name)) return undefined;
  return name;
}

export function expandCorsPattern(pattern: string, appName: string | undefined): string | null {
  if (!pattern.includes("<appName>")) return pattern;
  if (!appName) return null;
  return pattern.replaceAll("<appName>", appName);
}

export function originAllowed(
  origin: string,
  patterns: string[],
  appName: string | undefined
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;

  for (const pattern of patterns) {
    const expanded = expandCorsPattern(pattern, appName);
    if (!expanded) continue;
    if (expanded === origin) return true;

    const wildcard = expanded.match(/^https:\/\/\*(\.[a-z0-9.-]+)$/i);
    if (!wildcard) continue;
    if (parsed.protocol !== "https:" || parsed.port) continue;
    const suffix = wildcard[1].toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith(suffix)) continue;
    const label = host.slice(0, host.length - suffix.length);
    if (HOST_LABEL_RE.test(label)) return true;
  }
  return false;
}

export function participantCorsHeaders(origin: string | null, env?: ParticipantCorsEnv): Headers {
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  if (!origin) return headers;
  const allowed = originAllowed(origin, participantCorsPatterns(env), participantAppName(env));
  if (!allowed) return headers;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  return headers;
}

function sameOriginAsRequest(origin: string, requestUrl: string | undefined): boolean {
  if (!requestUrl) return false;
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}

/**
 * No Origin header is allowed (non-browser clients and same-origin navigations).
 * A browser on this deployment sends the page's own origin; that is not a Toss host,
 * so it is accepted only when it matches the request URL. Cross-origin browsers still
 * need the Toss allowlist. CORS response headers are unchanged.
 */
export function participantOriginAllowed(
  origin: string | null,
  env?: ParticipantCorsEnv,
  requestUrl?: string
): boolean {
  if (!origin) return true;
  if (sameOriginAsRequest(origin, requestUrl)) return true;
  return originAllowed(origin, participantCorsPatterns(env), participantAppName(env));
}
