async function readBody(res: Response): Promise<Record<string, unknown>> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if ((res.status === 401 || res.status === 503) && typeof window !== "undefined") {
    window.location.reload();
  }
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : "Request failed";
    throw new Error(message);
  }
  return data;
}

export async function api<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/haebom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body })
  });
  return (await readBody(res)) as T;
}

export async function listStudiesApi(): Promise<{ studies?: unknown }> {
  const res = await fetch("/api/haebom", { cache: "no-store" });
  return readBody(res);
}
