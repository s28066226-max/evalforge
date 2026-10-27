import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ResultRow, RunConfig, RunRow } from "./types.ts";

let db: DatabaseSync | undefined;

export function dbPath(): string {
  return process.env.EVALFORGE_DB || path.join(process.cwd(), "data", "evalforge.db");
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = dbPath();
  mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      config TEXT NOT NULL,
      question_count INTEGER NOT NULL,
      questions TEXT NOT NULL,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS results (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      model TEXT NOT NULL,
      answer TEXT NOT NULL,
      refused INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      latency_ms REAL NOT NULL,
      cost_usd REAL NOT NULL,
      faithfulness REAL NOT NULL,
      relevance REAL NOT NULL,
      correctness REAL,
      abstained INTEGER NOT NULL,
      claims TEXT NOT NULL,
      rationale TEXT NOT NULL,
      PRIMARY KEY (run_id, question_id, model)
    );
    CREATE TABLE IF NOT EXISTS retrievals (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      chunks TEXT NOT NULL,
      PRIMARY KEY (run_id, question_id)
    );
  `);
  return db;
}

export interface StoredQuestion {
  id: string;
  question: string;
  reference?: string;
  unanswerable?: boolean;
  sources?: string[];
}

export function createRun(id: string, config: RunConfig, questions: StoredQuestion[]): void {
  getDb()
    .prepare("INSERT INTO runs (id, created_at, status, config, question_count, questions) VALUES (?, ?, 'running', ?, ?, ?)")
    .run(id, new Date().toISOString(), JSON.stringify(config), questions.length, JSON.stringify(questions));
}

export function finishRun(id: string, error: string | null = null): void {
  getDb()
    .prepare("UPDATE runs SET status = ?, error = ? WHERE id = ?")
    .run(error ? "failed" : "done", error, id);
}

export function saveRetrieval(runId: string, questionId: string, chunks: unknown): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO retrievals (run_id, question_id, chunks) VALUES (?, ?, ?)")
    .run(runId, questionId, JSON.stringify(chunks));
}

export function saveResult(r: ResultRow): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO results (run_id, question_id, model, answer, refused, input_tokens, output_tokens,
        latency_ms, cost_usd, faithfulness, relevance, correctness, abstained, claims, rationale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.runId, r.questionId, r.model, r.answer, r.refused ? 1 : 0, r.inputTokens, r.outputTokens,
      r.latencyMs, r.costUsd, r.faithfulness, r.relevance, r.correctness, r.abstained ? 1 : 0,
      JSON.stringify(r.claims), r.rationale,
    );
}

type Raw = Record<string, unknown>;

function toRun(row: Raw): RunRow {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    status: row.status as RunRow["status"],
    config: JSON.parse(row.config as string) as RunConfig,
    questionCount: row.question_count as number,
    error: (row.error as string | null) ?? null,
  };
}

export function listRuns(): RunRow[] {
  return (getDb().prepare("SELECT * FROM runs ORDER BY created_at DESC").all() as Raw[]).map(toRun);
}

export function getRun(id: string): (RunRow & { questions: StoredQuestion[] }) | null {
  const row = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Raw | undefined;
  if (!row) return null;
  return { ...toRun(row), questions: JSON.parse(row.questions as string) as StoredQuestion[] };
}

export function getResults(runId: string): ResultRow[] {
  const rows = getDb().prepare("SELECT * FROM results WHERE run_id = ?").all(runId) as Raw[];
  return rows.map((r) => ({
    runId: r.run_id as string,
    questionId: r.question_id as string,
    model: r.model as string,
    answer: r.answer as string,
    refused: r.refused === 1,
    inputTokens: r.input_tokens as number,
    outputTokens: r.output_tokens as number,
    latencyMs: r.latency_ms as number,
    costUsd: r.cost_usd as number,
    faithfulness: r.faithfulness as number,
    relevance: r.relevance as number,
    correctness: (r.correctness as number | null) ?? null,
    abstained: r.abstained === 1,
    claims: JSON.parse(r.claims as string),
    rationale: r.rationale as string,
  }));
}

export function getRetrieval(runId: string, questionId: string) {
  const row = getDb()
    .prepare("SELECT chunks FROM retrievals WHERE run_id = ? AND question_id = ?")
    .get(runId, questionId) as Raw | undefined;
  return row ? (JSON.parse(row.chunks as string) as { id: string; docTitle: string; text: string; score: number }[]) : [];
}

export function getRetrievals(runId: string): Map<string, { id: string; docTitle: string; text: string; score: number }[]> {
  const rows = getDb().prepare("SELECT question_id, chunks FROM retrievals WHERE run_id = ?").all(runId) as Raw[];
  return new Map(rows.map((r) => [r.question_id as string, JSON.parse(r.chunks as string)]));
}
