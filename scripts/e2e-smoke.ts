process.env.HAEBOM_STORE = "file";
process.env.HAEBOM_SKIP_LITERATURE = "1";

/**
 * Headless E2E smoke: create → fix QA → approve → publish → join → respond → export
 */
import {
  applyDemoFixes,
  approveStudy,
  createStudyFromPrompt,
  getDataOverview,
  getParticipantTimeline,
  ingestEvents,
  joinStudy,
  publishStudy,
  recordConsent,
  submitForReview,
  submitStep
} from "../lib/study-service";
import { buildExports } from "../lib/export";
import { DEMO_PROMPT } from "../lib/ai/generator";
import { emptyDb } from "../lib/store";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dataDir = path.join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "haebom.json"), JSON.stringify(emptyDb(), null, 2));

  const { study } = await createStudyFromPrompt(DEMO_PROMPT, { isDemo: true });
  assert(study.id, "study created");

  await applyDemoFixes(study.id);
  await submitForReview(study.id);
  await approveStudy(study.id);
  const published = await publishStudy(study.id);
  assert(published.study.status === "published", "published");

  const runtime = await joinStudy(published.joinCode, "demo");
  assert(runtime.stimulus, "stimulus assigned");
  assert(runtime.conditionId, "condition assigned");

  // Persist assignment on refresh simulation
  const again = await joinStudy(published.joinCode, "demo");
  // new join = new participant; persistent assignment is per participant
  assert(again.participantId !== runtime.participantId, "new participant each join");

  let rt = await recordConsent(runtime.participantId);
  assert(rt.currentStepId === "step_pre", "after consent -> pre");

  rt = await submitStep({
    participantId: runtime.participantId,
    stepId: "step_pre",
    responses: [{ measureId: "pre_q1", value: 5 }]
  });
  assert(rt.currentStepId === "step_stimulus", "to stimulus");

  await ingestEvents([
    {
      eventId: "evt_smoke_1",
      studyId: runtime.studyId,
      studyVersionId: runtime.studyVersionId,
      participantId: runtime.participantId,
      sessionId: runtime.sessionId,
      conditionId: runtime.conditionId,
      stepId: "step_stimulus",
      objectId: "criteria_button",
      eventType: "object_click",
      sequenceNo: 1,
      clientTimestamp: new Date().toISOString(),
      elapsedMs: 500
    },
    {
      eventId: "evt_smoke_1", // duplicate
      studyId: runtime.studyId,
      studyVersionId: runtime.studyVersionId,
      participantId: runtime.participantId,
      sessionId: runtime.sessionId,
      conditionId: runtime.conditionId,
      eventType: "object_click",
      sequenceNo: 1,
      clientTimestamp: new Date().toISOString()
    },
    {
      eventId: "evt_smoke_2",
      studyId: runtime.studyId,
      studyVersionId: runtime.studyVersionId,
      participantId: runtime.participantId,
      sessionId: runtime.sessionId,
      conditionId: runtime.conditionId,
      objectId: "stimulus_view",
      eventType: "stimulus_impression",
      sequenceNo: 2,
      clientTimestamp: new Date().toISOString()
    }
  ]);

  rt = await submitStep({
    participantId: runtime.participantId,
    stepId: "step_stimulus",
    criteriaOpened: true,
    recommendationSelected: true,
    stimulusDurationMs: 2500
  });

  rt = await submitStep({
    participantId: runtime.participantId,
    stepId: "step_post",
    responses: [
      { measureId: "post_q1", value: 6 },
      { measureId: "post_q2", value: 5 }
    ]
  });
  rt = await submitStep({
    participantId: runtime.participantId,
    stepId: "step_attention",
    responses: [{ measureId: "att_q1", value: 3 }]
  });
  rt = await submitStep({
    participantId: runtime.participantId,
    stepId: "step_manip",
    responses: [{ measureId: "manip_q1", value: "예" }]
  });
  rt = await submitStep({ participantId: runtime.participantId, stepId: "step_debrief" });
  assert(rt.status === "completed", "session completed");

  const overview = await getDataOverview(study.id);
  assert(overview && overview.overview.totalCompleted >= 1, "completed counted");

  const timeline = await getParticipantTimeline(runtime.participantId);
  assert(timeline && timeline.events.some((e) => e.objectId === "criteria_button"), "click linked");
  assert(timeline && timeline.responses.some((r) => r.measureId === "post_q1"), "survey linked");
  assert(timeline.participant.id === runtime.participantId, "same participant id");

  const files = await buildExports(study.id);
  assert(files.participantWide.includes("participant_id"), "wide csv");
  assert(files.eventLong.includes("event_type"), "event csv");
  assert(files.codebook.includes("variable_id"), "codebook");

  console.log(
    JSON.stringify(
      {
        ok: true,
        studyId: study.id,
        participantId: runtime.participantId,
        conditionId: runtime.conditionId,
        completed: overview!.overview.totalCompleted,
        exportChars: {
          wide: files.participantWide.length,
          events: files.eventLong.length,
          codebook: files.codebook.length
        }
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
