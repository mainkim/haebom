import { assignCondition } from "./assignment";
import { expandLineageFromDoi } from "./ai/expand-lineage";
import { generateStudyDraft, DEMO_PROMPT } from "./ai/generator";
import { addLineageEdge, buildLineageGraph, syncLineageFromDocuments } from "./ai/lineage";
import { seedDemoSourceLibrary } from "./ai/demo-lineage";
import {
  applyGroundedSuggestions,
  ensureSourceLibrary,
  getSourceLibrary,
  makeSourceDocument,
  recommendGroundedStimuli
} from "./ai/rag";
import { enrichDraftWithLiterature, mergeWorksIntoLibrary } from "./ai/research-copilot";
import { searchOpenAlexWorks } from "./ai/openalex";
import { addMissingRecommendationSelect, canTransition, harmonizeCtaLabels, runQa } from "./qa";
import { newId, nowIso, shortCode, withDb, withDbRead } from "./store";
import type {
  ParticipantRuntimePayload,
  QualityFlag,
  ResearchEvent,
  Session,
  SourceDocument,
  SourceLibrary,
  Study,
  StudyDraftSpec,
  StudyVersion,
  SurveyResponse
} from "./types";

export async function listStudies(): Promise<Study[]> {
  return await withDbRead((db) => [...db.studies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export async function getStudy(studyId: string): Promise<Study | undefined> {
  return await withDbRead((db) => db.studies.find((s) => s.id === studyId));
}

export async function getVersion(versionId: string): Promise<StudyVersion | undefined> {
  return await withDbRead((db) => db.versions.find((v) => v.id === versionId));
}

export async function getStudyBundle(studyId: string) {
  return await withDbRead((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study) return null;
    const versions = db.versions.filter((v) => v.studyId === studyId).sort((a, b) => b.versionNumber - a.versionNumber);
    const current = versions.find((v) => v.id === study.currentVersionId) ?? versions[0];
    const draft = versions.find((v) => v.id === study.latestDraftVersionId) ?? current;
    const sessions = db.sessions.filter((s) => s.studyId === studyId);
    const assignments = db.assignments.filter((a) => a.studyId === studyId);
    return { study, versions, current, draft, sessions, assignments };
  });
}

export async function createStudyFromPrompt(prompt: string, opts?: { title?: string; targetN?: number; isDemo?: boolean }) {
  const spec = await generateStudyDraft(prompt);
  if (opts?.title) spec.title = opts.title;
  await enrichDraftWithLiterature(spec, prompt, { expand: false, searchLimit: 6, timeoutMs: 10_000 });

  return await withDb((db) => {
    const studyId = newId("stu");
    const versionId = newId("ver");
    const now = nowIso();
    const study: Study = {
      id: studyId,
      title: spec.title,
      slug: shortCode(6).toLowerCase(),
      joinCode: shortCode(8),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      targetN: opts?.targetN ?? 80,
      currentVersionId: versionId,
      latestDraftVersionId: versionId,
      isDemo: opts?.isDemo ?? false
    };
    const version: StudyVersion = {
      id: versionId,
      studyId,
      versionNumber: 1,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      spec,
      qaSnapshot: runQa(spec)
    };
    db.studies.push(study);
    db.versions.push(version);
    return { study, version };
  });
}

export async function updateDraftSpec(studyId: string, mutator: (spec: StudyDraftSpec) => StudyDraftSpec) {
  return await withDb((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study) throw new Error("Study not found");
    const version = db.versions.find((v) => v.id === study.latestDraftVersionId);
    if (!version) throw new Error("Draft version not found");
    if (version.status === "published") {
      throw new Error("Published version cannot be edited. Create a new draft.");
    }
    version.spec = mutator(version.spec);
    version.updatedAt = nowIso();
    version.qaSnapshot = runQa(version.spec);
    study.updatedAt = nowIso();
    study.title = version.spec.title;
    return { study, version };
  });
}

export async function submitForReview(studyId: string) {
  return await withDb((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study?.latestDraftVersionId) throw new Error("No draft");
    const version = db.versions.find((v) => v.id === study.latestDraftVersionId)!;
    if (!canTransition(version.status, "review") && version.status !== "draft") {
      throw new Error(`Cannot move from ${version.status} to review`);
    }
    version.qaSnapshot = runQa(version.spec);
    version.status = "review";
    version.updatedAt = nowIso();
    study.status = "review";
    study.updatedAt = nowIso();
    return { study, version };
  });
}

