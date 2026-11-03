"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

type GateState = "loading" | "in" | "out" | "unconfigured";

export function ResearcherGate({ children }: { children: ReactNode }) {
  const inputId = useId();
  const errorId = useId();
  const [state, setState] = useState<GateState>("loading");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 503) {
          setState("unconfigured");
          return;
        }
        setState(res.ok ? "in" : "out");
      } catch {
        if (!cancelled) setState("out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 503) setState("unconfigured");
        setError(data.error || "인증에 실패했습니다.");
        return;
      }
      setKey("");
      setState("in");
    } catch {
      setError("입장 요청을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "in") return children;

  return (
    <div className="login-screen">
      <form className="panel login-card" onSubmit={onSubmit}>
        <Image
          src="/haebom-logo.png"
          alt="해봄 HAEBOM RESEARCH"
          width={174}
          height={48}
          className="brand"
          priority
          unoptimized
        />
        <h1>연구자 입장</h1>
        <p className="muted">연구와 참가자 데이터는 소유자 키로만 열립니다.</p>
        {state === "loading" ? (
          <p role="status">확인 중…</p>
        ) : state === "unconfigured" ? (
          <div className="alert alert-danger" role="alert">
            서버에 연구자 접근 키가 없습니다. 배포 환경의 HAEBOM_ADMIN_KEY를 설정한 뒤 다시 열어 주세요.
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor={inputId}>접근 키</label>
              <input
                id={inputId}
                name="key"
                type="password"
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
                minLength={16}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
            {error ? (
              <div id={errorId} className="alert alert-danger" role="alert">
                {error}
              </div>
            ) : null}
            <button className="primary-btn" type="submit" disabled={busy || key.trim().length < 16}>
              {busy ? "확인 중…" : "들어가기"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

/** Wraps page content so protected pages do not mount, and therefore do not fetch, until the session is valid. */
export function ResearcherBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const openToParticipants = pathname === "/about" || pathname === "/pricing" || pathname.startsWith("/p/");
  if (openToParticipants) return children;
  return <ResearcherGate>{children}</ResearcherGate>;
}
