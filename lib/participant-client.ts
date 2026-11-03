/** Browser calls for the public web participant page. The mini-app keeps its own client. */
export async function participantApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/participant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body })
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data as T;
}