import { scoreRetrieval, type RetrievalScore } from "./retrieval.ts";
import { comparePaired, holmAdjust, mean, quantile, type Comparison } from "./stats.ts";
import type { ResultRow } from "./types.ts";

export interface ModelSummary {
  model: string;
  n: number;
  /** Mean share of supported claims per answer. */
  faithfulness: number;
  /** Share of answers containing at least one unsupported claim. */
  hallucinationRate: number;
  correctness: number;
  relevance: number;
  /** On unanswerable questions: share where the model correctly abstained. */
  abstentionRecall: number | null;
  /** On answerable questions: share where the model wrongly abstained. */
  falseAbstentionRate: number | null;
  refusals: number;
  latencyP50: number;
  latencyP95: number;
  totalCost: number;
  costPerAnswer: number;
  tokensPerAnswer: number;
}

export type Metric = "faithfulness" | "correctness" | "relevance";
export const METRICS: Metric[] = ["faithfulness", "correctness", "relevance"];

export interface MetricComparison extends Comparison {
  model: string;
  metric: Metric;
  /** Wilcoxon p-value after Holm-Bonferroni adjustment across every comparison in the run. */
  pAdjusted: number;
  verdict: "better" | "worse" | "no significant difference";
}

export interface RunSummary {
  models: ModelSummary[];
  comparisons: MetricComparison[];
  baseline: string;
}

const ALPHA = 0.05;

export function summarize(
  results: ResultRow[],
  models: string[],
  baseline: string,
  unanswerable: Set<string>,
): RunSummary {
  const byModel = new Map<string, Map<string, ResultRow>>();
  for (const m of models) byModel.set(m, new Map());
  for (const r of results) byModel.get(r.model)?.set(r.questionId, r);

  const summaries: ModelSummary[] = models.map((model) => {
    const rows = [...(byModel.get(model)?.values() ?? [])];
    const unans = rows.filter((r) => unanswerable.has(r.questionId));
    const ans = rows.filter((r) => !unanswerable.has(r.questionId));
    const correctness = rows.flatMap((r) => (r.correctness === null ? [] : [r.correctness]));
    const latencies = rows.map((r) => r.latencyMs);
    const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
    return {
      model,
      n: rows.length,
      faithfulness: mean(rows.map((r) => r.faithfulness)),
      hallucinationRate: mean(rows.map((r) => (r.claims.some((c) => !c.supported) ? 1 : 0))),
      correctness: mean(correctness),
      relevance: mean(rows.map((r) => r.relevance)),
      abstentionRecall: unans.length ? mean(unans.map((r) => (r.abstained ? 1 : 0))) : null,
      falseAbstentionRate: ans.length ? mean(ans.map((r) => (r.abstained ? 1 : 0))) : null,
      refusals: rows.filter((r) => r.refused).length,
      latencyP50: quantile(latencies, 0.5),
      latencyP95: quantile(latencies, 0.95),
      totalCost,
      costPerAnswer: rows.length ? totalCost / rows.length : 0,
      tokensPerAnswer: mean(rows.map((r) => r.inputTokens + r.outputTokens)),
    };
  });

  const base = byModel.get(baseline);
  const raw: Omit<MetricComparison, "pAdjusted" | "verdict">[] = [];
  if (base) {
    for (const model of models) {
      if (model === baseline) continue;
      const challenger = byModel.get(model)!;
      for (const metric of METRICS) {
        // Pair only questions where both models have a score for this metric.
        const pairs = [...base.values()].flatMap((b) => {
          const c = challenger.get(b.questionId);
          if (!c || b[metric] === null || c[metric] === null) return [];
          return [[b[metric] as number, c[metric] as number] as const];
        });
        if (pairs.length < 2) continue;
        const cmp = comparePaired(
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
        );
        raw.push({ ...cmp, model, metric });
      }
    }
  }

  const adjusted = holmAdjust(raw.map((c) => (Number.isNaN(c.wilcoxon.pValue) ? 1 : c.wilcoxon.pValue)));
  const comparisons: MetricComparison[] = raw.map((c, i) => ({
    ...c,
    pAdjusted: adjusted[i],
    verdict: adjusted[i] < ALPHA ? (c.diff > 0 ? "better" : "worse") : "no significant difference",
  }));

  return { models: summaries, comparisons, baseline };
}

export interface RetrievalSummary {
  /** Questions with labeled source documents. */
  n: number;
  hitRate: number;
  mrr: number;
  precision: number;
  perQuestion: Map<string, RetrievalScore>;
}

/** Retrieval quality over the questions that name their source documents; null when none do. */
export function summarizeRetrieval(
  questions: { id: string; sources?: string[] }[],
  retrievals: Map<string, { id: string }[]>,
): RetrievalSummary | null {
  const perQuestion = new Map<string, RetrievalScore>();
  for (const q of questions) {
    if (q.sources?.length) perQuestion.set(q.id, scoreRetrieval(q.sources, retrievals.get(q.id) ?? []));
  }
  if (perQuestion.size === 0) return null;
  const scores = [...perQuestion.values()];
  return {
    n: scores.length,
    hitRate: mean(scores.map((s) => (s.hit ? 1 : 0))),
    mrr: mean(scores.map((s) => s.reciprocalRank)),
    precision: mean(scores.map((s) => s.precision)),
    perQuestion,
  };
}
