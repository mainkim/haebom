import type { DbShape } from "./types";
import { emptyDb, nowIso } from "./store-shape";

/**
 * Durable document store on Neon Postgres.
 *
 * The app still mutates one DbShape (the same document as data/haebom.json).
 * Postgres keeps that document in a single row so Vercel isolates do not lose
 * it when /tmp and memory are wiped. Writes use a version check so two
 * serverless invocations cannot silently overwrite each other.
 *
 * Queries are parameterized. User content never becomes SQL text.
 */

export const HAEBOM_DOCUMENT_ID = "primary";

export const ENSURE_DOCUMENT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS haebom_document (
  id text PRIMARY KEY,
  version integer NOT NULL,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`.trim();

export interface QueryRow {
  [column: string]: unknown;
}

export interface DocumentDb {
  query(sql: string, params?: unknown[]): Promise<QueryRow[]>;
}

const MAX_ATTEMPTS = 8;

function asDocument(raw: unknown): DbShape {
  if (typeof raw === "string") return JSON.parse(raw) as DbShape;
  if (raw && typeof raw === "object") return structuredClone(raw) as DbShape;
  throw new Error("Haebom document payload is missing");
}

export async function ensureDocumentTable(db: DocumentDb): Promise<void> {
  await db.query(ENSURE_DOCUMENT_TABLE_SQL);
}

export async function readHaebomDocument(db: DocumentDb): Promise<DbShape> {
  await ensureDocumentTable(db);
  const rows = await db.query(
    "SELECT document FROM haebom_document WHERE id = $1",
    [HAEBOM_DOCUMENT_ID]
  );
  if (!rows.length) return emptyDb();
  return asDocument(rows[0].document);
}

export async function mutateHaebomDocument<T>(db: DocumentDb, fn: (doc: DbShape) => T): Promise<T> {
  await ensureDocumentTable(db);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await db.query(
      "SELECT version, document FROM haebom_document WHERE id = $1",
      [HAEBOM_DOCUMENT_ID]
    );

    if (!rows.length) {
      const working = emptyDb();
      const result = fn(working);
      working.meta.updatedAt = nowIso();
      const inserted = await db.query(
        `INSERT INTO haebom_document (id, version, document, updated_at)
         VALUES ($1, 1, $2::jsonb, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING version`,
        [HAEBOM_DOCUMENT_ID, JSON.stringify(working)]
      );
      if (inserted.length) return result;
      continue;
    }

    const version = Number(rows[0].version);
    const working = asDocument(rows[0].document);
    const result = fn(working);
    working.meta.updatedAt = nowIso();
    const updated = await db.query(
      `UPDATE haebom_document
       SET document = $2::jsonb, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $3
       RETURNING version`,
      [HAEBOM_DOCUMENT_ID, JSON.stringify(working), version]
    );
    if (updated.length) return result;
  }
  throw new Error("Haebom document update conflicted too many times");
}

type NeonQuery = (sql: string, params?: unknown[]) => Promise<QueryRow[]>;

let neonDb: DocumentDb | null = null;
let neonUrl: string | null = null;

/** Neon HTTP driver. Loaded only when a write or read actually needs Postgres. */
export async function neonDocumentDb(databaseUrl: string): Promise<DocumentDb> {
  if (neonDb && neonUrl === databaseUrl) return neonDb;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(databaseUrl);
  const query = sql.query.bind(sql) as NeonQuery;
  neonUrl = databaseUrl;
  neonDb = {
    query(text, params) {
      return query(text, params ?? []);
    }
  };
  return neonDb;
}

export function resetNeonClientForTests(): void {
  neonDb = null;
  neonUrl = null;
}
