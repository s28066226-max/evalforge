import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { scoreRetrieval } from "@/lib/retrieval.ts";
import { loadRun } from "../../../../_components/data.ts";
import { pct, score, seconds, seriesColor, shortName, usd } from "../../../../_components/format.ts";
import { ArrowLeft, ArrowRight, Check, X } from "../../../../_components/icons.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string; qid: string }> }): Promise<Metadata> {
  const { id, qid } = await params;
  const question = (await loadRun(id))?.run.questions.find((q) => q.id === qid);
  return { title: question?.question ?? "Question" };
}

export default async function QuestionPage({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const data = await loadRun(id);
  const index = data?.run.questions.findIndex((q) => q.id === qid) ?? -1;
  if (!data || index < 0) notFound();
  const { run } = data;
  const question = run.questions[index];
  const prev = run.questions[index - 1];
  const next = run.questions[index + 1];

  const results = data.results.filter((r) => r.questionId === qid);
  const chunks = data.retrievals.get(qid) ?? [];
  const ordered = run.config.models.flatMap((m) => results.filter((r) => r.model === m));
  const gold = new Set(question.sources ?? []);
  const retrieval = question.sources?.length ? scoreRetrieval(question.sources, chunks) : null;

  return (
    <>
      <div className="page-head">
        <Link href={`/runs/${id}`} className="back">
          <ArrowLeft size={15} /> {run.config.dataset} run
        </Link>
        <p className="eyebrow" style={{ marginTop: 14 }}>
          Question {index + 1} of {run.questions.length}
        </p>
        <h1>{question.question}</h1>
        <p className="sub">
          {question.unanswerable ? (
            "Unanswerable from the corpus: the ideal answer abstains."
          ) : question.reference ? (
            <>
              <strong style={{ color: "var(--text-primary)" }}>Reference:</strong> {question.reference}
            </>
          ) : (
            "No reference answer."
          )}
        </p>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <section className="stack">
          {ordered.length === 0 && <div className="card">No answers were recorded for this question.</div>}
          {ordered.map((r) => {
            const color = seriesColor(run.config.models.indexOf(r.model));
            return (
              <article key={r.model} className="answer-card" style={{ ["--model-color" as string]: color }}>
                <div className="chip-row">
                  <span className="swatch" style={{ background: color, marginRight: 0 }} />
                  <strong title={r.model}>{shortName(r.model)}</strong>
                  {r.abstained && <span className="chip">abstained</span>}
                  {r.refused && <span className="chip warn">refused</span>}
                </div>
                <p className="answer-text">{r.answer || <em>(empty answer)</em>}</p>
                {r.claims.length > 0 && (
                  <ul className="claims" aria-label="Claims checked against the context">
                    {r.claims.map((c, i) => (
                      <li key={i}>
                        <span className={`claim-icon ${c.supported ? "ok" : "bad"}`}>
                          {c.supported ? <Check size={14} /> : <X size={14} />}
                        </span>
                        <span>
                          <span className="claim-label">{c.supported ? "Supported: " : "Unsupported: "}</span>
                          {c.claim}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="judge-note">
                  <strong>Judge:</strong> {r.rationale}
                </p>
                <div className="chip-row" style={{ marginTop: 12 }}>
                  <span className="chip">faithfulness {pct(r.faithfulness, 0)}</span>
                  <span className="chip">correctness {score(r.correctness)}</span>
                  <span className="chip">relevance {score(r.relevance)}</span>
                  <span className="chip">
                    {seconds(r.latencyMs)} · {(r.inputTokens + r.outputTokens).toLocaleString()} tokens
                    {r.costUsd > 0 && ` · ${usd(r.costUsd)}`}
                  </span>
                </div>
              </article>
            );
          })}
        </section>

        <section className="card">
          <h2>Retrieved context</h2>
          <p className="caption">
            Top {chunks.length} BM25 chunks, shown identically to every model and to the judge.
            {retrieval &&
              (retrieval.hit
                ? ` First source chunk at rank ${Math.round(1 / retrieval.reciprocalRank)}.`
                : " None came from the labeled source document.")}
          </p>
          {chunks.length === 0 && <p>Nothing was retrieved for this question.</p>}
          {chunks.map((c, i) => {
            const isGold = gold.has(c.id.slice(0, c.id.lastIndexOf("#")));
            return (
              <div key={c.id} className={`chunk${isGold ? " gold" : ""}`}>
                <div className="chunk-head">
                  <span className="chip mono">#{i + 1}</span>
                  <span className="mono">{c.id}</span>
                  <span className="muted">score {c.score.toFixed(2)}</span>
                  {isGold && (
                    <span className="badge better">
                      <Check size={12} /> source
                    </span>
                  )}
                </div>
                {c.text}
              </div>
            );
          })}
        </section>
      </div>

      <nav className="pager" aria-label="Question navigation">
        {prev ? (
          <Link href={`/runs/${id}/q/${prev.id}`} className="btn">
            <ArrowLeft size={16} /> Previous
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/runs/${id}/q/${next.id}`} className="btn">
            Next <ArrowRight size={16} />
          </Link>
        )}
      </nav>
    </>
  );
}
