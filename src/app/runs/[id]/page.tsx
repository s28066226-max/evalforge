import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metric, MetricComparison } from "@/lib/summary.ts";
import { ForestPlot, QualityScatter } from "../../_components/charts.tsx";
import { loadRun, ranked } from "../../_components/data.ts";
import { date, pct, pValue, score, seconds, seriesColor, shortName, usd } from "../../_components/format.ts";
import { Alert, ArrowLeft } from "../../_components/icons.tsx";
import { StatusBadge } from "../../_components/StatusBadge.tsx";
import { QuestionMatrix, type MatrixRow } from "./QuestionMatrix.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Run ${id}` };
}

const METRIC_INFO: Record<Metric, { label: string; unit: string; scale: number; fmt: (x: number) => string }> = {
  faithfulness: { label: "Faithfulness", unit: " pts", scale: 100, fmt: (x) => `${(x * 100).toFixed(1)} pts` },
  correctness: { label: "Correctness (1-5)", unit: "", scale: 1, fmt: (x) => x.toFixed(2) },
  relevance: { label: "Relevance (1-5)", unit: "", scale: 1, fmt: (x) => x.toFixed(2) },
};

function sentence(c: MetricComparison, baseline: string) {
  const info = METRIC_INFO[c.metric];
  const sign = c.diff >= 0 ? "+" : "−";
  const delta = `${sign}${info.fmt(Math.abs(c.diff))}`;
  const ci = `95% CI [${info.fmt(c.ci[0])}, ${info.fmt(c.ci[1])}]`;
  const what = c.metric === "faithfulness" ? "faithful to the sources" : c.metric === "correctness" ? "correct" : "relevant";
  const phrase = c.verdict === "better" ? `is significantly more ${what} than` : `is significantly less ${what} than`;
  return (
    <>
      <strong>{shortName(c.model)}</strong> {phrase} <strong>{shortName(baseline)}</strong>{" "}
      <span className="muted">
        ({delta}, {ci}, {pValue(c.pAdjusted)} Holm-adjusted)
      </span>
    </>
  );
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadRun(id);
  if (!data) notFound();
  const { run, results, summary, retrieval } = data;
  const { config } = run;
  const color = (model: string) => seriesColor(config.models.indexOf(model));

  // Lead with what was significant; keep the rest one click away in the forest plots.
  const significant = summary.comparisons.filter((c) => c.verdict !== "no significant difference");
  const insignificantCount = summary.comparisons.length - significant.length;
  // Free-tier models cost $0, so cost columns and the cost axis only appear when a run has spend.
  const hasCost = summary.models.some((m) => m.totalCost > 0);
  const leaders = ranked(summary.models);

  const best = (vals: number[], lowerIsBetter = false) => {
    const v = vals.filter((x) => !Number.isNaN(x));
    return v.length ? (lowerIsBetter ? Math.min(...v) : Math.max(...v)) : null;
  };
  const bests = {
    faithfulness: best(summary.models.map((m) => m.faithfulness)),
    hallucinationRate: best(summary.models.map((m) => m.hallucinationRate), true),
    correctness: best(summary.models.map((m) => m.correctness)),
    abstentionRecall: best(summary.models.map((m) => m.abstentionRecall ?? NaN)),
    latencyP50: best(summary.models.map((m) => m.latencyP50), true),
    costPerAnswer: best(summary.models.map((m) => m.costPerAnswer), true),
    tokensPerAnswer: best(summary.models.map((m) => m.tokensPerAnswer), true),
  };
  const b = (key: keyof typeof bests, v: number | null) => (v !== null && v === bests[key] ? "num best" : "num");

  const byQ = new Map<string, Map<string, (typeof results)[number]>>();
  for (const r of results) {
    if (!byQ.has(r.questionId)) byQ.set(r.questionId, new Map());
    byQ.get(r.questionId)!.set(r.model, r);
  }
  const rows: MatrixRow[] = run.questions.map((q) => ({
    id: q.id,
    question: q.question,
    unanswerable: !!q.unanswerable,
    retrievalHit: retrieval?.perQuestion.get(q.id)?.hit ?? null,
    cells: Object.fromEntries(
      config.models.map((m) => {
        const r = byQ.get(q.id)?.get(m);
        return [
          m,
          r
            ? {
                supported: r.claims.filter((c) => c.supported).length,
                total: r.claims.length,
                refused: r.refused,
                abstained: r.abstained,
                correctness: r.correctness,
                rationale: r.rationale,
              }
            : null,
        ];
      }),
    ),
  }));

  return (
    <>
      <div className="page-head">
        <Link href="/runs" className="back">
          <ArrowLeft size={15} /> All runs
        </Link>
        <h1>
          {config.dataset} <span className="muted" style={{ fontWeight: 400 }}>evaluation</span>
        </h1>
        <p className="sub">
          {run.questionCount} questions × {config.models.length} models · {date(run.createdAt)} ·{" "}
          <span className="mono">{run.id}</span>
        </p>
        <div className="meta">
          <StatusBadge status={run.status} />
          <span className="chip">judge: {shortName(config.judgeModel)}</span>
          <span className="chip">baseline: {shortName(config.baseline)}</span>
          <span className="chip">effort: {config.effort}</span>
          <span className="chip">top-k: {config.topK}</span>
          {config.provider === "mock" && <span className="chip warn">mock mode: synthetic answers and scores</span>}
        </div>
      </div>

      {run.error && (
        <div className="alert" role="status" style={{ marginTop: -6, marginBottom: 18 }}>
          <Alert size={18} />
          <span>
            <strong>Some tasks failed</strong>, so a few cells below are empty. <span className="mono">{run.error}</span>
          </span>
        </div>
      )}

      <div className="leaderboard">
        {leaders.map((m, i) => (
          <div key={m.model} className="model-card reveal" style={{ ["--model-color" as string]: color(m.model) }}>
            <div className="model-card-head">
              <span className="swatch" style={{ background: color(m.model), marginRight: 0 }} />
              <strong title={m.model}>{shortName(m.model)}</strong>
              {m.model === config.baseline && <span className="chip">baseline</span>}
              <span className="rank">#{i + 1}</span>
            </div>
            <div className="big-metric">
              {pct(m.faithfulness)}
              <small>faithfulness</small>
            </div>
            <div className="meter" aria-hidden="true">
              <span style={{ width: `${(Number.isNaN(m.faithfulness) ? 0 : m.faithfulness) * 100}%` }} />
            </div>
            <div className="mini-metrics">
              <div>
                <b>{score(m.correctness)}</b>correctness
              </div>
              <div>
                <b>{pct(m.hallucinationRate)}</b>hallucinated
              </div>
              <div>
                <b>{seconds(m.latencyP50)}</b>p50 latency
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="card">
        <h2>Verdict</h2>
        <p className="caption">
          Paired Wilcoxon signed-rank tests on per-question scores, Holm-Bonferroni corrected across all{" "}
          {summary.comparisons.length} comparisons (α = 0.05).
        </p>
        <ul className="verdicts">
          {significant.map((c) => (
            <li key={c.model + c.metric} className="verdict">
              <span className={`badge ${c.verdict === "better" ? "better" : "worse"}`}>
                {c.verdict === "better" ? "▲" : "▼"} {c.verdict}
              </span>
              <span>{sentence(c, config.baseline)}</span>
            </li>
          ))}
          {config.models.length === 1 && (
            <li className="verdict">
              <span className="badge same">one model</span>
              <span>This run evaluated a single model. Add more with --models to get significance tests.</span>
            </li>
          )}
          {config.models.length > 1 && significant.length === 0 && (
            <li className="verdict">
              <span className="badge same">● no winner</span>
              <span>
                No model differs significantly from <strong>{shortName(config.baseline)}</strong> on any metric. With{" "}
                {run.questionCount} questions, small differences can&apos;t be told apart from noise; add questions to
                detect them.
              </span>
            </li>
          )}
          {significant.length > 0 && insignificantCount > 0 && (
            <li className="verdict">
              <span className="badge same">{insignificantCount} more</span>
              <span>comparisons showed no significant difference (see the confidence intervals below).</span>
            </li>
          )}
        </ul>
      </section>

      {retrieval && (
        <section className="card">
          <h2>Retrieval quality</h2>
          <p className="caption">
            Measured against labeled source documents on {retrieval.n} answerable questions, top {config.topK} chunks. If
            retrieval misses, no model can be faithful <em>and</em> correct.
          </p>
          <div className="grid-3">
            <div className="stat">
              <div className="stat-value">{pct(retrieval.hitRate, 0)}</div>
              <div className="stat-label">Hit rate @ {config.topK}</div>
              <div className="stat-note">a source chunk was retrieved</div>
            </div>
            <div className="stat">
              <div className="stat-value">{retrieval.mrr.toFixed(2)}</div>
              <div className="stat-label">Mean reciprocal rank</div>
              <div className="stat-note">1.00 = source always ranked first</div>
            </div>
            <div className="stat">
              <div className="stat-value">{pct(retrieval.precision, 0)}</div>
              <div className="stat-label">Context precision</div>
              <div className="stat-note">retrieved chunks from a source doc</div>
            </div>
          </div>
        </section>
      )}

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <section className="card">
          <h2>Faithfulness vs {hasCost ? "cost" : "latency"}</h2>
          <p className="caption">
            Up and to the left is better: more grounded answers {hasCost ? "for less money" : "in less time"}.
          </p>
          <QualityScatter
            xLabel={hasCost ? "Cost per answer" : "Median latency"}
            yLabel="Faithfulness"
            xScale={hasCost ? "log" : "linear"}
            xFormat={hasCost ? "usd" : "seconds"}
            points={summary.models.map((m) => ({
              label: shortName(m.model),
              color: color(m.model),
              x: hasCost ? m.costPerAnswer : m.latencyP50 / 1000,
              y: m.faithfulness,
              details: [
                `Faithfulness ${pct(m.faithfulness)}`,
                `Hallucination rate ${pct(m.hallucinationRate)}`,
                hasCost ? `Cost / answer ${usd(m.costPerAnswer)}` : `${Math.round(m.tokensPerAnswer)} tokens / answer`,
                `p50 latency ${seconds(m.latencyP50)}`,
              ],
            }))}
          />
        </section>

        <section className="card">
          <h2>Difference from {shortName(config.baseline)}</h2>
          <p className="caption">
            Mean paired difference with bootstrap 95% CI. Filled dot = significant after Holm correction; hollow = not.
          </p>
          {summary.comparisons.length === 0 && <p className="caption">Needs at least two models.</p>}
          {summary.comparisons.length > 0 &&
            (["faithfulness", "correctness", "relevance"] as Metric[]).map((metric) => {
              const info = METRIC_INFO[metric];
              const rows = summary.comparisons.filter((c) => c.metric === metric);
              return (
                <div key={metric} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{info.label}</div>
                  <ForestPlot
                    unit={info.unit}
                    scale={info.scale}
                    rows={rows.map((c) => ({
                      label: shortName(c.model),
                      color: color(c.model),
                      diff: c.diff,
                      ci: c.ci,
                      significant: c.verdict !== "no significant difference",
                      details: [
                        `Δ ${info.fmt(c.diff)} (n = ${c.n})`,
                        `95% CI [${info.fmt(c.ci[0])}, ${info.fmt(c.ci[1])}]`,
                        `Wilcoxon ${pValue(c.wilcoxon.pValue)}, Holm ${pValue(c.pAdjusted)}`,
                        `Paired t ${pValue(c.tTest.pValue)} · Cohen's d_z ${c.effectSize.toFixed(2)}`,
                      ],
                    }))}
                  />
                </div>
              );
            })}
        </section>
      </div>

      <section className="card">
        <h2>Scorecard</h2>
        <p className="caption">Best value per column in bold.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Faithfulness</th>
                <th className="num">Hallucination</th>
                <th className="num">Correctness</th>
                <th className="num">Correct abstain</th>
                <th className="num">False abstain</th>
                <th className="num">Latency p50 / p95</th>
                <th className="num">Tokens</th>
                {hasCost && <th className="num">Cost / answer</th>}
                {hasCost && <th className="num">Total cost</th>}
              </tr>
            </thead>
            <tbody>
              {summary.models.map((m) => (
                <tr key={m.model}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="swatch" style={{ background: color(m.model) }} />
                    {m.model}
                    {m.refusals > 0 && (
                      <span className="chip warn" style={{ marginLeft: 8 }}>
                        {m.refusals} refused
                      </span>
                    )}
                  </td>
                  <td className={b("faithfulness", m.faithfulness)}>{pct(m.faithfulness)}</td>
                  <td className={b("hallucinationRate", m.hallucinationRate)}>{pct(m.hallucinationRate)}</td>
                  <td className={b("correctness", m.correctness)}>{score(m.correctness)}</td>
                  <td className={b("abstentionRecall", m.abstentionRecall)}>{pct(m.abstentionRecall, 0)}</td>
                  <td className="num">{pct(m.falseAbstentionRate, 0)}</td>
                  <td className={b("latencyP50", m.latencyP50)}>
                    {seconds(m.latencyP50)} / {seconds(m.latencyP95)}
                  </td>
                  <td className={b("tokensPerAnswer", m.tokensPerAnswer)}>{Math.round(m.tokensPerAnswer).toLocaleString()}</td>
                  {hasCost && <td className={b("costPerAnswer", m.costPerAnswer)}>{usd(m.costPerAnswer)}</td>}
                  {hasCost && <td className="num">{usd(m.totalCost)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Question by question</h2>
        <p className="caption">
          Each cell shows supported / total claims in the answer; stronger color means more claims the retrieved context
          doesn&apos;t support. Filter to the interesting cases, then open a question for answers, claims and the judge&apos;s
          reasoning.
        </p>
        <QuestionMatrix
          runId={id}
          models={config.models.map((m) => ({ id: m, label: shortName(m), color: color(m) }))}
          rows={rows}
        />
      </section>
    </>
  );
}