export async function applyDemoFixes(studyId: string) {
  return updateDraftSpec(studyId, (spec) => {
    let next = addMissingRecommendationSelect(spec);
    next = harmonizeCtaLabels(next);
    return next;
  });
}

export async function addStudySource(
  studyId: string,
  input: {
    title: string;
    text: string;
    authors?: string;
    year?: number;
    kind?: SourceDocument["kind"];
    citesSourceIds?: string[];
  }
) {
  return updateDraftSpec(studyId, (spec) => {
    const library = ensureSourceLibrary(spec);
    const doc = makeSourceDocument(input);
    library.documents.push(doc);
    syncLineageFromDocuments(library);
    return spec;
  });
}

export async function removeStudySource(studyId: string, sourceId: string) {
  return updateDraftSpec(studyId, (spec) => {
    const library = ensureSourceLibrary(spec);
    library.documents = library.documents.filter((d) => d.id !== sourceId);
    library.edges = library.edges.filter((e) => e.fromSourceId !== sourceId && e.toSourceId !== sourceId);
    for (const d of library.documents) {
      d.citesSourceIds = (d.citesSourceIds ?? []).filter((id) => id !== sourceId);
    }
    return spec;
  });
}

export async function linkStudySources(
  studyId: string,
  fromSourceId: string,
  toSourceId: string,
  note?: string
) {
  return updateDraftSpec(studyId, (spec) => {
    const library = ensureSourceLibrary(spec);
    addLineageEdge(library, fromSourceId, toSourceId, "cites", note);
    const from = library.documents.find((d) => d.id === fromSourceId);
    if (from) {
      from.citesSourceIds = Array.from(new Set([...(from.citesSourceIds ?? []), toSourceId]));
    }
    return spec;
  });
}

export async function getStudyLineage(studyId: string) {
  return await withDbRead((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study) return null;
    const version =
      db.versions.find((v) => v.id === study.latestDraftVersionId) ??
      db.versions.find((v) => v.id === study.currentVersionId);
    if (!version) return null;
    return {
      studyId,
      library: getSourceLibrary(version.spec),
      graph: buildLineageGraph(version.spec)
    };
  });
}

export async function previewGroundedStimuli(studyId: string, query?: string) {
  return await withDbRead((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study?.latestDraftVersionId) throw new Error("No draft");
    const version = db.versions.find((v) => v.id === study.latestDraftVersionId)!;
    return recommendGroundedStimuli(version.spec, query);
  });
}

export async function applyGroundedStimuli(studyId: string, query?: string) {
  return updateDraftSpec(studyId, (spec) => {
    const preview = recommendGroundedStimuli(spec, query);
    if (!preview.suggestions.length) {
      throw new Error(preview.note || "자료 기반 자극을 만들 수 없습니다.");
    }
    return applyGroundedSuggestions(spec, preview.suggestions);
  });
}

export async function seedSourceLibrary(studyId: string) {
  return updateDraftSpec(studyId, (spec) => {
    spec.sourceLibrary = seedDemoSourceLibrary();
    return spec;
  });
}

function cloneSourceLibrary(library: SourceLibrary): SourceLibrary {
  return {
    groundingMode: library.groundingMode,
    lastGroundedAt: library.lastGroundedAt,
    documents: library.documents.map((d) => ({
      ...d,
      citesSourceIds: d.citesSourceIds ? [...d.citesSourceIds] : []
    })),
    edges: library.edges.map((e) => ({ ...e })),
    collections: library.collections?.map((c) => ({ ...c }))
  };
}

