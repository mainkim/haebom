import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { handleParticipantRequest } from "../lib/participant-api";
import { originAllowed, participantCorsPatterns } from "../lib/participant-cors";
import { mutateHaebomDocument, type DocumentDb, type QueryRow } from "../lib/store-postgres";
import { emptyDb, readDb, resetMemoryCache, storeBackend, withDb } from "../lib/store";
import {
  applyDemoFixes,
  approveStudy,
  createStudyFromPrompt,
  getRuntime,
  getStudyBundle,
  publishStudy,
  submitForReview
} from "../lib/study-service";
import { DEMO_PROMPT } from "../lib/ai/generator";

const savedEnv = {
  HAEBOM_STORE: process.env.HAEBOM_STORE,
  HAEBOM_DATA_DIR: process.env.HAEBOM_DATA_DIR,
  DATABASE_URL: process.env.DATABASE_URL,
  HAEBOM_AIT_APP_NAME: process.env.HAEBOM_AIT_APP_NAME,
  HAEBOM_PARTICIPANT_CORS_ORIGINS: process.env.HAEBOM_PARTICIPANT_CORS_ORIGINS,
  HAEBOM_SKIP_LITERATURE: process.env.HAEBOM_SKIP_LITERATURE
};

let dataDir = "";

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "haebom-"));
  process.env.HAEBOM_STORE = "file";
  process.env.HAEBOM_DATA_DIR = dataDir;
  process.env.HAEBOM_SKIP_LITERATURE = "1";
  process.env.HAEBOM_AIT_APP_NAME = "haebom";
  delete process.env.HAEBOM_PARTICIPANT_CORS_ORIGINS;
  delete process.env.DATABASE_URL;
  resetMemoryCache();
});

afterEach(() => {
  restoreEnv();
  resetMemoryCache();
  rmSync(dataDir, { recursive: true, force: true });
});

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      found.add(key);
      keysOf(nested, found);
    }
  }
  return found;
}

async function publishDemo() {
  const { study } = await createStudyFromPrompt(DEMO_PROMPT, { isDemo: true, targetN: 40 });
  await applyDemoFixes(study.id);
  await submitForReview(study.id);
  await approveStudy(study.id);
  return publishStudy(study.id);
}

function participantRequest(body: unknown, origin?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return handleParticipantRequest(
    new Request("https://haebom.example/api/participant", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    })
  );
}

describe("store adapter", () => {
  it("keeps the file store when HAEBOM_STORE=file even if DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@ep-example.neon.tech/neondb?sslmode=require";
    process.env.HAEBOM_STORE = "file";
    assert.equal(storeBackend(), "file");
    await withDb((db) => {
      db.meta.demoMode = false;
      return db.meta.demoMode;
    });
    resetMemoryCache();
    const loaded = await readDb();
    assert.equal(loaded.meta.demoMode, false);
    assert.equal(loaded.meta.app, "haebom");
  });

  it("selects postgres only from DATABASE_URL", () => {
    delete process.env.HAEBOM_STORE;
    assert.equal(storeBackend(), "file");
    process.env.DATABASE_URL = "postgres://user:pass@ep-example.neon.tech/neondb";
    assert.equal(storeBackend(), "postgres");
    process.env.HAEBOM_STORE = "file";
    assert.equal(storeBackend(), "file");
  });

  it("retries a version conflict and writes the winning document", async () => {
    let row: { version: number; document: string } | null = {
      version: 1,
      document: JSON.stringify(emptyDb())
    };
    let conflictsLeft = 1;
    const db: DocumentDb = {
      async query(sql: string, params: unknown[] = []): Promise<QueryRow[]> {
        if (sql.startsWith("CREATE")) return [];
        if (sql.startsWith("SELECT")) {
          return row ? [{ version: row.version, document: row.document }] : [];
        }
        if (sql.includes("INSERT")) {
          if (row) return [];
          row = { version: 1, document: String(params[1]) };
          return [{ version: 1 }];
        }
        if (sql.includes("UPDATE")) {
          const version = Number(params[2]);
          if (!row || row.version !== version) return [];
          if (conflictsLeft > 0) {
            conflictsLeft -= 1;
            const other = emptyDb();
            other.meta.demoMode = false;
            row = { version: row.version + 1, document: JSON.stringify(other) };
            return [];
          }
          row = { version: row.version + 1, document: String(params[1]) };
          return [{ version: row.version }];
        }
        throw new Error(`unexpected sql: ${sql}`);
      }
    };

    let calls = 0;
    const result = await mutateHaebomDocument(db, (doc) => {
      calls += 1;
      doc.studies.push({
        id: "stu_marker",
        title: "marker",
        slug: "marker",
        joinCode: "MARKER01",
        status: "draft",
        createdAt: doc.meta.updatedAt,
        updatedAt: doc.meta.updatedAt,
        targetN: 1,
        currentVersionId: null,
        latestDraftVersionId: null
      });
      return doc.studies.map((study) => study.id);
    });

    assert.equal(calls, 2);
    assert.deepEqual(result, ["stu_marker"]);
    assert.ok(row);
    const saved = JSON.parse(row!.document) as { meta: { demoMode: boolean }; studies: Array<{ id: string }> };
    assert.equal(saved.meta.demoMode, false);
    assert.deepEqual(saved.studies.map((study) => study.id), ["stu_marker"]);
    assert.equal(row!.version, 3);
  });
});

