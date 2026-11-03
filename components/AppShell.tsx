"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bot,
  BookOpen,
  CircleHelp,
  ClipboardCheck,
  FlaskConical,
  Home,
  Layers3,
  MessageSquareText,
  Play,
  Plus,
  Search,
  Settings
} from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { StudyNavProvider, useStudyNav } from "./StudyNavContext";

function HaebomLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Image
      src={compact ? "/haebom-symbol.png" : "/haebom-logo.png"}
      alt="해봄 HAEBOM RESEARCH"
      width={compact ? 40 : 174}
      height={compact ? 40 : 48}
      className="brand"
      priority
      unoptimized
    />
  );
}

export { HaebomLogo };

function SidebarNav() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { studyId, joinCode } = useStudyNav();
  const tab = search.get("tab");

  const studyBase = studyId ? `/studies/${studyId}` : null;

  const nav = [
    { href: "/", id: "home", icon: Home, label: "홈" },
    {
      href: studyBase ? `${studyBase}?tab=design` : "/studies/new",
      id: "brief",
      icon: Bot,
      label: "AI 연구 브리프",
      activeWhen: () => pathname === "/studies/new" || (pathname?.startsWith("/studies/") && tab === "design")
    },
    {
      href: studyBase ? `${studyBase}?tab=sources` : "/studies/new",
      id: "sources",
      icon: BookOpen,
      label: "자료·계보",
      activeWhen: () => !!pathname?.startsWith("/studies/") && tab === "sources"
    },
    {
      href: studyBase ? `${studyBase}?tab=conditions` : "/studies/new",
      id: "studio",
      icon: Layers3,
      label: "조건·자극",
      activeWhen: () =>
        !!pathname?.startsWith("/studies/") &&
        pathname !== "/studies/new" &&
        (tab === "conditions" || tab === "stimuli")
    },
    {
      href: studyBase ? `${studyBase}?tab=qa` : "/studies/new",
      id: "measure",
      icon: FlaskConical,
      label: "측정 설계",
      activeWhen: () =>
        !!pathname?.startsWith("/studies/") &&
        (tab === "qa" || tab === "survey" || tab === "behavior")
    },
    {
      href: studyBase ? `${studyBase}?tab=publish` : "/studies/new",
      id: "review",
      icon: ClipboardCheck,
      label: "검토·승인",
      activeWhen: () => !!pathname?.startsWith("/studies/") && tab === "publish"
    },
    {
      href: studyBase ? `${studyBase}?tab=recruit` : joinCode ? `/toss?code=${joinCode}` : "/toss",
      id: "launch",
      icon: Play,
      label: "모집·실행",
      activeWhen: () =>
        pathname?.startsWith("/toss") ||
        pathname?.startsWith("/p/") ||
        (!!pathname?.startsWith("/studies/") && tab === "recruit")
    }
  ] as const;

  return (
    <nav>
      {nav.map((item) => {
        const Icon = item.icon;
        const active = "activeWhen" in item && item.activeWhen ? item.activeWhen() : pathname === item.href;
        return (
          <Link key={item.id} href={item.href} className={active ? "active" : ""}>
            <Icon size={18} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ResearcherShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/">
          <HaebomLogo />
        </Link>
        <Link href="/studies/new" className="new-study">
          <Plus size={17} />
          <span>새 연구 만들기</span>
        </Link>
        <Suspense fallback={<nav />}>
          <SidebarNav />
        </Suspense>
        <div className="sidebar-bottom">
          <Link href="/demo">
            <Play size={18} />
            <span>데모</span>
          </Link>
          <Link href="/about">
            <CircleHelp size={18} />
            <span>소개</span>
          </Link>
          <Link href="/pricing">
            <Settings size={18} />
            <span>요금</span>
          </Link>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="search">
            <Search size={17} />
            <span>연구, 문서, 참가자 검색</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="top-actions">
            <span className="pill mint">AI 안전 모드</span>
            <span className="demo-badge">DEMO</span>
            <button className="icon-btn" type="button" aria-label="메시지">
              <MessageSquareText size={18} />
            </button>
            <div className="avatar">김</div>
            <span className="user-name">김해인</span>
            <button
              className="outline-btn"
              type="button"
              onClick={async () => {
                await fetch("/api/admin/session", { method: "DELETE" });
                window.location.assign("/");
              }}
            >
              잠그기
            </button>
          </div>
        </header>
        <section className="content">{children}</section>
        <footer className="site-footer">
          <span>해봄 · Founder 김해인 · 가설에서 데이터까지, 코딩 없이</span>
          <span className="demo-badge">DEMO / MOCK DATA</span>
        </footer>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  studyId = null,
  joinCode = null
}: {
  children: ReactNode;
  studyId?: string | null;
  joinCode?: string | null;
}) {
  const pathname = usePathname();

  if (pathname?.startsWith("/p/")) {
    return (
      <div className="participant-shell">
        <header className="participant-header">
          <Link href="/toss">
            <HaebomLogo compact />
          </Link>
          <div>
            <strong>해봄 참여하기</strong>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              설문과 행동이 하나의 Participant ID로 연결됩니다
            </p>
          </div>
        </header>
        <main className="participant-main">{children}</main>
        <footer className="site-footer">
          <span>해봄 · Founder 김해인</span>
          <span className="demo-badge">DEMO / MOCK DATA</span>
        </footer>
      </div>
    );
  }

  return (
    <StudyNavProvider studyId={studyId} joinCode={joinCode}>
      <ResearcherShell>{children}</ResearcherShell>
    </StudyNavProvider>
  );
}