/** Expand paper lineage around a DOI via OpenAlex + Semantic Scholar */
export async function expandStudyLineageFromDoi(
  studyId: string,
  doi: string,
  opts?: { refLimit?: number; citeLimit?: number; similarLimit?: number }
) {
  const snapshot = await withDbRead((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study) throw new Error("Study not found");
    const version = db.versions.find((v) => v.id === study.latestDraftVersionId);
    if (!version) throw new Error("Draft version not found");
    if (version.status === "published") {
      throw new Error("Published version cannot be edited. Create a new draft.");
    }
    return cloneSourceLibrary(getSourceLibrary(version.spec));
  });

  const expanded = await expandLineageFromDoi(snapshot, doi, opts);
  const { study, version } = await updateDraftSpec(studyId, (spec) => {
    spec.sourceLibrary = expanded.library;
    return spec;
  });

  return {
    study,
    version,
    seed: expanded.seed,
    addedCount: expanded.added.length,
    edgesAdded: expanded.edgesAdded,
    providers: expanded.providers,
    warnings: expanded.warnings,
    graph: buildLineageGraph(version.spec)
  };
}

/** Keyword search on OpenAlex → add papers to the study corpus */
export async function searchStudyLiterature(studyId: string, query: string) {
  const q = query.trim();
  if (!q) throw new Error("검색어를 입력해 주세요.");
  const works = await searchOpenAlexWorks(q, 8);
  const { study, version } = await updateDraftSpec(studyId, (spec) => {
    const library = ensureSourceLibrary(spec);
    const added = mergeWorksIntoLibrary(library, works);
    spec.aiMeta = {
      mode: spec.aiMeta?.mode === "rag_grounded" ? "rag_grounded" : "tools",
      note: spec.aiMeta?.note ?? "OpenAlex 문헌 검색",
      sourcePrompt: spec.aiMeta?.sourcePrompt ?? spec.researchQuestion,
      literatureQuery: q,
      toolCalls: [
        ...(spec.aiMeta?.toolCalls ?? []),
        {
          tool: "openalex_search",
          status: added.length ? "ok" : "skipped",
          input: q,
          outputSummary: added.length ? `${added.length}편 추가` : works.length ? "이미 자료실에 있음" : "검색 결과 없음",
          count: added.length
        }
      ]
    };
    return spec;
  });
  return {
    study,
    version,
    addedCount: getSourceLibrary(version.spec).documents.length,
    found: works.length,
    query: q
  };
}

/** Re-run OpenAlex + RAG tools on an existing draft */
export async function runStudyLiteratureCopilot(studyId: string, query?: string) {
  const snapshot = await withDbRead((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study) throw new Error("Study not found");
    const version = db.versions.find((v) => v.id === study.latestDraftVersionId);
    if (!version) throw new Error("Draft version not found");
    if (version.status === "published") {
      throw new Error("Published version cannot be edited. Create a new draft.");
    }
    return JSON.parse(JSON.stringify(version.spec)) as import("./types").StudyDraftSpec;
  });
  const prompt = query?.trim() || snapshot.aiMeta?.sourcePrompt || snapshot.researchQuestion;
  await enrichDraftWithLiterature(snapshot, prompt, { expand: true, searchLimit: 6, timeoutMs: 12_000 });
  const { study, version } = await updateDraftSpec(studyId, () => snapshot);
  return {
    study,
    version,
    papers: snapshot.sourceLibrary?.documents.length ?? 0,
    toolCalls: snapshot.aiMeta?.toolCalls ?? []
  };
}

export async function approveStudy(studyId: string, opts?: { forceClearBlockers?: boolean }) {
  return await withDb((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study?.latestDraftVersionId) throw new Error("No draft");
    const version = db.versions.find((v) => v.id === study.latestDraftVersionId)!;
    if (version.status !== "review" && version.status !== "draft") {
      throw new Error("Only draft/review can be approved");
    }
    let qa = runQa(version.spec);
    if (!qa.canApprove && opts?.forceClearBlockers) {
      // Researcher acknowledged — still require no structural condition errors
      const hard = qa.blockers.filter((b) => b.code !== "BEHAVIOR_MISSING");
      qa = { ...qa, blockers: hard, canApprove: hard.length === 0 };
    }
    if (!qa.canApprove) {
      throw new Error(`QA blockers remain: ${qa.blockers.map((b) => b.code).join(", ")}`);
    }
    version.qaSnapshot = qa;
    version.status = "approved";
    version.approvedAt = nowIso();
    version.updatedAt = nowIso();
    study.status = "approved";
    study.updatedAt = nowIso();
    return { study, version };
  });
}

