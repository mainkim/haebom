import type { DbShape, Study, StudyVersion } from "./types";
import { withDbRead } from "./store";
import * as XLSX from "xlsx";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

function getStudyVersion(db: DbShape, studyId: string) {
  const study = db.studies.find((s) => s.id === studyId);
  if (!study) throw new Error("Study not found");
  const version =
    db.versions.find((v) => v.id === study.currentVersionId) ??
    db.versions.filter((v) => v.studyId === studyId).sort((a, b) => b.versionNumber - a.versionNumber)[0];
  if (!version) throw new Error("Version not found");
  return { study, version };
}

export async function buildExports(studyId: string) {
  return await withDbRead((db) => {
    const { study, version } = getStudyVersion(db, studyId);
    return {
      participantWide: toCsv(buildParticipantWide(db, study, version)),
      eventLong: toCsv(buildEventLong(db, study, version)),
      codebook: toCsv(buildCodebook(version))
    };
  });
}

/** XLSX workbook as base64 for download */
export async function buildXlsxBase64(studyId: string) {
  return await withDbRead((db) => {
    const { study, version } = getStudyVersion(db, studyId);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildParticipantWide(db, study, version)),
      "participant_wide"
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildEventLong(db, study, version)), "event_long");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildCodebook(version)), "codebook");
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
    return {
      filename: `haebom_${study.slug || study.id}_export.xlsx`,
      base64
    };
  });
}

function factorLevelLabel(version: StudyVersion, factorId: string, levelId: string) {
  const factor = version.spec.design.factors.find((f) => f.id === factorId);
  return factor?.levels.find((l) => l.id === levelId)?.label ?? levelId;
}

function buildParticipantWide(db: DbShape, study: Study, version: StudyVersion) {
  const participants = db.participants.filter((p) => p.studyVersionId === version.id);
  return participants.map((p) => {
    const session = db.sessions.find((s) => s.id === p.sessionId);
    const assignment = db.assignments.find((a) => a.participantId === p.id);
    const condition = version.spec.conditions.find((c) => c.id === assignment?.conditionId);
    const responses = db.surveyResponses.filter((r) => r.participantId === p.id);
    const flags = db.qualityFlags.filter((f) => f.participantId === p.id);
    const row: Record<string, unknown> = {
      participant_id: p.id,
      session_id: p.sessionId,
      study_id: study.id,
      study_version_id: version.id,
      condition_id: condition?.id ?? "",
      condition: condition?.label ?? "",
      start: session?.startedAt ?? "",
      end: session?.endedAt ?? "",
      duration_ms: session?.durationMs ?? "",
      session_status: session?.status ?? "",
      quality_flags: flags.map((f) => f.type).join("|")
    };

    for (const factor of version.spec.design.factors) {
      const levelId = condition?.factorLevels[factor.id];
      row[`factor_${factor.id}`] = levelId ? factorLevelLabel(version, factor.id, levelId) : "";
    }

    for (const m of version.spec.measures) {
      const r = responses.find((x) => x.measureId === m.id);
      row[m.id] = r?.value ?? "";
      row[`${m.id}_rt_ms`] = r?.responseTimeMs ?? "";
    }

    const criteriaClick = db.events.some(
      (e) => e.participantId === p.id && e.objectId === "criteria_button" && e.eventType === "object_click"
    );
    row.criteria_button_click = criteriaClick ? 1 : 0;
    const exposure = db.stimulusExposures.find((e) => e.participantId === p.id);
    row.stimulus_duration_ms = exposure?.durationMs ?? "";

    return row;
  });
}

function buildEventLong(db: DbShape, _study: Study, version: StudyVersion) {
  return db.events
    .filter((e) => e.studyVersionId === version.id)
    .map((e) => {
      const condition = version.spec.conditions.find((c) => c.id === e.conditionId);
      return {
        participant_id: e.participantId,
        session_id: e.sessionId,
        condition: condition?.label ?? e.conditionId,
        event_id: e.eventId,
        event_type: e.eventType,
        step_id: e.stepId ?? "",
        screen_id: e.screenId ?? "",
        object_id: e.objectId ?? "",
        sequence_no: e.sequenceNo,
        timestamp: e.clientTimestamp,
        server_received_at: e.serverReceivedAt,
        elapsed_ms: e.elapsedMs ?? "",
        payload: JSON.stringify(e.payload ?? {})
      };
    });
}

function buildCodebook(version: StudyVersion) {
  const rows: Record<string, unknown>[] = [];
  for (const m of version.spec.measures) {
    rows.push({
      variable_id: m.id,
      variable_name: m.construct,
      construct: m.construct,
      question_text: m.questionText,
      type: m.type,
      scale: m.scaleMin != null ? `${m.scaleMin}-${m.scaleMax}` : (m.options ?? []).join("|"),
      labels: (m.scaleLabels ?? m.options ?? []).join("|"),
      reverse_coded: m.reverseCoded ? 1 : 0,
      measurement_stage: m.stage
    });
  }
  rows.push({
    variable_id: "criteria_button_click",
    variable_name: "정보 탐색",
    construct: "정보 탐색",
    question_text: "선정 기준 더 보기 클릭 여부",
    type: "behavior",
    scale: "0/1",
    labels: "0=no|1=yes",
    reverse_coded: 0,
    measurement_stage: "stimulus"
  });
  rows.push({
    variable_id: "stimulus_duration_ms",
    variable_name: "자극 체류",
    construct: "자극 체류",
    question_text: "자극 화면 체류시간(ms)",
    type: "behavior",
    scale: "ms",
    labels: "",
    reverse_coded: 0,
    measurement_stage: "stimulus"
  });
  return rows;
}
