import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StoredQuestion } from "./db.ts";
import type { ResultRow, RunRow } from "./types.ts";

export interface StoredChunk {
  id: string;
  docTitle: string;
  text: string;
  score: number;
}

export type RunWithQuestions = RunRow & { questions: StoredQuestion[] };

export interface PublishedRun {
  run: RunWithQuestions;
  results: ResultRow[];
  retrievals: Record<string, StoredChunk[]>;
}

/** data/published.json: the runs you chose to share, committed so a deployment can serve them. */
export interface PublishedFile {
  version: 1;
  exportedAt: string;
  runs: PublishedRun[];
}

export interface Store {
  /** "local" reads the SQLite results database; "published" reads data/published.json. */
  source: "local" | "published";
  listRuns(): RunRow[];
  getRun(id: string): RunWithQuestions | null;
  getResults(runId: string): ResultRow[];
  getRetrievals(runId: string): Map<string, StoredChunk[]>;
}

export const publishedPath = () => path.join(process.cwd(), "data", "published.json");

export function readPublished(): PublishedFile {
  const file = publishedPath();
  if (!existsSync(file)) return { version: 1, exportedAt: new Date(0).toISOString(), runs: [] };
  return JSON.parse(readFileSync(file, "utf8")) as PublishedFile;
}

function publishedStore(): Store {
  const { runs } = readPublished();
  const byId = new Map(runs.map((r) => [r.run.id, r]));
  return {
    source: "published",
    listRuns: () => runs.map(({ run: { questions: _q, ...run } }) => run),
    getRun: (id) => byId.get(id)?.run ?? null,
    getResults: (id) => byId.get(id)?.results ?? [],
    getRetrievals: (id) => new Map(Object.entries(byId.get(id)?.retrievals ?? {})),
  };
}

/**
 * Pick the data source. A deployment has no SQLite file (it's gitignored), so it serves the
 * published snapshot; locally the live database wins. EVALFORGE_SOURCE forces either one.
 */
export async function getStore(): Promise<Store> {
  const forced = process.env.EVALFORGE_SOURCE;
  // Same default as dbPath() in db.ts, repeated so a deployment never loads node:sqlite.
  const dbFile = process.env.EVALFORGE_DB || path.join(process.cwd(), "data", "evalforge.db");
  if (forced === "published" || (forced !== "local" && !existsSync(/*turbopackIgnore: true*/ dbFile))) return publishedStore();
  const db = await import("./db.ts");
  return {
    source: "local",
    listRuns: db.listRuns,
    getRun: db.getRun,
    getResults: db.getResults,
    getRetrievals: db.getRetrievals,
  };
}