export async function publishStudy(studyId: string) {
  return await withDb((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study?.latestDraftVersionId) throw new Error("No draft");
    const version = db.versions.find((v) => v.id === study.latestDraftVersionId)!;
    if (version.status !== "approved") {
      throw new Error("Approve before publish");
    }
    version.status = "published";
    version.publishedAt = nowIso();
    version.updatedAt = nowIso();
    study.status = "published";
    study.publishedAt = nowIso();
    study.currentVersionId = version.id;
    study.updatedAt = nowIso();
    return { study, version, joinCode: study.joinCode };
  });
}

/** Create new draft from published version for edits */
export async function createNewDraftFromPublished(studyId: string) {
  return await withDb((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study?.currentVersionId) throw new Error("No published version");
    const published = db.versions.find((v) => v.id === study.currentVersionId)!;
    if (published.status !== "published") throw new Error("Current version is not published");
    const now = nowIso();
    const maxVer = Math.max(...db.versions.filter((v) => v.studyId === studyId).map((v) => v.versionNumber));
    const draft: StudyVersion = {
      id: newId("ver"),
      studyId,
      versionNumber: maxVer + 1,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      spec: JSON.parse(JSON.stringify(published.spec)),
      qaSnapshot: runQa(published.spec)
    };
    db.versions.push(draft);
    study.latestDraftVersionId = draft.id;
    study.status = "draft";
    study.updatedAt = now;
    return { study, version: draft };
  });
}

export async function joinStudy(joinCode: string, channel: "web" | "toss_miniapp" | "demo" = "web") {
  return await withDb((db) => {
    const study = db.studies.find((s) => s.joinCode.toUpperCase() === joinCode.toUpperCase());
    if (!study) throw new Error("참여 코드를 찾을 수 없습니다.");
    if (study.status !== "published") throw new Error("아직 공개되지 않은 연구입니다.");
    const version = db.versions.find((v) => v.id === study.currentVersionId);
    if (!version || version.status !== "published") throw new Error("유효한 연구 버전이 없습니다.");

    const participantId = newId("par");
    const sessionId = newId("ses");
    const now = nowIso();

    const assignment = assignCondition({
      studyId: study.id,
      studyVersionId: version.id,
      participantId,
      version,
      existingAssignments: db.assignments,
      targetN: study.targetN
    });

    db.participants.push({
      id: participantId,
      studyId: study.id,
      studyVersionId: version.id,
      sessionId,
      createdAt: now,
      channel
    });
    db.assignments.push(assignment);

    const firstStep = version.spec.flow[0]?.id ?? "step_consent";
    const session: Session = {
      id: sessionId,
      participantId,
      studyId: study.id,
      studyVersionId: version.id,
      conditionId: assignment.conditionId,
      status: "active",
      startedAt: now,
      currentStepId: firstStep,
      consentGiven: false
    };
    db.sessions.push(session);

    return buildRuntime(db, participantId);
  });
}

function buildRuntime(db: import("./types").DbShape, participantId: string): ParticipantRuntimePayload {
  const participant = db.participants.find((p) => p.id === participantId)!;
  const session = db.sessions.find((s) => s.id === participant.sessionId)!;
  const version = db.versions.find((v) => v.id === participant.studyVersionId)!;
  const study = db.studies.find((s) => s.id === participant.studyId)!;
  const stimulus = version.spec.stimuli.find((s) => s.conditionId === session.conditionId);
  if (!stimulus) throw new Error("Assigned stimulus missing");

  return {
    participantId: participant.id,
    sessionId: session.id,
    studyId: study.id,
    studyTitle: study.title,
    studyVersionId: version.id,
    conditionId: session.conditionId,
    stimulus, // only assigned stimulus
    flow: version.spec.flow,
    measures: version.spec.measures,
    consentText:
      "본 연구는 온라인 콘텐츠 추천에 대한 인식을 살펴봅니다. 응답은 익명으로 처리되며, 언제든 중단할 수 있습니다. 참여에 동의하시면 계속 진행해 주세요.",
    debriefText:
      version.spec.flow.find((f) => f.type === "debrief" && "body" in f)?.["body"] ??
      "참여해 주셔서 감사합니다.",
    currentStepId: session.currentStepId,
    status: session.status
  };
}

