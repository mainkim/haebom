import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { DELETE, GET as sessionGet, POST as sessionPost } from "../app/api/admin/session/route";
import { GET, POST } from "../app/api/haebom/route";
import { handleParticipantRequest } from "../lib/participant-api";
import { participantCorsHeaders } from "../lib/participant-cors";
import {
  ADMIN_COOKIE,
  MIN_ADMIN_KEY_LENGTH,
  adminCookie,
  adminSessionToken,
  authorizeAdmin,
  configuredAdminKey
} from "../lib/admin-auth";
import { resetMemoryCache } from "../lib/store";
import {
  applyDemoFixes,
  approveStudy,
  createStudyFromPrompt,
  publishStudy,
  submitForReview
} from "../lib/study-service";
import { DEMO_PROMPT } from "../lib/ai/generator";

const ADMIN_KEY = "test-admin-key-0123456789";

const savedEnv = {
  HAEBOM_STORE: process.env.HAEBOM_STORE,
  HAEBOM_DATA_DIR: process.env.HAEBOM_DATA_DIR,
  DATABASE_URL: process.env.DATABASE_URL,
  HAEBOM_AIT_APP_NAME: process.env.HAEBOM_AIT_APP_NAME,
  HAEBOM_PARTICIPANT_CORS_ORIGINS: process.env.HAEBOM_PARTICIPANT_CORS_ORIGINS,
  HAEBOM_SKIP_LITERATURE: process.env.HAEBOM_SKIP_LITERATURE,
  HAEBOM_ADMIN_KEY: process.env.HAEBOM_ADMIN_KEY,
  NODE_ENV: process.env.NODE_ENV
};

let dataDir = "";

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "haebom-admin-"));
  process.env.HAEBOM_STORE = "file";
  process.env.HAEBOM_DATA_DIR = dataDir;
  process.env.HAEBOM_SKIP_LITERATURE = "1";
  process.env.HAEBOM_AIT_APP_NAME = "haebomresearch";
  delete process.env.HAEBOM_PARTICIPANT_CORS_ORIGINS;
  delete process.env.DATABASE_URL;
  delete process.env.HAEBOM_ADMIN_KEY;
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

async function publishDemo(title: string) {
  const { study } = await createStudyFromPrompt(DEMO_PROMPT, { isDemo: true, targetN: 40, title });
  await applyDemoFixes(study.id);
  await submitForReview(study.id);
  await approveStudy(study.id);
  return publishStudy(study.id);
}

function researcherRequest(method: "GET" | "POST", init?: { cookie?: string; authorization?: string; body?: unknown }) {
  const headers = new Headers();
  if (init?.cookie) headers.set("cookie", init.cookie);
  if (init?.authorization) headers.set("authorization", init.authorization);
  if (method === "POST") {
    headers.set("content-type", "application/json");
    return new Request("https://haebom.example/api/haebom", {
      method,
      headers,
      body: JSON.stringify(init?.body ?? {})
    });
  }
  return new Request("https://haebom.example/api/haebom", { method, headers });
}

describe("admin key check", () => {
  it("fails closed when the key is missing or shorter than 16 characters", () => {
    assert.equal(MIN_ADMIN_KEY_LENGTH, 16);
    assert.equal(configuredAdminKey({}), null);
    assert.equal(configuredAdminKey({ HAEBOM_ADMIN_KEY: "   " }), null);
    assert.equal(configuredAdminKey({ HAEBOM_ADMIN_KEY: "short-key" }), null);
    const decision = authorizeAdmin({ cookieHeader: null, authorization: `Bearer ${ADMIN_KEY}`, env: {} });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 503);
  });

  it("accepts the bearer key or the session cookie and rejects everything else", () => {
    const env = { HAEBOM_ADMIN_KEY: ADMIN_KEY };
    const token = adminSessionToken(ADMIN_KEY);
    assert.notEqual(token, ADMIN_KEY);

    const bearer = authorizeAdmin({
      cookieHeader: null,
      authorization: `Bearer ${ADMIN_KEY}`,
      env
    });
    assert.equal(bearer.ok, true);

    const cookie = authorizeAdmin({
      cookieHeader: `other=1; ${ADMIN_COOKIE}=${token}`,
      authorization: null,
      env
    });
    assert.equal(cookie.ok, true);

    const wrong = authorizeAdmin({
      cookieHeader: `${ADMIN_COOKIE}=not-the-token`,
      authorization: "Bearer wrong-admin-key-value",
      env
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.status, 401);

    const missing = authorizeAdmin({ cookieHeader: null, authorization: null, env });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 401);
  });

  it("keeps the session cookie httpOnly, SameSite=Lax, and Secure in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const cookie = adminCookie("session-token", 60);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
});

