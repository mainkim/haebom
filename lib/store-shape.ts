import type { DbShape } from "./types";

export function emptyDb(): DbShape {
  return {
    meta: {
      app: "haebom",
      schemaVersion: 1,
      demoMode: true,
      updatedAt: new Date().toISOString()
    },
    studies: [],
    versions: [],
    participants: [],
    sessions: [],
    assignments: [],
    consents: [],
    surveyResponses: [],
    events: [],
    stimulusExposures: [],
    qualityFlags: [],
    eventIdIndex: {}
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