export async function getRuntime(participantId: string): Promise<ParticipantRuntimePayload | null> {
  return await withDbRead((db) => {
    const p = db.participants.find((x) => x.id === participantId);
    if (!p) return null;
    return buildRuntime(db, participantId);
  });
}

export async function recordConsent(participantId: string) {
  return await withDb((db) => {
    const session = db.sessions.find((s) => s.participantId === participantId);
    if (!session) throw new Error("Session not found");
    session.consentGiven = true;
    db.consents.push({
      id: newId("con"),
      participantId,
      sessionId: session.id,
      studyVersionId: session.studyVersionId,
      agreedAt: nowIso(),
      textVersion: "v1"
    });
    advanceStep(db, session);
    return buildRuntime(db, participantId);
  });
}

function advanceStep(db: import("./types").DbShape, session: Session) {
  const version = db.versions.find((v) => v.id === session.studyVersionId)!;
  const idx = version.spec.flow.findIndex((f) => f.id === session.currentStepId);
  const next = version.spec.flow[idx + 1];
  if (next) {
    session.currentStepId = next.id;
  }
}

export async function submitStep(params: {
  participantId: string;
  stepId: string;
  responses?: Array<{ measureId: string; value: string | number; responseTimeMs?: number }>;
  criteriaOpened?: boolean;
  recommendationSelected?: boolean;
  stimulusDurationMs?: number;
}) {
  return await withDb((db) => {
    const session = db.sessions.find((s) => s.participantId === params.participantId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "active") throw new Error("Session not active");
    if (session.currentStepId !== params.stepId) {
      // idempotent: already advanced
      return buildRuntime(db, params.participantId);
    }

    const version = db.versions.find((v) => v.id === session.studyVersionId)!;
    const step = version.spec.flow.find((f) => f.id === params.stepId);
    if (!step) throw new Error("Unknown step");

    const now = nowIso();

    if (step.type === "stimulus" || step.type === "behavior_task") {
      const stim = version.spec.stimuli.find((s) => s.conditionId === session.conditionId)!;
      const existing = db.stimulusExposures.find(
        (e) => e.sessionId === session.id && e.stimulusId === stim.id
      );
      if (!existing) {
        db.stimulusExposures.push({
          id: newId("exp"),
          participantId: params.participantId,
          sessionId: session.id,
          studyVersionId: session.studyVersionId,
          conditionId: session.conditionId,
          stimulusId: stim.id,
          shownAt: now,
          durationMs: params.stimulusDurationMs
        });
      } else if (params.stimulusDurationMs != null) {
        existing.durationMs = params.stimulusDurationMs;
      }
    }

    if (params.responses?.length) {
      for (const r of params.responses) {
        const row: SurveyResponse = {
          id: newId("rsp"),
          participantId: params.participantId,
          sessionId: session.id,
          studyId: session.studyId,
          studyVersionId: session.studyVersionId,
          conditionId: session.conditionId,
          measureId: r.measureId,
          value: r.value,
          responseTimeMs: r.responseTimeMs,
          submittedAt: now
        };
        db.surveyResponses.push(row);
      }
    }

    // Auto quality flags for attention check
    if (step.type === "survey" && step.stage === "attention") {
      for (const r of params.responses ?? []) {
        const measure = version.spec.measures.find((m) => m.id === r.measureId);
        if (measure?.type === "attention_check" && measure.correctAnswer != null) {
          if (String(r.value) !== String(measure.correctAnswer)) {
            db.qualityFlags.push({
              id: newId("qf"),
              participantId: params.participantId,
              sessionId: session.id,
              studyVersionId: session.studyVersionId,
              type: "attention_check_fail",
              detail: `Attention check ${measure.id} failed`,
              createdAt: now,
              inclusionDecision: "pending"
            });
          }
        }
      }
    }

    advanceStep(db, session);

    const nextStep = version.spec.flow.find((f) => f.id === session.currentStepId);
    if (nextStep?.type === "complete") {
      completeSession(db, session);
    }

    return buildRuntime(db, params.participantId);
  });
}