describe("researcher API", () => {
  it("returns 503 for every /api/haebom call when HAEBOM_ADMIN_KEY is unset", async () => {
    const read = await GET(researcherRequest("GET"));
    assert.equal(read.status, 503);
    const write = await POST(researcherRequest("POST", { body: { action: "seed_demo" } }));
    assert.equal(write.status, 503);
  });

  it("returns 401 for unauthenticated reads and writes, and 200 once the key is presented", async () => {
    process.env.HAEBOM_ADMIN_KEY = ADMIN_KEY;

    const anonRead = await GET(researcherRequest("GET"));
    assert.equal(anonRead.status, 401);
    const anonWrite = await POST(
      researcherRequest("POST", { body: { action: "create_from_prompt", prompt: DEMO_PROMPT, title: "비공개" } })
    );
    assert.equal(anonWrite.status, 401);

    const created = await POST(
      researcherRequest("POST", {
        authorization: `Bearer ${ADMIN_KEY}`,
        body: { action: "create_from_prompt", prompt: DEMO_PROMPT, title: "인증된 연구" }
      })
    );
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as { study: { id: string; title: string } };
    assert.equal(createdBody.study.title, "인증된 연구");

    const listed = await GET(researcherRequest("GET", { authorization: `Bearer ${ADMIN_KEY}` }));
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as { studies: Array<{ id: string }> };
    assert.equal(
      listedBody.studies.some((study) => study.id === createdBody.study.id),
      true
    );

    const login = await sessionPost(
      new Request("https://haebom.example/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: ADMIN_KEY })
      })
    );
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /httponly/i);
    assert.match(setCookie, /samesite=lax/i);
    assert.equal(setCookie.includes(ADMIN_KEY), false);
    const token = adminSessionToken(ADMIN_KEY);
    assert.equal(setCookie.includes(token), true);

    const viaCookie = await GET(researcherRequest("GET", { cookie: `${ADMIN_COOKIE}=${token}` }));
    assert.equal(viaCookie.status, 200);

    const wrongLogin = await sessionPost(
      new Request("https://haebom.example/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "wrong-admin-key-value" })
      })
    );
    assert.equal(wrongLogin.status, 401);
    assert.equal(wrongLogin.headers.get("set-cookie"), null);

    const session = await sessionGet(
      new Request("https://haebom.example/api/admin/session", {
        headers: { cookie: `${ADMIN_COOKIE}=${token}` }
      })
    );
    assert.equal(session.status, 200);

    const loggedOut = await DELETE(new Request("https://haebom.example/api/admin/session", { method: "DELETE" }));
    const cleared = loggedOut.headers.get("set-cookie") ?? "";
    assert.match(cleared, new RegExp(`${ADMIN_COOKIE}=`));
    assert.match(cleared, /max-age=0/i);
  });
});

describe("participant API without researcher auth", () => {
  it("joins an existing code and does not return another participant's answer or researcher fields", async () => {
    process.env.HAEBOM_ADMIN_KEY = ADMIN_KEY;
    const firstStudy = await publishDemo("알파 연구 제목");
    const secondStudy = await publishDemo("베타 연구 제목");
    const sentinel = "zz-answer-sentinel-918273";

    const joined = await handleParticipantRequest(
      new Request("https://haebom.example/api/participant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://haebomresearch.apps.tossmini.com"
        },
        body: JSON.stringify({ action: "join", joinCode: firstStudy.joinCode, channel: "toss_miniapp" })
      })
    );
    assert.equal(joined.status, 200);
    assert.equal(joined.headers.get("access-control-allow-origin"), "https://haebomresearch.apps.tossmini.com");
    const alpha = (await joined.json()) as { participantId: string; studyTitle: string };
    assert.equal(alpha.studyTitle, "알파 연구 제목");
    const alphaKeys = keysOf(alpha);
    for (const key of ["correctAnswer", "conditionId", "surveyResponses", "joinCode"]) {
      assert.equal(alphaKeys.has(key), false, key);
    }

    const other = await handleParticipantRequest(
      new Request("https://haebom.example/api/participant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "join", joinCode: secondStudy.joinCode })
      })
    );
    assert.equal(other.status, 200);
    const beta = (await other.json()) as { participantId: string; studyTitle: string };
    assert.equal(JSON.stringify(beta).includes("알파 연구 제목"), false);
    assert.equal(JSON.stringify(beta).includes(alpha.participantId), false);

    const consented = await handleParticipantRequest(
      new Request("https://haebom.example/api/participant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "consent", participantId: alpha.participantId })
      })
    );
    assert.equal(consented.status, 200);
    const answered = await handleParticipantRequest(
      new Request("https://haebom.example/api/participant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit_step",
          participantId: alpha.participantId,
          stepId: "step_pre",
          responses: [{ measureId: "pre_q1", value: sentinel }]
        })
      })
    );
    assert.equal(answered.status, 200);
    const answeredView = await answered.json();
    assert.equal(JSON.stringify(answeredView).includes(sentinel), false);

    const betaAgain = await handleParticipantRequest(
      new Request("https://haebom.example/api/participant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "runtime", participantId: beta.participantId })
      })
    );
    assert.equal(betaAgain.status, 200);
    const betaRuntime = await betaAgain.json();
    assert.equal(JSON.stringify(betaRuntime).includes(sentinel), false);
    assert.equal(JSON.stringify(betaRuntime).includes(alpha.participantId), false);

    for (const action of ["data_overview", "timeline", "export", "list", "get_bundle"]) {
      const blocked = await handleParticipantRequest(
        new Request("https://haebom.example/api/participant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, studyId: firstStudy.study.id, participantId: alpha.participantId })
        })
      );
      assert.equal(blocked.status, 403, action);
    }

    const privateCors = participantCorsHeaders("https://haebomresearch.private-apps.tossmini.com");
    assert.equal(
      privateCors.get("access-control-allow-origin"),
      "https://haebomresearch.private-apps.tossmini.com"
    );
  });

  it("accepts the page's own origin and still rejects a foreign origin", async () => {
    const published = await publishDemo("같은 출처 연구");
    const same = await handleParticipantRequest(
      new Request("https://haebomresearch.vercel.app/api/participant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://haebomresearch.vercel.app"
        },
        body: JSON.stringify({ action: "join", joinCode: published.joinCode, channel: "web" })
      })
    );
    assert.equal(same.status, 200);

    const foreign = await handleParticipantRequest(
      new Request("https://haebomresearch.vercel.app/api/participant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example"
        },
        body: JSON.stringify({ action: "join", joinCode: published.joinCode })
      })
    );
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);
  });
});
