const BLOCKED_RESEARCH_FIELDS = new Set(["anonKey", "anonymousKey", "hash", "userKey"]);

/**
 * Participation requests use the anonymous participant id only.
 * The Toss anonymous key is an app-session identifier and must not be sent.
 */
export function buildParticipantRequestBody(
  action: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const payload: Record<string, unknown> = { action };
  for (const [key, value] of Object.entries(body)) {
    if (BLOCKED_RESEARCH_FIELDS.has(key)) continue;
    payload[key] = value;
  }
  return payload;
}