function completeSession(db: import("./types").DbShape, session: Session) {
  const now = nowIso();
  session.status = "completed";
  session.endedAt = now;
  session.durationMs = new Date(now).getTime() - new Date(session.startedAt).getTime();

  if (session.durationMs < 15000) {
    db.qualityFlags.push({
      id: newId("qf"),
      participantId: session.participantId,
      sessionId: session.id,
      studyVersionId: session.studyVersionId,
      type: "too_fast_completion",
      detail: `Completed in ${session.durationMs}ms`,
      createdAt: now,
      inclusionDecision: "pending"
    });
  }

  // missing required event check
  const hasCriteria = db.events.some(
    (e) => e.sessionId === session.id && e.objectId === "criteria_button" && e.eventType === "object_click"
  );
  // not required to click — only flag if behavior was required AND never even had impression
  const hasStimulus = db.events.some(
    (e) => e.sessionId === session.id && e.eventType === "stimulus_impression"
  );
  if (!hasStimulus) {
    db.qualityFlags.push({
      id: newId("qf"),
      participantId: session.participantId,
      sessionId: session.id,
      studyVersionId: session.studyVersionId,
      type: "missing_required_event",
      detail: "Missing stimulus_impression",
      createdAt: now,
      inclusionDecision: "pending"
    });
  }

  void hasCriteria;
}

export async function ingestEvents(events: Array<Omit<ResearchEvent, "serverReceivedAt"> & { serverReceivedAt?: string }>) {
  return await withDb((db) => {
    let accepted = 0;
    let duplicates = 0;
    for (const ev of events) {
      if (db.eventIdIndex[ev.eventId]) {
        duplicates += 1;
        continue;
      }
      const row: ResearchEvent = {
        ...ev,
        serverReceivedAt: nowIso()
      };
      db.events.push(row);
      db.eventIdIndex[ev.eventId] = true;
      accepted += 1;

      if (ev.eventType === "experiment_complete") {
        const session = db.sessions.find((s) => s.id === ev.sessionId);
        if (session && session.status === "active") {
          completeSession(db, session);
        }
      }
    }
    return { accepted, duplicates };
  });
}

export async function getDataOverview(studyId: string) {
  return await withDbRead((db) => {
    const study = db.studies.find((s) => s.id === studyId);
    if (!study) return null;
    const version = db.versions.find((v) => v.id === study.currentVersionId) ?? db.versions.find((v) => v.studyId === studyId);
    if (!version) return null;
    const assignments = db.assignments.filter((a) => a.studyVersionId === version.id);
    const sessions = db.sessions.filter((s) => s.studyVersionId === version.id);
    const completed = sessions.filter((s) => s.status === "completed");
    const dropouts = sessions.filter((s) => s.status === "dropout" || s.status === "abandoned");
    const durations = completed.map((s) => s.durationMs ?? 0).filter(Boolean);
    const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    const conditionBalance = version.spec.conditions.map((c) => {
      const assigned = assignments.filter((a) => a.conditionId === c.id).length;
      const condSessions = sessions.filter((s) => s.conditionId === c.id);
      const condCompleted = condSessions.filter((s) => s.status === "completed");
      const durs = condCompleted.map((s) => s.durationMs ?? 0).filter(Boolean);
      return {
        conditionId: c.id,
        label: c.label,
        assigned,
        completed: condCompleted.length,
        avgDuration: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0
      };
    });

    return {
      study,
      version,
      overview: {
        totalAssigned: assignments.length,
        totalCompleted: completed.length,
        completionRate: assignments.length ? completed.length / assignments.length : 0,
        dropoutRate: assignments.length ? dropouts.length / assignments.length : 0,
        avgDuration
      },
      conditionBalance,
      participants: db.participants.filter((p) => p.studyVersionId === version.id)
    };
  });
}

