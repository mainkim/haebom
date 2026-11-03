"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { participantApi } from "@/lib/participant-client";
import type { ParticipantView } from "@/lib/participant-view";
import type { Measure } from "@/lib/types";

function newEventId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `evt_${crypto.randomUUID()}`;
  }
  return `evt_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function ParticipateInner() {
  const params = useParams<{ code: string }>();
  const search = useSearchParams();
  const channel = (search.get("channel") as "web" | "toss_miniapp" | "demo") || "web";
  const [runtime, setRuntime] = useState<ParticipantView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const startedAt = useRef<number>(Date.now());
  const stimulusShownAt = useRef<number | null>(null);

  async function pushEvents(
    rt: ParticipantView,
    partials: Array<{
      eventType: string;
      stepId?: string;
      screenId?: string;
      objectId?: string;
      payload?: Record<string, unknown>;
    }>
  ) {
    const events = partials.map((p) => {
      seq.current += 1;
      return {
        eventId: newEventId(),
        stepId: p.stepId,
        screenId: p.screenId,
        objectId: p.objectId,
        eventType: p.eventType,
        sequenceNo: seq.current,
        clientTimestamp: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt.current,
        payload: p.payload
      };
    });
    await participantApi("events", { participantId: rt.participantId, events });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storageKey = `haebom_participant_${params.code}`;
        const existingId = typeof window !== "undefined" ? sessionStorage.getItem(storageKey) : null;
        let joined: ParticipantView;
        if (existingId) {
          try {
            joined = await participantApi<ParticipantView>("runtime", { participantId: existingId });
          } catch {
            joined = await participantApi<ParticipantView>("join", {
              joinCode: params.code,
              channel
            });
            sessionStorage.setItem(storageKey, joined.participantId);
          }
        } else {
          joined = await participantApi<ParticipantView>("join", {
            joinCode: params.code,
            channel
          });
          sessionStorage.setItem(storageKey, joined.participantId);
        }
        if (!cancelled) {
          setRuntime(joined);
          startedAt.current = Date.now();
          await pushEvents(joined, [
            {
              eventType: "screen_view",
              screenId: "join",
              stepId: joined.currentStepId
            }
          ]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "참여 실패");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, channel]);

  const step = useMemo(() => runtime?.flow.find((f) => f.id === runtime.currentStepId), [runtime]);

  const progressLabel = useMemo(() => {
    if (!runtime || !step) return "";
    const labels: Record<string, string> = {
      consent: "참여 안내",
      survey: step.type === "survey" ? step.title : "설문",
      stimulus: "화면 보기",
      behavior_task: "과제",
      debrief: "안내",
      complete: "완료"
    };
    return labels[step.type] ?? step.title;
  }, [runtime, step]);

  const stepIndex = useMemo(() => {
    if (!runtime) return 0;
    return Math.max(0, runtime.flow.findIndex((f) => f.id === runtime.currentStepId));
  }, [runtime]);

  useEffect(() => {
    if (!runtime || !step) return;
    if (step.type === "stimulus" || step.type === "behavior_task") {
      stimulusShownAt.current = Date.now();
      pushEvents(runtime, [
        {
          eventType: "stimulus_impression",
          stepId: step.id,
          screenId: "stimulus",
          objectId: "stimulus_view"
        }
      ]).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime?.currentStepId]);

  async function onConsent() {
    if (!runtime) return;
    setBusy(true);
    try {
      await pushEvents(runtime, [{ eventType: "step_submit", stepId: step?.id, screenId: "consent" }]);
      const next = await participantApi<ParticipantView>("consent", { participantId: runtime.participantId });
      setRuntime(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  async function onSurveySubmit(measureIds: string[]) {
    if (!runtime || !step || step.type !== "survey") return;
    for (const id of measureIds) {
      if (answers[id] == null || answers[id] === "") {
        setError("필수 문항에 응답해 주세요.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await pushEvents(runtime, [
        { eventType: "survey_submit", stepId: step.id, screenId: step.stage || "survey" },
        { eventType: "step_submit", stepId: step.id }
      ]);
      const next = await participantApi<ParticipantView>("submit_step", {
        participantId: runtime.participantId,
        stepId: step.id,
        responses: measureIds.map((id) => ({ measureId: id, value: answers[id], responseTimeMs: 1200 }))
      });
      setRuntime(next);
      setAnswers({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  async function onStimulusContinue(opts: { selected?: boolean }) {
    if (!runtime || !step) return;
    setBusy(true);
    try {
      const duration = stimulusShownAt.current ? Date.now() - stimulusShownAt.current : 0;
      const evs: Array<{
        eventType: string;
        stepId?: string;
        screenId?: string;
        objectId?: string;
      }> = [];
      if (criteriaOpen) {
        evs.push({
          eventType: "object_click",
          stepId: step.id,
          objectId: "criteria_button",
          screenId: "stimulus"
        });
      }
      if (opts.selected) {
        evs.push({
          eventType: "object_click",
          stepId: step.id,
          objectId: "recommendation_select",
          screenId: "stimulus"
        });
      }
      evs.push({ eventType: "step_submit", stepId: step.id, screenId: "stimulus" });
      await pushEvents(runtime, evs);
      const next = await participantApi<ParticipantView>("submit_step", {
        participantId: runtime.participantId,
        stepId: step.id,
        criteriaOpened: criteriaOpen,
        recommendationSelected: !!opts.selected,
        stimulusDurationMs: duration
      });
      setRuntime(next);
      setCriteriaOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!runtime || !step) return;
    setBusy(true);
    try {
      await pushEvents(runtime, [
        { eventType: "experiment_complete", stepId: step.id, screenId: "complete" }
      ]);
      if (runtime.status !== "completed") {
        const next = await participantApi<ParticipantView>("submit_step", {
          participantId: runtime.participantId,
          stepId: step.id
        });
        setRuntime(next);
      } else {
        setRuntime({ ...runtime });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  function renderMeasures(ids: string[]) {
    if (!runtime) return null;
    const measures = ids
      .map((id) => runtime.measures.find((m) => m.id === id))
      .filter(Boolean) as Measure[];
    return measures.map((m) => (
      <div key={m.id} className="field">
        <label>{m.questionText}</label>
        {m.type === "choice" || m.type === "manipulation_check" ? (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {(m.options ?? []).map((opt) => (
              <button
                key={opt}
                type="button"
                className={`btn ${answers[m.id] === opt ? "" : "btn-secondary"}`}
                onClick={() => {
                  setAnswers((a) => ({ ...a, [m.id]: opt }));
                  pushEvents(runtime, [
                    {
                      eventType: "response_change",
                      stepId: step?.id,
                      objectId: m.id,
                      payload: { value: opt }
                    }
                  ]).catch(() => undefined);
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <div className="likert">
              {Array.from({ length: (m.scaleMax ?? 7) - (m.scaleMin ?? 1) + 1 }, (_, i) => (m.scaleMin ?? 1) + i).map(
                (n) => (
                  <button
                    key={n}
                    type="button"
                    data-testid={`likert-${m.id}-${n}`}
                    className={answers[m.id] === n ? "selected" : ""}
                    onClick={() => {
                      setAnswers((a) => ({ ...a, [m.id]: n }));
                      pushEvents(runtime, [
                        {
                          eventType: "response_change",
                          stepId: step?.id,
                          objectId: m.id,
                          payload: { value: n }
                        }
                      ]).catch(() => undefined);
                    }}
                  >
                    {n}
                  </button>
                )
              )}
            </div>
            <div className="likert-native" role="radiogroup" aria-label={m.questionText}>
              {Array.from({ length: (m.scaleMax ?? 7) - (m.scaleMin ?? 1) + 1 }, (_, i) => (m.scaleMin ?? 1) + i).map(
                (n) => (
                  <label key={`native-${n}`}>
                    <input
                      type="radio"
                      name={m.id}
                      value={n}
                      checked={answers[m.id] === n}
                      onChange={() => {
                        setAnswers((a) => ({ ...a, [m.id]: n }));
                        pushEvents(runtime, [
                          {
                            eventType: "response_change",
                            stepId: step?.id,
                            objectId: m.id,
                            payload: { value: n }
                          }
                        ]).catch(() => undefined);
                      }}
                    />
                    {n}
                  </label>
                )
              )}
            </div>
          </div>
        )}
        {m.scaleLabels ? (
          <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
            <span>{m.scaleLabels[0]}</span>
            <span>{m.scaleLabels[1]}</span>
          </div>
        ) : null}
      </div>
    ));
  }

  return (
    <AppShell>
      <section className="panel">
        <span className="pill mint">해봄 참여하기</span>
        {!runtime && !error ? <p>참여 준비 중…</p> : null}
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {runtime ? (
          <>
            <h2 style={{ marginTop: 12 }}>{runtime.studyTitle}</h2>
            <p className="mono muted">
              Participant {runtime.participantId.slice(0, 16)}…
            </p>
            <div className="steps" aria-label="진행 단계">
              {runtime.flow.map((f, i) => (
                <span key={f.id} className={`step-chip ${i === stepIndex ? "active" : ""}`}>
                  {f.type === "consent"
                    ? "안내"
                    : f.type === "stimulus" || f.type === "behavior_task"
                      ? "화면"
                      : f.type === "survey"
                        ? "설문"
                        : f.type === "debrief"
                          ? "안내"
                          : "완료"}
                </span>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              현재: {progressLabel}
            </p>
          </>
        ) : null}
      </section>

      {runtime && step ? (
        <section className="panel">
          {step.type === "consent" && (
            <>
              <h3>참여 안내 · 동의</h3>
              <p>{runtime.consentText}</p>
              <button className="primary-btn" type="button" disabled={busy} onClick={onConsent}>
                동의하고 시작하기
              </button>
            </>
          )}

          {step.type === "survey" && (
            <>
              <h3>{step.title}</h3>
              {renderMeasures(step.measureIds)}
              <button className="primary-btn" type="button" disabled={busy} onClick={() => onSurveySubmit(step.measureIds)}>
                다음
              </button>
            </>
          )}

          {(step.type === "stimulus" || step.type === "behavior_task") && (
            <div className="stimulus-stage">
              <h3>{runtime.stimulus.title}</h3>
              <p>{runtime.stimulus.body}</p>
              {runtime.stimulus.reasonShown && runtime.stimulus.reasonText ? (
                <p>{runtime.stimulus.reasonText}</p>
              ) : null}
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "1rem" }}>
                <button
                  className="outline-btn"
                  type="button"
                  data-testid="criteria-button"
                  onClick={() => {
                    setCriteriaOpen(true);
                    pushEvents(runtime, [
                      {
                        eventType: "object_click",
                        stepId: step.id,
                        objectId: "criteria_button",
                        screenId: "stimulus"
                      }
                    ]).catch(() => undefined);
                  }}
                >
                  {runtime.stimulus.criteriaButtonLabel}
                </button>
                <button
                  className="primary-btn"
                  type="button"
                  data-testid="recommendation-select"
                  disabled={busy}
                  onClick={() => onStimulusContinue({ selected: true })}
                >
                  {runtime.stimulus.ctaLabel}
                </button>
              </div>
              {criteriaOpen ? (
                <div className="alert alert-ok" style={{ marginTop: "1rem" }}>
                  {runtime.stimulus.criteriaDetail}
                </div>
              ) : null}
            </div>
          )}

          {step.type === "debrief" && (
            <>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <button
                className="primary-btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await pushEvents(runtime, [
                      { eventType: "experiment_complete", stepId: step.id, screenId: "complete" }
                    ]);
                    const next = await participantApi<ParticipantView>("submit_step", {
                      participantId: runtime.participantId,
                      stepId: step.id
                    });
                    setRuntime(next);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "실패");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                확인 · 완료
              </button>
            </>
          )}

          {step.type === "complete" && (
            <>
              <h3>참여가 완료되었습니다</h3>
              <p className="muted">응답과 활동 기록이 익명으로 저장되었습니다. 감사합니다.</p>
              {runtime.status !== "completed" ? (
                <button className="primary-btn" type="button" disabled={busy} onClick={finish}>
                  완료 확정
                </button>
              ) : (
                <div className="alert alert-ok">완료됨 · Participant {runtime.participantId}</div>
              )}
            </>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}

export default function ParticipatePage() {
  return (
    <Suspense>
      <ParticipateInner />
    </Suspense>
  );
}
