import { getRuntime, ingestEvents, joinStudy, recordConsent, submitStep } from "./study-service";
import { participantCorsHeaders, participantOriginAllowed } from "./participant-cors";
import { scrubResearchPayload, toParticipantView } from "./participant-view";
import type { ResearchEvent } from "./types";

const PARTICIPANT_ACTIONS = new Set(["join", "runtime", "consent", "submit_step", "events", "complete"]);

function json(body: unknown, status: number, headers: Headers): Response {
  const next = new Headers(headers);
  next.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: next });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function surveyResponses(value: unknown): Array<{ measureId: string; value: string | number; responseTimeMs?: number }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: Array<{ measureId: string; value: string | number; responseTimeMs?: number }> = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.measureId !== "string") continue;
    if (typeof item.value !== "string" && typeof item.value !== "number") continue;
    rows.push({
      measureId: item.measureId,
      value: item.value,
      responseTimeMs: typeof item.responseTimeMs === "number" ? item.responseTimeMs : undefined
    });
  }
  return rows;
}

function participantId(value: unknown): string {
  if (typeof value !== "string" || !/^par_[a-f0-9]{8,64}$/i.test(value)) {
    throw new Error("참여 정보를 찾을 수 없습니다.");
  }
  return value;
}

export async function handleParticipantRequest(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const headers = participantCorsHeaders(origin);
  const allowed = participantOriginAllowed(origin);

  if (req.method === "OPTIONS") {
    if (!allowed) return json({ error: "이 출처에서는 참여할 수 없습니다." }, 403, headers);
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return json({ error: "POST만 지원합니다." }, 405, headers);
  }
  if (!allowed) {
    return json({ error: "이 출처에서는 참여할 수 없습니다." }, 403, headers);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) throw new Error("잘못된 요청입니다.");
    body = parsed;
  } catch (err) {
    const message = err instanceof Error && err.message === "잘못된 요청입니다." ? err.message : "잘못된 요청입니다.";
    return json({ error: message }, 400, headers);
  }

  const action = body.action;
  if (typeof action !== "string" || !PARTICIPANT_ACTIONS.has(action)) {
    return json({ error: "지원하지 않는 요청입니다." }, 403, headers);
  }

  try {
    switch (action) {
      case "join": {
        if (typeof body.joinCode !== "string" || !/^[a-z0-9]{4,16}$/i.test(body.joinCode)) {
          return json({ error: "참여 코드를 확인해 주세요." }, 400, headers);
        }
        const channel = body.channel === "toss_miniapp" || body.channel === "demo" ? body.channel : "web";
        const runtime = await joinStudy(body.joinCode, channel);
        return json(toParticipantView(runtime), 200, headers);
      }
      case "runtime": {
        const runtime = await getRuntime(participantId(body.participantId));
        if (!runtime) return json({ error: "참여 정보를 찾을 수 없습니다." }, 404, headers);
        return json(toParticipantView(runtime), 200, headers);
      }
      case "consent": {
        const runtime = await recordConsent(participantId(body.participantId));
        return json(toParticipantView(runtime), 200, headers);
      }
      case "submit_step": {
        const runtime = await submitStep({
          participantId: participantId(body.participantId),
          stepId: typeof body.stepId === "string" ? body.stepId : "",
          responses: surveyResponses(body.responses),
          criteriaOpened: body.criteriaOpened === true,
          recommendationSelected: body.recommendationSelected === true,
          stimulusDurationMs: typeof body.stimulusDurationMs === "number" ? body.stimulusDurationMs : undefined
        });
        return json(toParticipantView(runtime), 200, headers);
      }
      case "events": {
        const id = participantId(body.participantId);
        const runtime = await getRuntime(id);
        if (!runtime) return json({ error: "참여 정보를 찾을 수 없습니다." }, 404, headers);
        if (!Array.isArray(body.events) || body.events.length > 40) {
          return json({ error: "기록 형식이 올바르지 않습니다." }, 400, headers);
        }
        const events: Array<Omit<ResearchEvent, "serverReceivedAt">> = [];
        for (const raw of body.events) {
          if (!isRecord(raw)) return json({ error: "기록 형식이 올바르지 않습니다." }, 400, headers);
          if (typeof raw.eventId !== "string" || raw.eventId.length < 4 || raw.eventId.length > 80) {
            return json({ error: "기록 형식이 올바르지 않습니다." }, 400, headers);
          }
          if (typeof raw.eventType !== "string" || raw.eventType.length > 64) {
            return json({ error: "기록 형식이 올바르지 않습니다." }, 400, headers);
          }
          events.push({
            eventId: raw.eventId,
            studyId: runtime.studyId,
            studyVersionId: runtime.studyVersionId,
            participantId: runtime.participantId,
            sessionId: runtime.sessionId,
            conditionId: runtime.conditionId,
            stepId: typeof raw.stepId === "string" ? raw.stepId : undefined,
            screenId: typeof raw.screenId === "string" ? raw.screenId : undefined,
            objectId: typeof raw.objectId === "string" ? raw.objectId : undefined,
            eventType: raw.eventType,
            sequenceNo: typeof raw.sequenceNo === "number" ? raw.sequenceNo : 0,
            clientTimestamp: typeof raw.clientTimestamp === "string" ? raw.clientTimestamp : new Date().toISOString(),
            elapsedMs: typeof raw.elapsedMs === "number" ? raw.elapsedMs : undefined,
            payload: scrubResearchPayload(raw.payload)
          });
        }
        const result = await ingestEvents(events);
        return json(result, 200, headers);
      }
      case "complete": {
        const id = participantId(body.participantId);
        const runtime = await getRuntime(id);
        if (!runtime) return json({ error: "참여 정보를 찾을 수 없습니다." }, 404, headers);
        if (runtime.status === "completed") return json(toParticipantView(runtime), 200, headers);
        const step = runtime.flow.find((item) => item.id === runtime.currentStepId);
        if (!step || (step.type !== "debrief" && step.type !== "complete")) {
          return json({ error: "아직 마지막 단계가 아닙니다." }, 400, headers);
        }
        const next = await submitStep({ participantId: id, stepId: step.id });
        return json(toParticipantView(next), 200, headers);
      }
      default:
        return json({ error: "지원하지 않는 요청입니다." }, 403, headers);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "요청을 처리하지 못했습니다.";
    const status = message.includes("찾을 수 없") ? 404 : 400;
    return json({ error: message }, status, headers);
  }
}
