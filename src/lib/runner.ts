import { randomUUID } from "node:crypto";
import { createRun, finishRun, saveResult, saveRetrieval } from "./db.ts";
import { costUsd } from "./pricing.ts";
import { makeProvider } from "./providers.ts";
import { BM25Index, chunkDocs } from "./retrieval.ts";
import type { Dataset, RunConfig } from "./types.ts";

export interface Progress {
  done: number;
  total: number;
  failed: number;
  last?: string;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `run_${stamp}_${randomUUID().slice(0, 4)}`;
}

/**
 * The pipeline: retrieve -> answer (each model) -> judge -> store.
 * Every model sees the identical retrieved context, so differences in scores
 * come from the model, not from retrieval luck.
 */
export async function runEval(
  dataset: Dataset,
  config: RunConfig,
  opts: { concurrency?: number; onProgress?: (p: Progress) => void } = {},
): Promise<{ runId: string; failed: number }> {
  const runId = newRunId();
  const provider = makeProvider(config.provider);
  const index = new BM25Index(chunkDocs(dataset.docs));
  createRun(runId, config, dataset.questions);

  const retrieved = new Map(
    dataset.questions.map((q) => {
      const chunks = index.search(q.question, config.topK);
      saveRetrieval(runId, q.id, chunks);
      return [q.id, chunks] as const;
    }),
  );

  const tasks = dataset.questions.flatMap((q) => config.models.map((model) => ({ q, model })));
  const progress: Progress = { done: 0, total: tasks.length, failed: 0 };
  const errors: string[] = [];

  await pool(tasks, opts.concurrency ?? 4, async ({ q, model }) => {
    const chunks = retrieved.get(q.id)!;
    try {
      const answer = await provider.answer(model, q.question, chunks, config.effort);
      const verdict = answer.refused
        ? { claims: [], relevance: 1, correctness: q.reference || q.unanswerable ? 1 : null, abstained: false, rationale: "Model refused." }
        : await provider.judge(config.judgeModel, q, chunks, answer.text);
      const supported = verdict.claims.filter((c) => c.supported).length;
      saveResult({
        runId,
        questionId: q.id,
        model,
        answer: answer.text,
        refused: answer.refused,
        inputTokens: answer.usage.inputTokens,
        outputTokens: answer.usage.outputTokens,
        latencyMs: answer.latencyMs,
        costUsd: costUsd(model, answer.usage),
        // An answer with no factual claims (e.g. an abstention) hallucinated nothing.
        faithfulness: verdict.claims.length ? supported / verdict.claims.length : 1,
        relevance: verdict.relevance,
        correctness: verdict.correctness,
        abstained: verdict.abstained,
        claims: verdict.claims,
        rationale: verdict.rationale,
      });
    } catch (err) {
      progress.failed++;
      errors.push(`${model} / ${q.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    progress.done++;
    progress.last = `${model} / ${q.id}`;
    opts.onProgress?.({ ...progress });
  });

  finishRun(runId, errors.length ? `${errors.length} task(s) failed. First: ${errors[0]}` : null);
  return { runId, failed: progress.failed };
}