export async function getParticipantTimeline(participantId: string) {
  return await withDbRead((db) => {
    const participant = db.participants.find((p) => p.id === participantId);
    if (!participant) return null;
    const session = db.sessions.find((s) => s.id === participant.sessionId);
    const assignment = db.assignments.find((a) => a.participantId === participantId);
    const version = db.versions.find((v) => v.id === participant.studyVersionId);
    const condition = version?.spec.conditions.find((c) => c.id === assignment?.conditionId);
    const stimulus = version?.spec.stimuli.find((s) => s.conditionId === assignment?.conditionId);
    const exposure = db.stimulusExposures.find((e) => e.participantId === participantId);
    const events = db.events
      .filter((e) => e.participantId === participantId)
      .sort((a, b) => a.sequenceNo - b.sequenceNo || a.serverReceivedAt.localeCompare(b.serverReceivedAt));
    const responses = db.surveyResponses.filter((r) => r.participantId === participantId);
    const flags = db.qualityFlags.filter((f) => f.participantId === participantId);

    return {
      participant,
      session,
      assignment,
      condition,
      stimulusShown: stimulus,
      exposure,
      events,
      responses,
      qualityFlags: flags
    };
  });
}

export async function seedDemoStudy() {
  // Reset demo studies then create fresh published demo
  await withDb((db) => {
    const demoIds = new Set(db.studies.filter((s) => s.isDemo).map((s) => s.id));
    db.studies = db.studies.filter((s) => !s.isDemo);
    db.versions = db.versions.filter((v) => !demoIds.has(v.studyId));
    db.participants = db.participants.filter((p) => !demoIds.has(p.studyId));
    db.sessions = db.sessions.filter((s) => !demoIds.has(s.studyId));
    db.assignments = db.assignments.filter((a) => !demoIds.has(a.studyId));
    db.consents = db.consents.filter((c) => {
      const p = db.participants.find((x) => x.id === c.participantId);
      return !!p;
    });
    db.surveyResponses = db.surveyResponses.filter((r) => !demoIds.has(r.studyId));
    db.events = db.events.filter((e) => !demoIds.has(e.studyId));
    db.stimulusExposures = db.stimulusExposures.filter((e) => {
      const p = db.participants.find((x) => x.id === e.participantId);
      return !!p;
    });
    db.qualityFlags = db.qualityFlags.filter((f) => {
      const p = db.participants.find((x) => x.id === f.participantId);
      return !!p;
    });
    // rebuild event index
    db.eventIdIndex = {};
    for (const e of db.events) db.eventIdIndex[e.eventId] = true;
    db.meta.demoMode = true;
  });

  const { study } = await createStudyFromPrompt(DEMO_PROMPT, { isDemo: true, targetN: 80 });
  await seedSourceLibrary(study.id);
  await applyDemoFixes(study.id);
  try {
    await applyGroundedStimuli(study.id);
  } catch {
    /* corpus seed may still leave QA demo quirks; ignore grounding miss */
  }
  await submitForReview(study.id);
  await approveStudy(study.id);
  const published = await publishStudy(study.id);
  return published;
}

export async function findStudyByJoinCode(code: string) {
  return await withDbRead((db) => db.studies.find((s) => s.joinCode.toUpperCase() === code.toUpperCase()));
}

export async function duplicateStudy(studyId: string) {
  return await withDb((db) => {
    const source = db.studies.find((s) => s.id === studyId);
    if (!source) throw new Error("Study not found");
    const sourceVersion =
      db.versions.find((v) => v.id === source.latestDraftVersionId) ??
      db.versions.find((v) => v.id === source.currentVersionId);
    if (!sourceVersion) throw new Error("Version not found");

    const now = nowIso();
    const newStudyId = newId("stu");
    const newVersionId = newId("ver");
    const study: Study = {
      id: newStudyId,
      title: `${source.title} (복제)`,
      slug: shortCode(6).toLowerCase(),
      joinCode: shortCode(8),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      targetN: source.targetN,
      currentVersionId: newVersionId,
      latestDraftVersionId: newVersionId,
      isDemo: false
    };
    const version: StudyVersion = {
      id: newVersionId,
      studyId: newStudyId,
      versionNumber: 1,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      spec: JSON.parse(JSON.stringify(sourceVersion.spec)),
      qaSnapshot: runQa(sourceVersion.spec)
    };
    db.studies.push(study);
    db.versions.push(version);
    return { study, version };
  });
}
