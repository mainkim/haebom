/**
 * Session boundary for a future Toss login.
 *
 * This build stays anonymous. A later adapter may hold a Toss linkage in memory
 * for promotion calls. It must not copy userKey, name, email, or phone into
 * research events, survey answers, or the participant id.
 * On withdrawal, delete only that linkage. Do not delete anonymous research rows.
 */
export type AnonymousSession = {
  kind: "anonymous";
};

export interface SessionAdapter {
  current(): Promise<AnonymousSession>;
}

export const anonymousSessionAdapter: SessionAdapter = {
  async current() {
    return { kind: "anonymous" };
  }
};
