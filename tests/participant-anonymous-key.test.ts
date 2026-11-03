import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANONYMOUS_KEY_STORAGE_KEY,
  createAnonymousKeyReader,
  readAnonymousKey,
  saveAnonymousKey,
  withDeadline
} from "../apps/haebom-participant/src/session/anonymous-key";
import {
  PROGRESS_STORAGE_KEY,
  localProgressStore,
  memoryProgressStore,
  mergeLegacySession,
  openProgressStore,
  parseProgress,
  rememberJoinCode,
  rememberParticipant,
  restoreProgress,
  writeProgress
} from "../apps/haebom-participant/src/session/progress";
import { SESSION_JOIN_CODE_KEY } from "../apps/haebom-participant/src/join-code";
import { buildParticipantRequestBody } from "../apps/haebom-participant/src/research-body";

const HASH = "anon-hash-not-a-participant";
const PARTICIPANT = "par_0123abcd0123abcd";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    }
  };
}

describe("anonymous key", () => {
  it("keeps a HASH result and ignores error, empty, and thrown results without retrying", async () => {
    assert.equal(await readAnonymousKey(async () => ({ type: "HASH", hash: HASH })), HASH);
    assert.equal(await readAnonymousKey(async () => ({ type: "HASH", hash: "  " })), null);
    assert.equal(await readAnonymousKey(async () => "ERROR"), null);
    assert.equal(await readAnonymousKey(async () => undefined), null);
    assert.equal(
      await readAnonymousKey(async () => {
        throw new Error("not in toss webview");
      }),
      null
    );

    let calls = 0;
    const reader = createAnonymousKeyReader(async () => {
      calls += 1;
      if (calls === 1) throw new Error("bridge down");
      return { type: "HASH", hash: HASH };
    });
    assert.equal(await reader(), null);
    assert.equal(await reader(), null);
    assert.equal(calls, 1);
  });

  it("stores the key apart from participation progress", async () => {
    const store = memoryProgressStore();
    await saveAnonymousKey(store, HASH);
    const progress = rememberParticipant(rememberJoinCode(parseProgress(null), "AB12CD"), "AB12CD", PARTICIPANT);
    await writeProgress(store, progress);

    const rawProgress = await store.getItem(PROGRESS_STORAGE_KEY);
    assert.equal(rawProgress?.includes(HASH), false);
    assert.equal(rawProgress?.includes(PARTICIPANT), true);
    assert.equal(await store.getItem(ANONYMOUS_KEY_STORAGE_KEY), HASH);
    assert.equal(JSON.stringify(progress).includes(HASH), false);
  });

  it("stops waiting when the bridge does not answer", async () => {
    const started = Date.now();
    const value = await withDeadline(new Promise<string>(() => undefined), 20, null);
    assert.equal(value, null);
    assert.ok(Date.now() - started < 500);
  });
});

describe("participant progress persistence", () => {
  it("restores the same participant after the page store is reopened", async () => {
    const backing = memoryStorage();
    const first = localProgressStore(backing);
    await writeProgress(
      first,
      rememberParticipant(rememberJoinCode(parseProgress(null), "326E8565"), "326E8565", PARTICIPANT)
    );

    const reopened = await restoreProgress({ local: localProgressStore(backing) });
    assert.equal(reopened.joinCode, "326E8565");
    assert.equal(reopened.participantIds["326E8565"], PARTICIPANT);
  });

  it("copies a sessionStorage participation forward and drops an invalid id", () => {
    const session = memoryStorage({
      [SESSION_JOIN_CODE_KEY]: "ab12cd",
      haebom_participant_AB12CD: PARTICIPANT,
      haebom_participant_BAD: "user_1"
    });
    const merged = mergeLegacySession(parseProgress(null), session);
    assert.equal(merged.joinCode, "AB12CD");
    assert.equal(merged.participantIds.AB12CD, PARTICIPANT);
    assert.equal(merged.participantIds.BAD, undefined);

    const stored = rememberParticipant(rememberJoinCode(parseProgress(null), "AB12CD"), "AB12CD", PARTICIPANT);
    const stale = memoryStorage({
      [SESSION_JOIN_CODE_KEY]: "AB12CD",
      haebom_participant_AB12CD: "par_ffffffffffff"
    });
    assert.equal(mergeLegacySession(stored, stale).participantIds.AB12CD, PARTICIPANT);
    const invalid = memoryStorage({
      [SESSION_JOIN_CODE_KEY]: "AB12CD",
      haebom_participant_AB12CD: "user_1"
    });
    assert.equal(mergeLegacySession(parseProgress(null), invalid).participantIds.AB12CD, undefined);
  });

  it("uses native storage when local storage is empty, and keeps local storage when native fails", async () => {
    const local = memoryStorage();
    let nativeReads = 0;
    const restored = await restoreProgress({
      local: localProgressStore(local),
      readNative: async () => {
        nativeReads += 1;
        return JSON.stringify({ joinCode: "AB12CD", participantIds: { AB12CD: PARTICIPANT } });
      }
    });
    assert.equal(nativeReads, 1);
    assert.equal(restored.participantIds.AB12CD, PARTICIPANT);

    const filled = memoryStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify({ joinCode: "KEEP01", participantIds: { KEEP01: PARTICIPANT } })
    });
    let skipped = 0;
    const kept = await restoreProgress({
      local: localProgressStore(filled),
      readNative: async () => {
        skipped += 1;
        return JSON.stringify({ joinCode: "OTHER1", participantIds: {} });
      }
    });
    assert.equal(skipped, 0);
    assert.equal(kept.joinCode, "KEEP01");

    const store = openProgressStore({
      local: localProgressStore(memoryStorage()),
      native: {
        async getItem() {
          throw new Error("bridge missing");
        },
        async setItem() {
          throw new Error("bridge missing");
        }
      }
    });
    await writeProgress(store, rememberJoinCode(parseProgress(null), "AB12CD"));
    assert.equal((await restoreProgress({ local: store })).joinCode, "AB12CD");
  });
});

describe("research request body", () => {
  it("sends the participant id and leaves the anonymous key out", () => {
    const body = buildParticipantRequestBody("runtime", {
      participantId: PARTICIPANT,
      hash: HASH,
      anonKey: HASH,
      anonymousKey: HASH,
      userKey: HASH
    });
    assert.equal(body.action, "runtime");
    assert.equal(body.participantId, PARTICIPANT);
    assert.equal("hash" in body, false);
    assert.equal("anonKey" in body, false);
    assert.equal("anonymousKey" in body, false);
    assert.equal("userKey" in body, false);
    assert.equal(JSON.stringify(body).includes(HASH), false);
  });
});
