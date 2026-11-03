import { SESSION_JOIN_CODE_KEY, normalizeJoinCode } from "../join-code";
import { withDeadline } from "./anonymous-key";

/** Same shape the participant API accepts. */
const PARTICIPANT_ID_PATTERN = /^par_[a-f0-9]{8,64}$/i;

export const PROGRESS_STORAGE_KEY = "haebom.participant.progress";

export type ParticipantProgress = {
  joinCode: string | null;
  participantIds: Record<string, string>;
};

export type ProgressStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function emptyProgress(): ParticipantProgress {
  return { joinCode: null, participantIds: {} };
}

export function parseProgress(raw: string | null): ParticipantProgress {
  if (!raw) return emptyProgress();
  try {
    const parsed = JSON.parse(raw) as { joinCode?: unknown; participantIds?: unknown };
    const progress = emptyProgress();
    if (typeof parsed.joinCode === "string") {
      progress.joinCode = normalizeJoinCode(parsed.joinCode);
    }
    if (parsed.participantIds && typeof parsed.participantIds === "object" && !Array.isArray(parsed.participantIds)) {
      for (const [code, id] of Object.entries(parsed.participantIds)) {
        const joinCode = normalizeJoinCode(code);
        if (!joinCode || typeof id !== "string" || !PARTICIPANT_ID_PATTERN.test(id)) continue;
        progress.participantIds[joinCode] = id;
      }
    }
    return progress;
  } catch {
    return emptyProgress();
  }
}

export function rememberJoinCode(progress: ParticipantProgress, joinCode: string): ParticipantProgress {
  const code = normalizeJoinCode(joinCode);
  if (!code) return progress;
  return { joinCode: code, participantIds: progress.participantIds };
}

export function rememberParticipant(
  progress: ParticipantProgress,
  joinCode: string,
  participantId: string
): ParticipantProgress {
  const code = normalizeJoinCode(joinCode);
  if (!code || !PARTICIPANT_ID_PATTERN.test(participantId)) return progress;
  return {
    joinCode: code,
    participantIds: { ...progress.participantIds, [code]: participantId }
  };
}

export function mergeProgress(base: ParticipantProgress, extra: ParticipantProgress): ParticipantProgress {
  return {
    joinCode: base.joinCode ?? extra.joinCode,
    participantIds: { ...extra.participantIds, ...base.participantIds }
  };
}

export function mergeLegacySession(
  progress: ParticipantProgress,
  session: { getItem(key: string): string | null }
): ParticipantProgress {
  const joinCode = progress.joinCode ?? normalizeJoinCode(session.getItem(SESSION_JOIN_CODE_KEY) ?? "");
  const next = joinCode ? rememberJoinCode(progress, joinCode) : progress;
  if (!joinCode) return next;
  const legacyId = session.getItem(`haebom_participant_${joinCode}`);
  if (!legacyId || next.participantIds[joinCode]) return next;
  return rememberParticipant(next, joinCode, legacyId);
}

export function progressIsEmpty(progress: ParticipantProgress): boolean {
  return progress.joinCode == null && Object.keys(progress.participantIds).length === 0;
}

export async function writeProgress(store: ProgressStore, progress: ParticipantProgress): Promise<void> {
  await store.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

/**
 * localStorage is the fast copy. SDK Storage is read once when that copy is empty,
 * because Storage survives closing the miniapp.
 * https://developers-apps-in-toss.toss.im/documentation/common/file-storage/storage
 */
export async function restoreProgress(options: {
  local: ProgressStore;
  session?: { getItem(key: string): string | null };
  readNative?: () => Promise<string | null>;
  nativeTimeoutMs?: number;
}): Promise<ParticipantProgress> {
  let progress = parseProgress(await options.local.getItem(PROGRESS_STORAGE_KEY));
  if (options.session) progress = mergeLegacySession(progress, options.session);
  if (!progressIsEmpty(progress) || !options.readNative) return progress;
  const raw = await withDeadline(options.readNative(), options.nativeTimeoutMs ?? 1500, null);
  return mergeProgress(progress, parseProgress(raw));
}

export function localProgressStore(storage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}): ProgressStore {
  return {
    async getItem(key) {
      return storage.getItem(key);
    },
    async setItem(key, value) {
      storage.setItem(key, value);
    }
  };
}

export function memoryProgressStore(): ProgressStore {
  const data = new Map<string, string>();
  return {
    async getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    async setItem(key, value) {
      data.set(key, value);
    }
  };
}

/** Writes local storage immediately. Native writes are ordered and not retried. */
export function openProgressStore(options: { local: ProgressStore; native?: ProgressStore | null }): ProgressStore {
  const native = options.native ?? null;
  let nativeWrite: Promise<void> = Promise.resolve();
  return {
    async getItem(key) {
      if (native) {
        try {
          const value = await native.getItem(key);
          if (value != null) return value;
        } catch {
          // A browser has no Apps in Toss storage bridge.
        }
      }
      return options.local.getItem(key);
    },
    async setItem(key, value) {
      await options.local.setItem(key, value);
      if (!native) return;
      nativeWrite = nativeWrite
        .catch(() => undefined)
        .then(() => native.setItem(key, value))
        .then(() => undefined)
        .catch(() => undefined);
    }
  };
}
