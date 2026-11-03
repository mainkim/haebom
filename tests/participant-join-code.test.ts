import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JOIN_CODE_PATTERN,
  SESSION_JOIN_CODE_KEY,
  joinCodeFromLocation,
  normalizeJoinCode,
  readStoredJoinCode,
  resolveJoinCode
} from "../apps/haebom-participant/src/join-code";

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

describe("participant join code", () => {
  it("matches the existing 4–16 alphanumeric rule", () => {
    assert.equal(JOIN_CODE_PATTERN.test("326E8565"), true);
    assert.equal(JOIN_CODE_PATTERN.test("ab12"), true);
    assert.equal(JOIN_CODE_PATTERN.test("abc"), false);
    assert.equal(JOIN_CODE_PATTERN.test("abcdefghijklmnopq"), false);
    assert.equal(JOIN_CODE_PATTERN.test("ab-12"), false);
  });

  it("trims input and accepts any letter case", () => {
    assert.equal(normalizeJoinCode("  326e8565  "), "326E8565");
    assert.equal(normalizeJoinCode("Ab12"), "AB12");
    assert.equal(normalizeJoinCode("  "), null);
    assert.equal(normalizeJoinCode("nope!"), null);
    assert.equal(normalizeJoinCode("abc"), null);
  });

  it("reads /p/<code> and ignores an invalid path segment", () => {
    assert.equal(joinCodeFromLocation({ pathname: "/p/326E8565", search: "" }), "326E8565");
    assert.equal(joinCodeFromLocation({ pathname: "/p/bad", search: "" }), null);
    assert.equal(joinCodeFromLocation({ pathname: "/", search: "" }), null);
    assert.equal(joinCodeFromLocation({ pathname: "", search: "" }), null);
  });

  it("accepts joinCode and code query params when the path has no code", () => {
    assert.equal(joinCodeFromLocation({ pathname: "/", search: "?joinCode=326e8565" }), "326E8565");
    assert.equal(joinCodeFromLocation({ pathname: "/", search: "?code=ab12cd" }), "AB12CD");
    assert.equal(
      joinCodeFromLocation({ pathname: "/p/326E8565", search: "?code=aaaaaaaa" }),
      "326E8565"
    );
    assert.equal(joinCodeFromLocation({ pathname: "/", search: "?code=no" }), null);
  });

  it("prefers a location code over a stored code, and restores a stored code otherwise", () => {
    const storage = memoryStorage({ [SESSION_JOIN_CODE_KEY]: "stored01" });
    assert.equal(resolveJoinCode({ pathname: "/", search: "" }, storage), "STORED01");
    assert.equal(resolveJoinCode({ pathname: "/p/326E8565", search: "" }, storage), "326E8565");
    assert.equal(readStoredJoinCode(memoryStorage({ [SESSION_JOIN_CODE_KEY]: "??" })), null);
    assert.equal(readStoredJoinCode(memoryStorage()), null);
  });
});
