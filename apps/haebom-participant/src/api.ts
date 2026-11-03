import { buildParticipantRequestBody } from "./research-body";
import type { ParticipantView } from "./types";

function apiBase(): string {
  const configured = import.meta.env.VITE_HAEBOM_API_BASE?.trim();
  if (configured) {
    const base = configured.replace(/\/$/, "");
    // Checklist: API traffic stays on HTTPS. Local dev keeps the localhost fallback.
    // https://developers-apps-in-toss.toss.im/checklist/app-nongame
    if (!import.meta.env.DEV && !base.startsWith("https://")) {
      throw new Error("참여 서버 주소는 HTTPS여야 합니다.");
    }
    return base;
  }
  if (import.meta.env.DEV) return "http://localhost:3000";
  throw new Error("참여 서버 주소가 설정되지 않았습니다.");
}

export async function participantApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${apiBase()}/api/participant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildParticipantRequestBody(action, body))
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data as T;
}

export function loadParticipantView(action: string, body: Record<string, unknown>) {
  return participantApi<ParticipantView>(action, body);
}
