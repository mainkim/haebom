import type { Measure, ParticipantRuntimePayload, Stimulus } from "./types";

/** Shown until a Toss promotion is reviewed and wired. Nothing is paid here. */
export const PARTICIPANT_REWARD_PLACEHOLDER = {
  status: "not_connected",
  title: "리워드",
  detail: "참여 기록은 저장되었습니다. 토스 포인트 지급은 아직 연결되지 않았습니다."
} as const;

const BANNED_KEY = ["condition", "treatment", "random", "assignment"];

export function stripExperimentalKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripExperimentalKeys(item)) as T;
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (BANNED_KEY.some((part) => lower.includes(part))) continue;
    out[key] = stripExperimentalKeys(nested);
  }
  return out as T;
}

function publicStimulus(stimulus: Stimulus) {
  return {
    id: stimulus.id,
    title: stimulus.title,
    body: stimulus.body,
    tone: stimulus.tone,
    reasonShown: stimulus.reasonShown,
    reasonText: stimulus.reasonShown ? stimulus.reasonText : undefined,
    ctaLabel: stimulus.ctaLabel,
    criteriaButtonLabel: stimulus.criteriaButtonLabel,
    criteriaDetail: stimulus.criteriaDetail
  };
}

function publicMeasure(measure: Measure) {
  return {
    id: measure.id,
    construct: measure.construct,
    questionText: measure.questionText,
    type: measure.type,
    stage: measure.stage,
    scaleMin: measure.scaleMin,
    scaleMax: measure.scaleMax,
    scaleLabels: measure.scaleLabels,
    options: measure.options,
    required: measure.required
  };
}

/** Participant payload: one stimulus, no assignment vocabulary, no attention-check answer. */
export function toParticipantView(runtime: ParticipantRuntimePayload) {
  return stripExperimentalKeys({
    participantId: runtime.participantId,
    sessionId: runtime.sessionId,
    studyId: runtime.studyId,
    studyTitle: runtime.studyTitle,
    studyVersionId: runtime.studyVersionId,
    stimulus: publicStimulus(runtime.stimulus),
    flow: runtime.flow,
    measures: runtime.measures.map(publicMeasure),
    consentText: runtime.consentText,
    debriefText: runtime.debriefText,
    currentStepId: runtime.currentStepId,
    status: runtime.status,
    reward: PARTICIPANT_REWARD_PLACEHOLDER
  });
}

export type ParticipantView = ReturnType<typeof toParticipantView>;

const IDENTITY_KEYS = new Set([
  "name",
  "email",
  "phone",
  "userkey",
  "userid",
  "tossuserid",
  "loginid",
  "displayname",
  "realname",
  "anonkey",
  "deviceid",
  "externalauthref"
]);

/** Drops Toss login / contact fields so they cannot land in the research log. */
export function scrubResearchPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (IDENTITY_KEYS.has(key.toLowerCase())) continue;
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}
