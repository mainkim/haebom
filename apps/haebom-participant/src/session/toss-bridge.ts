import { Storage, User } from "@apps-in-toss/web-framework";
import { createAnonymousKeyReader } from "./anonymous-key";
import type { ProgressStore } from "./progress";

/**
 * One getAnonymousKey call for this page. Outside the Toss app the SDK throws;
 * readAnonymousKey turns that into null so browser dev and tests still run.
 * https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/user/user.getanonymouskey
 */
export const readTossAnonymousKey = createAnonymousKeyReader(() => User.getAnonymousKey());

export function tossNativeProgressStore(): ProgressStore | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & { ReactNativeWebView?: unknown };
  if (host.ReactNativeWebView == null) return null;
  return {
    getItem: (key) => Storage.getItem(key),
    setItem: (key, value) => Storage.setItem(key, value)
  };
}