describe("participant CORS", () => {
  it("allows the default Apps in Toss origins and blocks others", () => {
    const patterns = participantCorsPatterns({ HAEBOM_AIT_APP_NAME: "haebom" });
    assert.equal(originAllowed("https://haebom.apps.tossmini.com", patterns, "haebom"), true);
    assert.equal(originAllowed("https://haebom.private-apps.tossmini.com", patterns, "haebom"), true);
    assert.equal(originAllowed("https://other.apps.tossmini.com", patterns, "haebom"), false);
    assert.equal(originAllowed("https://evil.example", patterns, "haebom"), false);
    assert.equal(originAllowed("https://haebom.apps.tossmini.com", patterns, undefined), false);
  });

  it("uses the env allowlist instead of the defaults", () => {
    const patterns = participantCorsPatterns({
      HAEBOM_PARTICIPANT_CORS_ORIGINS: "http://localhost:5173,https://*.apps.tossmini.com"
    });
    assert.equal(originAllowed("http://localhost:5173", patterns, "haebom"), true);
    assert.equal(originAllowed("https://demo.apps.tossmini.com", patterns, "haebom"), true);
    assert.equal(originAllowed("https://haebom.private-apps.tossmini.com", patterns, "haebom"), false);
    assert.equal(originAllowed("https://evil.apps.tossmini.com.attacker.test", patterns, "haebom"), false);
  });
});

describe("participant API", () => {
  it("blocks researcher actions and disallowed origins", async () => {
    const published = await publishDemo();
    const before = (await readDb()).studies.length;

    const publishAttempt = await participantRequest({ action: "publish", studyId: published.study.id });
    assert.equal(publishAttempt.status, 403);
    const exportAttempt = await participantRequest({ action: "export", studyId: published.study.id });
    assert.equal(exportAttempt.status, 403);
    const createAttempt = await participantRequest({ action: "create_from_prompt", prompt: "새 연구" });
    assert.equal(createAttempt.status, 403);
    assert.equal((await readDb()).studies.length, before);

    const joined = await participantRequest({ action: "join", joinCode: published.joinCode });
    assert.equal(joined.status, 200);
    const early = (await joined.json()) as { participantId: string };
    const tooEarly = await participantRequest({ action: "complete", participantId: early.participantId });
    assert.equal(tooEarly.status, 400);

    const blocked = await participantRequest(
      { action: "join", joinCode: published.joinCode },
      "https://evil.example"
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);

    const preflight = await handleParticipantRequest(
      new Request("https://haebom.example/api/participant", {
        method: "OPTIONS",
        headers: { Origin: "https://haebom.apps.tossmini.com" }
      })
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://haebom.apps.tossmini.com");

    const deniedPreflight = await handleParticipantRequest(
      new Request("https://haebom.example/api/participant", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" }
      })
    );
    assert.equal(deniedPreflight.status, 403);
    assert.equal(deniedPreflight.headers.get("access-control-allow-origin"), null);
  });

  it("assigns on the server, hides the assignment, and keeps identity out of events", async () => {
    const published = await publishDemo();
    const counts = new Map<string, number>();
    let first: { participantId: string; stimulus: { body: string } } | null = null;

    for (let i = 0; i < 12; i++) {
      const res = await participantRequest(
        { action: "join", joinCode: published.joinCode, channel: "toss_miniapp" },
        "https://haebom.private-apps.tossmini.com"
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "https://haebom.private-apps.tossmini.com");
      const view = (await res.json()) as {
        participantId: string;
        stimulus: { body: string };
        reward: { status: string };
      };
      const keys = keysOf(view);
      for (const key of keys) {
        const lower = key.toLowerCase();
        assert.equal(lower.includes("condition"), false, key);
        assert.equal(lower.includes("treatment"), false, key);
        assert.equal(lower.includes("random"), false, key);
        assert.equal(lower.includes("assignment"), false, key);
      }
      assert.equal(Array.isArray(view.stimulus), false);
      assert.equal(view.reward.status, "not_connected");
      const server = await getRuntime(view.participantId);
      assert.ok(server);
      assert.equal(view.stimulus.body, server.stimulus.body);
      counts.set(server.conditionId, (counts.get(server.conditionId) ?? 0) + 1);
      const bundle = await getStudyBundle(published.study.id);
      const others = bundle!.current!.spec.stimuli.filter((item) => item.conditionId !== server.conditionId);
      const encoded = JSON.stringify(view);
      for (const other of others) {
        if (other.body !== server.stimulus.body) assert.equal(encoded.includes(other.body), false);
      }
      first ??= view;
    }

    const values = [...counts.values()];
    assert.equal(values.length, 4);
    assert.equal(Math.max(...values) - Math.min(...values) <= 1, true);
    const participant = (await readDb()).participants.find((item) => item.id === first!.participantId);
    assert.equal(participant?.channel, "toss_miniapp");
    assert.equal(participant?.externalAuthRef, undefined);

    const spoof = await participantRequest({
      action: "events",
      participantId: first!.participantId,
      events: [
        {
          eventId: "evt_participant_spoof",
          studyId: "stu_spoof",
          conditionId: "spoof",
          eventType: "object_click",
          sequenceNo: 1,
          clientTimestamp: new Date().toISOString(),
          payload: { name: "해인", userKey: "toss-user", value: 1 }
        }
      ]
    });
    assert.equal(spoof.status, 200);
    const stored = (await readDb()).events.find((event) => event.eventId === "evt_participant_spoof");
    const server = await getRuntime(first!.participantId);
    assert.ok(stored);
    assert.ok(server);
    assert.equal(stored.studyId, server.studyId);
    assert.equal(stored.conditionId, server.conditionId);
    assert.equal(stored.participantId, server.participantId);
    assert.deepEqual(stored.payload, { value: 1 });
  });
});
