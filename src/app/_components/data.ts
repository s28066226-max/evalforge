import { getStore } from "@/lib/store.ts";
import { summarize, summarizeRetrieval, type ModelSummary } from "@/lib/summary.ts";

/** Everything a run page needs, from whichever store is active (local SQLite or published JSON). */
export async function loadRun(id: string) {
  const store = await getStore();
  const run = store.getRun(id);
  if (!run) return null;
  const results = store.getResults(id);
  const retrievals = store.getRetrievals(id);
  const unanswerable = new Set(run.questions.filter((q) => q.unanswerable).map((q) => q.id));
  return {
    source: store.source,
    run,
    results,
    retrievals,
    summary: summarize(results, run.config.models, run.config.baseline, unanswerable),
    retrieval: summarizeRetrieval(run.questions, retrievals),
  };
}

/** The run to feature: the newest completed live run, else the newest run of any kind. */
export async function featuredRunId(): Promise<string | null> {
  const runs = (await getStore()).listRuns();
  return (runs.find((r) => r.status === "done" && r.config.provider === "live") ?? runs[0])?.id ?? null;
}

const nanLast = (x: number) => (Number.isNaN(x) ? -Infinity : x);

/** Best first: faithfulness, then correctness, then lower median latency. */
export function ranked(models: ModelSummary[]): ModelSummary[] {
  return [...models].sort(
    (a, b) =>
      nanLast(b.faithfulness) - nanLast(a.faithfulness) ||
      nanLast(b.correctness) - nanLast(a.correctness) ||
      a.latencyP50 - b.latencyP50,
  );
}
