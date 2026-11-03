import type { ProgressStore } from "./progress";

/**
 * Non-game anonymous key.
 * User.getAnonymousKey resolves `{ type: "HASH", hash }` and throws outside the Toss app.
 * The deprecated getAnonymousKey returns "ERROR" or undefined instead of throwing.
 * https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/user/user.getanonymouskey
 * https://developers-apps-in-toss.toss.im/documentation/common/authentication/hash-key
 */
export type AnonymousKeyResult = { type?: string; hash?: unknown } | "ERROR" | undefined | null;

export type AnonymousKeySource = () => Promise<AnonymousKeyResult>;

/** Client-only. Never copy this value into a research request. */
export const ANONYMOUS_KEY_STORAGE_KEY = "haebom.anonKey";

export async function readAnonymousKey(source: AnonymousKeySource): Promise<string | null> {
  try {
    const result = await source();
    if (!result || result === "ERROR" || typeof result !== "object") return null;
    if (result.type !== "HASH" || typeof result.hash !== "string") return null;
    const hash = result.hash.trim();
    return hash.length > 0 ? hash : null;
  } catch {
    return null;
  }
}

/** One bridge call per page load. A failure is not retried. */
export function createAnonymousKeyReader(source: AnonymousKeySource): () => Promise<string | null> {
  let pending: Promise<string | null> | null = null;
  return () => (pending ??= readAnonymousKey(source));
}

export async function saveAnonymousKey(store: ProgressStore, hash: string): Promise<void> {
  await store.setItem(ANONYMOUS_KEY_STORAGE_KEY, hash);
}

export function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}
