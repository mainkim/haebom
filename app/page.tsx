"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  FileText,
  FlaskConical,
  MoreHorizontal,
  Sparkles,
  Upload,
  WandSparkles
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { HaebomExampleBanner, HaebomExampleCard } from "@/components/HaebomExample";
import { api, listStudiesApi } from "@/lib/client-api";

type StudyRow = {
  id: string;
  title: string;
  status: string;
  designLabel: string;
  completedN: number;
  assignedN: number;
  targetN: number;
  updatedAt: string;
  joinCode: string;
  isDemo?: boolean;
};

const DEMO_PROMPT =
  "생성형 AI 답변의 출처 표기 여부가 신뢰도와 후속 검색 행동에 미치는 영향을 보고 싶어요.";

const SAMPLE_CARDS = [
  {
    title: "AI 답변의 출처 표기가 신뢰도에 미치는 영향",
    method: "2 × 2 집단 간 실험"
  },
  {
    title: "추천 설명 방식과 구매 전환 연구",
    method: "설문 + 행동 측정"
  },
  {
    title: "대화형 AI 인터뷰 탐색 연구",
    method: "질적 인터뷰"
  }
];

function methodLabel(s: StudyRow) {
  if (s.designLabel) return `${s.designLabel.replace("x", " × ")} 집단 간 실험`;
  if (s.isDemo) return "설문 + 행동 측정";
  return "연구 설계 초안";
}

export default function HomePage() {
  const router = useRouter();
  const [studies, setStudies] = useState<StudyRow[]>([]);
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploads, setUploads] = useState({ plan: true, prior: false, feedback: false });

  async function refresh() {
    const data = await listStudiesApi();
    setStudies((data.studies as StudyRow[] | undefined) ?? []);
  }

  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
  }, []);

  async function seedDemo() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ study: { id: string; joinCode: string } }>("seed_demo");
      setMessage(`샘플 연구 준비 완료 · 참여코드 ${result.study.joinCode}`);
      await refresh();
      router.push(`/studies/${result.study.id}?tab=conditions`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  async function startAi() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ study: { id: string } }>("create_from_prompt", { prompt });
      router.push(`/studies/${result.study.id}?tab=design`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="page-title">
        <div>
          <span className="pill mint">연구자 워크스페이스</span>
          <h1>어떤 연구를 앱으로 만들까요?</h1>
          <p>연구 질문을 넣으면 AI가 OpenAlex에서 논문을 찾고, 그 자료만으로 실험 초안을 만듭니다.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="outline-btn" href="/demo">
            <BookOpen size={17} />
            60초 데모
          </Link>
          <button className="primary-btn" type="button" onClick={seedDemo} disabled={busy}>
            {busy ? "준비 중…" : "샘플 연구 보기"}
          </button>
        </div>
      </div>

      {message ? <div className="alert alert-ok">{message}</div> : null}

      <HaebomExampleBanner />

      <div className="composer-card">
        <div className="ai-orb">
          <Sparkles size={21} />
        </div>
        <div className="composer-copy">
          <strong>가설을 말하면 문헌부터 찾습니다.</strong>
          <span>
            OpenAlex 검색 → 자료실 → RAG 자극 초안. AI는 타당성·IRB·논문 통과를 보장하지 않습니다.
          </span>
        </div>
        <textarea aria-label="연구 설명" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="upload-row">
          <button
            type="button"
            className={uploads.plan ? "attached" : ""}
            onClick={() => setUploads((u) => ({ ...u, plan: !u.plan }))}
          >
            <Upload size={17} />
            연구계획서.pdf
          </button>
          <button
            type="button"
            className={uploads.prior ? "attached" : ""}
            onClick={() => setUploads((u) => ({ ...u, prior: !u.prior }))}
          >
            <Upload size={17} />
            선행연구 추가
          </button>
          <button
            type="button"
            className={uploads.feedback ? "attached" : ""}
            onClick={() => setUploads((u) => ({ ...u, feedback: !u.feedback }))}
          >
            <FileText size={17} />
            교수님 피드백
          </button>
          <button className="primary" type="button" onClick={startAi} disabled={busy || !prompt.trim()}>
            <WandSparkles size={17} />
            {busy ? "문헌 검색·초안 생성 중…" : "AI 연구 설계 시작"}
          </button>
        </div>
      </div>

      <div className="section-head">
        <div>
          <h2>최근 연구</h2>
          <p>마지막 작업부터 이어서 진행하세요.</p>
        </div>
        <Link href="/studies">
          전체 보기 <ChevronRight size={16} />
        </Link>
      </div>

      <div className="study-grid" style={{ marginBottom: 16 }}>
        <HaebomExampleCard />
      </div>

      {!studies.length ? (
        <div className="study-grid">
          {SAMPLE_CARDS.map((card) => (
            <button
              key={card.title}
              type="button"
              className="study-card study-card-btn"
              onClick={seedDemo}
              disabled={busy}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <div className="ai-orb">
                  <FlaskConical size={18} />
                </div>
                <MoreHorizontal size={18} className="muted" />
              </div>
              <h3 style={{ margin: "14px 0 6px", fontSize: 15 }}>{card.title}</h3>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {card.method}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="study-grid">
          {studies.map((s) => {
            const liveLabel = s.status === "published" ? "Live" : s.status === "closed" ? "Closed" : "Draft";
            return (
              <Link key={s.id} href={`/studies/${s.id}`} className="study-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div className="ai-orb">
                    <FlaskConical size={18} />
                  </div>
                  <span className={`pill ${liveLabel === "Live" ? "mint" : "amber"}`}>{liveLabel}</span>
                </div>
                <h3 style={{ margin: "14px 0 6px", fontSize: 15 }}>{s.title}</h3>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  {methodLabel(s)}
                  {s.isDemo ? " · DEMO" : ""}
                </p>
                <p className="muted" style={{ margin: "12px 0 0", fontSize: 11 }}>
                  완료 {s.completedN} · 배정 {s.assignedN}
                  {s.targetN ? ` / 목표 ${s.targetN}` : ""}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
