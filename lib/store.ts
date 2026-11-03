import { randomBytes, createHash } from "crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  statSync
} from "fs";
import path from "path";
import type { DbShape } from "./types";
import { emptyDb, nowIso } from "./store-shape";
import { mutateHaebomDocument, neonDocumentDb, readHaebomDocument } from "./store-postgres";

export { emptyDb, nowIso };

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

type GlobalDb = typeof globalThis & {
  __haebomDb?: DbShape;
};

function g(): GlobalDb {
  return globalThis as GlobalDb;
}

export type StoreBackend = "file" | "postgres";

/**
 * Postgres when DATABASE_URL is set (Neon connection string from the Vercel integration).
 * HAEBOM_STORE=file forces the local JSON file even if a URL is present, so tests and
 * the headless demo never touch a remote database.
 */
export function storeBackend(): StoreBackend {
  if (process.env.HAEBOM_STORE === "file") return "file";
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) return "postgres";
  return "file";
}

function dataDir(): string {
  if (process.env.HAEBOM_DATA_DIR && process.env.HAEBOM_DATA_DIR.trim()) {
    return process.env.HAEBOM_DATA_DIR;
  }
  if (IS_SERVERLESS) return path.join("/tmp", "haebom-data");
  return path.join(process.cwd(), "data");
}

function dbPath(): string {
  return path.join(dataDir(), "haebom.json");
}

function lockPath(): string {
  return path.join(dataDir(), "haebom.lock");
}

const STALE_LOCK_MS = 5_000;

function ensureDir() {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sleepSpin(ms: number) {
  const waitUntil = Date.now() + ms;
  while (Date.now() < waitUntil) {
    /* spin */
  }
}

function isStaleLock(): boolean {
  try {
    const age = Date.now() - statSync(lockPath()).mtimeMs;
    return age > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function forceUnlock() {
  for (const p of [lockPath(), lockPath() + ".tmp"]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function acquireLock(retries = 80): void {
  ensureDir();
  for (let i = 0; i < retries; i++) {
    try {
      writeFileSync(lockPath(), `${process.pid}:${Date.now()}`, { flag: "wx" });
      return;
    } catch {
      if (isStaleLock()) {
        forceUnlock();
        continue;
      }
      sleepSpin(25);
    }
  }
  if (IS_SERVERLESS) {
    forceUnlock();
    try {
      writeFileSync(lockPath(), `${process.pid}:${Date.now()}`, { flag: "wx" });
      return;
    } catch {
      /* fall through */
    }
  }
  throw new Error("Could not acquire DB lock");
}

function releaseLock() {
  forceUnlock();
}

function loadDbFromDisk(): DbShape {
  ensureDir();
  const file = dbPath();
  if (!existsSync(file)) {
    const db = emptyDb();
    try {
      writeFileSync(file, JSON.stringify(db, null, 2));
    } catch {
      /* /tmp write may fail in extreme cases; keep in-memory */
    }
    return db;
  }
  const raw = readFileSync(file, "utf8");
  return JSON.parse(raw) as DbShape;
}

function persistDb(db: DbShape) {
  ensureDir();
  const file = dbPath();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, file);
}

function getMemoryDb(): DbShape {
  const store = g();
  if (!store.__haebomDb) {
    store.__haebomDb = loadDbFromDisk();
  }
  return store.__haebomDb;
}

function setMemoryDb(db: DbShape) {
  g().__haebomDb = db;
}

/** Test helper. Clears the in-process file cache so the next read hits disk. */
export function resetMemoryCache(): void {
  g().__haebomDb = undefined;
}

export async function readDb(): Promise<DbShape> {
  if (storeBackend() === "postgres") {
    const url = process.env.DATABASE_URL!.trim();
    return readHaebomDocument(await neonDocumentDb(url));
  }
  if (IS_SERVERLESS) {
    return structuredClone(getMemoryDb());
  }
  return loadDbFromDisk();
}

function withFileDb<T>(fn: (db: DbShape) => T): T {
  acquireLock();
  try {
    if (IS_SERVERLESS) {
      const db = getMemoryDb();
      const result = fn(db);
      db.meta.updatedAt = nowIso();
      setMemoryDb(db);
      try {
        persistDb(db);
      } catch {
        /* memory remains source of truth for this isolate */
      }
      return result;
    }

    const db = loadDbFromDisk();
    const result = fn(db);
    db.meta.updatedAt = nowIso();
    persistDb(db);
    return result;
  } finally {
    releaseLock();
  }
}

export async function withDb<T>(fn: (db: DbShape) => T): Promise<T> {
  if (storeBackend() === "postgres") {
    const url = process.env.DATABASE_URL!.trim();
    return mutateHaebomDocument(await neonDocumentDb(url), fn);
  }
  return withFileDb(fn);
}

export async function withDbRead<T>(fn: (db: DbShape) => T): Promise<T> {
  return fn(await readDb());
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function shortCode(len = 8): string {
  return randomBytes(Math.ceil(len / 2))
    .toString("hex")
    .slice(0, len)
    .toUpperCase();
}

export function hashSeed(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}
