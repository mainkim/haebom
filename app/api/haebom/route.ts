import { NextResponse } from "next/server";
import {
  applyDemoFixes,
  applyGroundedStimuli,
  addStudySource,
  approveStudy,
  createNewDraftFromPublished,
  createStudyFromPrompt,
  duplicateStudy,
  expandStudyLineageFromDoi,
  getDataOverview,
  getParticipantTimeline,
  getStudyBundle,
  getStudyLineage,
  ingestEvents,
  joinStudy,
  linkStudySources,
  listStudies,
  previewGroundedStimuli,
  publishStudy,
  recordConsent,
  removeStudySource,
  runStudyLiteratureCopilot,
  searchStudyLiterature,
  seedDemoStudy,
  seedSourceLibrary,
  submitForReview,
  submitStep,
  updateDraftSpec,
  getRuntime
} from "@/lib/study-service";
import { buildExports, buildXlsxBase64 } from "@/lib/export";
import { compareConditions, runQa } from "@/lib/qa";
import { DEMO_PROMPT } from "@/lib/ai/generator";

export async function GET() {
  const studies = await listStudies();
  const rows = await Promise.all(
    studies.map(async (s) => {
      const bundle = await getStudyBundle(s.id);
      const overview = await getDataOverview(s.id);
      return {
        ...s,
        designLabel:
          bundle?.draft?.spec.design.factors.map((f) => f.levels.length).join("x") ??
          bundle?.current?.spec.design.factors.map((f) => f.levels.length).join("x") ??
          "",
        completedN: overview?.overview.totalCompleted ?? 0,
        assignedN: overview?.overview.totalAssigned ?? 0
      };
    })
  );
  return NextResponse.json({ studies: rows, demoPrompt: DEMO_PROMPT, demoMode: true });
}

export async function POST(req: Request) {
  const body = await req.json();
  const action = body.action as string;

  try {
    switch (action) {
      case "create_from_prompt": {
        const result = await createStudyFromPrompt(body.prompt, {
          title: body.title,
          targetN: body.targetN,
          isDemo: body.isDemo
        });
        return NextResponse.json(result);
      }
      case "seed_demo": {
        const result = await seedDemoStudy();
        return NextResponse.json(result);
      }
      case "get_bundle": {
        const bundle = await getStudyBundle(body.studyId);
        if (!bundle) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const diffs = compareConditions(bundle.draft?.spec ?? bundle.current!.spec);
        const qa = runQa(bundle.draft?.spec ?? bundle.current!.spec, {
          publishedLocked: bundle.draft?.status === "published"
        });
        return NextResponse.json({ ...bundle, diffs, qa });
      }
      case "update_stimulus": {
        const result = await updateDraftSpec(body.studyId, (spec) => {
          const stim = spec.stimuli.find((s) => s.id === body.stimulusId);
          if (!stim) throw new Error("Stimulus not found");
          Object.assign(stim, body.patch);
          return spec;
        });
        return NextResponse.json(result);
      }
      case "update_measure": {
        const result = await updateDraftSpec(body.studyId, (spec) => {
          const m = spec.measures.find((x) => x.id === body.measureId);
          if (!m) throw new Error("Measure not found");
          Object.assign(m, body.patch);
          return spec;
        });
        return NextResponse.json(result);
      }
      case "apply_demo_fixes": {
        return NextResponse.json(await applyDemoFixes(body.studyId));
      }
      case "submit_review": {
        return NextResponse.json(await submitForReview(body.studyId));
      }
      case "approve": {
        return NextResponse.json(await approveStudy(body.studyId, { forceClearBlockers: body.forceClearBlockers }));
      }
      case "publish": {
        return NextResponse.json(await publishStudy(body.studyId));
      }
      case "new_draft": {
        return NextResponse.json(await createNewDraftFromPublished(body.studyId));
      }
      case "join": {
        return NextResponse.json(await joinStudy(body.joinCode, body.channel ?? "web"));
      }
      case "runtime": {
        const runtime = await getRuntime(body.participantId);
        if (!runtime) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(runtime);
      }
      case "consent": {
        return NextResponse.json(await recordConsent(body.participantId));
      }
      case "submit_step": {
        return NextResponse.json(
          await submitStep({
            participantId: body.participantId,
            stepId: body.stepId,
            responses: body.responses,
            criteriaOpened: body.criteriaOpened,
            recommendationSelected: body.recommendationSelected,
            stimulusDurationMs: body.stimulusDurationMs
          })
        );
      }
      case "events": {
        return NextResponse.json(await ingestEvents(body.events ?? []));
      }
      case "data_overview": {
        const data = await getDataOverview(body.studyId);
        if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(data);
      }
      case "timeline": {
        const data = await getParticipantTimeline(body.participantId);
        if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(data);
      }
      case "export": {
        const files = await buildExports(body.studyId);
        return NextResponse.json(files);
      }
      case "export_xlsx": {
        const xlsx = await buildXlsxBase64(body.studyId);
        return NextResponse.json(xlsx);
      }
      case "duplicate": {
        return NextResponse.json(await duplicateStudy(body.studyId));
      }
      case "add_source": {
        return NextResponse.json(
          await addStudySource(body.studyId, {
            title: body.title,
            text: body.text,
            authors: body.authors,
            year: body.year,
            kind: body.kind,
            citesSourceIds: body.citesSourceIds
          })
        );
      }
      case "remove_source": {
        return NextResponse.json(await removeStudySource(body.studyId, body.sourceId));
      }
      case "link_sources": {
        return NextResponse.json(
          await linkStudySources(body.studyId, body.fromSourceId, body.toSourceId, body.note)
        );
      }
      case "lineage": {
        const data = await getStudyLineage(body.studyId);
        if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(data);
      }
      case "preview_grounded_stimuli": {
        return NextResponse.json(await previewGroundedStimuli(body.studyId, body.query));
      }
      case "apply_grounded_stimuli": {
        return NextResponse.json(await applyGroundedStimuli(body.studyId, body.query));
      }
      case "seed_source_library": {
        return NextResponse.json(await seedSourceLibrary(body.studyId));
      }
      case "expand_lineage": {
        if (!body.doi || typeof body.doi !== "string") {
          return NextResponse.json({ error: "doi required" }, { status: 400 });
        }
        return NextResponse.json(
          await expandStudyLineageFromDoi(body.studyId, body.doi, {
            refLimit: body.refLimit,
            citeLimit: body.citeLimit,
            similarLimit: body.similarLimit
          })
        );
      }
      case "search_literature": {
        if (!body.query || typeof body.query !== "string") {
          return NextResponse.json({ error: "query required" }, { status: 400 });
        }
        return NextResponse.json(await searchStudyLiterature(body.studyId, body.query));
      }
      case "run_literature_copilot": {
        return NextResponse.json(await runStudyLiteratureCopilot(body.studyId, body.query));
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
