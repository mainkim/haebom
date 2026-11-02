import { useEffect, useMemo, useRef, useState } from "react";
import { loadParticipantView, participantApi } from "./api";
import { anonymousSessionAdapter } from "./session/adapter";
import type { ParticipantView, PublicMeasure } from "./types";

function joinCodeFromPath(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const marker = parts.indexOf("p");
  const code = marker >= 0 ? parts[marker + 1] : "";
  if (!code || !/^[a-z0-9]{4,16}$/i.test(code)) return null;
  return code;
}

function eventId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `evt_${crypto.randomUUID()}`;
  return `evt_${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export function App() {
  const code = useMemo(() => joinCodeFromPath(), []);
  const [view, setView] = useState<ParticipantView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const started = useRef(Date.now());
  const shownAt = useRef<number | null>(null);

  async function track(
    current: ParticipantView,
    partials: Array<{ eventType: string; stepId?: string; screenId?: string; objectId?: string; payload?: Record<string, string | number | boolean> }>
  ) {
    const events = partials.map((partial) => {
      seq.current += 1;
      return {
        eventId: eventId(),
        eventType: partial.eventType,
        stepId: partial.stepId,
        screenId: partial.screenId,
        objectId: partial.objectId,
        sequenceNo: seq.current,
        clientTimestamp: new Date().toISOString(),
        elapsedMs: Date.now() - started.current,
        payload: partial.payload
      };
    });
    await participantApi("events", { participantId: current.participantId, events });
  }

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      const session = await anonymousSessionAdapter.current();
      if (session.kind !== "anonymous" || cancelled) return;
      try {
        const storageKey = `haebom_participant_${code}`;
        const existing = sessionStorage.getItem(storageKey);
        let next: ParticipantView;
        if (existing) {
          try {
            next = await loadParticipantView("runtime", { participantId: existing });
          } catch {
            next = await loadParticipantView("join", { joinCode: code, channel: "toss_miniapp" });
            sessionStorage.setItem(storageKey, next.participantId);
          }
        } else {
          next = await loadParticipantView("join", { joinCode: code, channel: "toss_miniapp" });
          sessionStorage.setItem(storageKey, next.participantId);
        }
        if (cancelled) return;
        setView(next);
        started.current = Date.now();
        await track(next, [{ eventType: "screen_view", screenId: "join", stepId: next.currentStepId }]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "참여를 시작하지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const step = view?.flow.find((item) => item.id === view.currentStepId) ?? null;
  const stepIndex = view ? Math.max(0, view.flow.findIndex((item) => item.id === view.currentStepId)) : 0;

  useEffect(() => {
    if (!view || !step) return;
    if (step.type !== "stimulus" && step.type !== "behavior_task") return;
    shownAt.current = Date.now();
    track(view, [{ eventType: "stimulus_impression", stepId: step.id, screenId: "stimulus", objectId: "stimulus_view" }]).catch(
      () => undefined
    );
  }, [view?.currentStepId]);

  async function onConsent() {
    if (!view || !step) return;
    setBusy(true);
    setError(null);
    try {
      await track(view, [{ eventType: "step_submit", stepId: step.id, screenId: "consent" }]);
      setView(await loadParticipantView("consent", { participantId: view.participantId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "동의 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onSurvey(measureIds: string[]) {
    if (!view || !step || step.type !== "survey") return;
    if (measureIds.some((id) => answers[id] == null || answers[id] === "")) {
      setError("필수 문항에 응답해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await track(view, [
        { eventType: "survey_submit", stepId: step.id, screenId: step.stage },
        { eventType: "step_submit", stepId: step.id }
      ]);
      const next = await loadParticipantView("submit_step", {
        participantId: view.participantId,
        stepId: step.id,
        responses: measureIds.map((id) => ({ measureId: id, value: answers[id] }))
      });
      setView(next);
      setAnswers({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "응답을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onStimulusContinue(selected: boolean) {
    if (!view || !step) return;
    setBusy(true);
    setError(null);
    try {
      const events: Array<{ eventType: string; stepId?: string; screenId?: string; objectId?: string }> = [];
      if (criteriaOpen) {
        events.push({ eventType: "object_click", stepId: step.id, screenId: "stimulus", objectId: "criteria_button" });
      }
      if (selected) {
        events.push({ eventType: "object_click", stepId: step.id, screenId: "stimulus", objectId: "recommendation_select" });
      }
      events.push({ eventType: "step_submit", stepId: step.id, screenId: "stimulus" });
      await track(view, events);
      const next = await loadParticipantView("submit_step", {
        participantId: view.participantId,
        stepId: step.id,
        criteriaOpened: criteriaOpen,
        recommendationSelected: selected,
        stimulusDurationMs: shownAt.current ? Date.now() - shownAt.current : 0
      });
      setView(next);
      setCriteriaOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "다음으로 넘어가지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onDebrief() {
    if (!view || !step) return;
    setBusy(true);
    setError(null);
    try {
      await track(view, [{ eventType: "step_submit", stepId: step.id, screenId: "debrief" }]);
      setView(await loadParticipantView("submit_step", { participantId: view.participantId, stepId: step.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "완료 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onFinish() {
    if (!view || !step) return;
    setBusy(true);
    setError(null);
    try {
      await track(view, [{ eventType: "experiment_complete", stepId: step.id, screenId: "complete" }]);
      if (view.status !== "completed") {
        setView(await loadParticipantView("complete", { participantId: view.participantId }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "완료 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function renderMeasure(measure: PublicMeasure) {
    if (!view || !step) return null;
    const choice = measure.type === "choice" || measure.type === "manipulation_check";
    if (choice) {
      return (
        <fieldset key={measure.id} className="field">
          <legend>{measure.questionText}</legend>
          <div className="choices">
            {(measure.options ?? []).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={answers[measure.id] === option}
                onClick={() => {
                  setAnswers((current) => ({ ...current, [measure.id]: option }));
                  track(view, [{ eventType: "response_change", stepId: step.id, objectId: measure.id, payload: { value: option } }]).catch(
                    () => undefined
                  );
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>
      );
    }
    const min = measure.scaleMin ?? 1;
    const max = measure.scaleMax ?? 7;
    const points = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    return (
      <fieldset key={measure.id} className="field">
        <legend>{measure.questionText}</legend>
        <div className="scale" role="radiogroup" aria-label={measure.questionText}>
          {points.map((point) => (
            <button
              key={point}
              type="button"
              aria-pressed={answers[measure.id] === point}
              onClick={() => {
                setAnswers((current) => ({ ...current, [measure.id]: point }));
                track(view, [{ eventType: "response_change", stepId: step.id, objectId: measure.id, payload: { value: point } }]).catch(
                  () => undefined
                );
              }}
            >
              {point}
            </button>
          ))}
        </div>
        {measure.scaleLabels ? (
          <div className="scale-ends">
            <span>{measure.scaleLabels[0]}</span>
            <span>{measure.scaleLabels[measure.scaleLabels.length - 1]}</span>
          </div>
        ) : null}
      </fieldset>
    );
  }

  if (!code) {
    return (
      <main className="app">
        <p className="brand">해봄리서치</p>
        <h1>참여 링크를 확인해 주세요</h1>
        <p className="hint">주소의 참여 코드가 없거나 형식이 맞지 않습니다.</p>
      </main>
    );
  }

  const progress = view && view.flow.length > 1 ? Math.round((stepIndex / (view.flow.length - 1)) * 100) : 0;

  return (
    <main className="app">
      <p className="brand">해봄리서치</p>
      {!view && !error ? <p className="hint">참여 준비 중</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {view ? (
        <>
          <h1>{view.studyTitle}</h1>
          <p className="meta">Participant {view.participantId.slice(0, 16)}</p>
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="hint">
            {stepIndex + 1} / {view.flow.length}
          </p>
        </>
      ) : null}

      {view && step ? (
        <section className="card" aria-live="polite">
          {step.type === "consent" ? (
            <>
              <h2>참여 안내</h2>
              <p>{view.consentText}</p>
              <button className="primary" type="button" disabled={busy} onClick={onConsent}>
                동의하고 시작하기
              </button>
            </>
          ) : null}

          {step.type === "survey" ? (
            <>
              <h2>{step.title}</h2>
              {step.measureIds
                .map((id) => view.measures.find((measure) => measure.id === id))
                .filter((measure): measure is PublicMeasure => Boolean(measure))
                .map((measure) => renderMeasure(measure))}
              <button className="primary" type="button" disabled={busy} onClick={() => onSurvey(step.measureIds)}>
                다음
              </button>
            </>
          ) : null}

          {step.type === "stimulus" || step.type === "behavior_task" ? (
            <>
              <h2>{view.stimulus.title}</h2>
              <p>{view.stimulus.body}</p>
              {view.stimulus.reasonShown && view.stimulus.reasonText ? <p>{view.stimulus.reasonText}</p> : null}
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setCriteriaOpen(true);
                  track(view, [
                    { eventType: "object_click", stepId: step.id, screenId: "stimulus", objectId: "criteria_button" }
                  ]).catch(() => undefined);
                }}
              >
                {view.stimulus.criteriaButtonLabel}
              </button>
              <button className="primary" type="button" disabled={busy} onClick={() => onStimulusContinue(true)}>
                {view.stimulus.ctaLabel}
              </button>
              {criteriaOpen ? <div className="detail">{view.stimulus.criteriaDetail}</div> : null}
            </>
          ) : null}

          {step.type === "debrief" ? (
            <>
              <h2>{step.title}</h2>
              <p>{step.body || view.debriefText}</p>
              <button className="primary" type="button" disabled={busy} onClick={onDebrief}>
                확인
              </button>
            </>
          ) : null}

          {step.type === "complete" ? (
            <>
              <h2>참여가 완료되었습니다</h2>
              <p>응답과 활동 기록은 익명 Participant ID로 저장되었습니다.</p>
              {view.status !== "completed" ? (
                <button className="primary" type="button" disabled={busy} onClick={onFinish}>
                  완료 확정
                </button>
              ) : null}
              <section className="reward" aria-label="리워드 상태">
                <strong>{view.reward.title}</strong>
                <p>{view.reward.detail}</p>
                <p>상태: 지급 연동 전</p>
              </section>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
