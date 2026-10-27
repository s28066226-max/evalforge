import Link from "next/link";
import { getStore } from "@/lib/store.ts";
import { loadRun, featuredRunId, ranked } from "./_components/data.ts";
import { pct, score, seconds, seriesColor, shortName } from "./_components/format.ts";
import { ArrowRight, Bot, FileText, Gavel, Layers, Search, Shield, Sigma, Target, Terminal, Workflow, Zap } from "./_components/icons.tsx";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Search, title: "Retrieve", text: "BM25 pulls the top-k chunks for each question. Every model sees the identical context." },
  { icon: Bot, title: "Answer", text: "Each model answers with citations, or abstains when the documents don't say." },
  { icon: Gavel, title: "Judge", text: "An LLM judge splits every answer into atomic claims and checks each one against the context." },
  { icon: Sigma, title: "Test", text: "Paired Wilcoxon tests, bootstrap CIs and Holm correction decide what's a real difference." },
];

const FEATURES = [
  { icon: Target, title: "Claim-level faithfulness", text: "Not a vibe score: the share of an answer's claims the sources actually support." },
  { icon: Shield, title: "Abstention testing", text: "Unanswerable questions catch models that make things up instead of saying they don't know." },
  { icon: Layers, title: "Retrieval metrics", text: "Hit rate, MRR and context precision against labeled source documents." },
  { icon: Sigma, title: "Significance, not leaderboards", text: "Confidence intervals and multiple-comparison correction on paired per-question scores." },
  { icon: Workflow, title: "CI regression gate", text: "--fail-on-regression fails the build when a model is significantly worse than the baseline." },
  { icon: Zap, title: "Free-tier and local models", text: "Groq, Gemini, OpenRouter or Ollama. Mix providers in one run, no credit card required." },
];

export default async function Home() {
  const id = await featuredRunId();
  const data = id ? await loadRun(id) : null;
  const runCount = (await getStore()).listRuns().length;
  const claims = data?.results.reduce((s, r) => s + r.claims.length, 0) ?? 0;
  const leaders = data ? ranked(data.summary.models) : [];
  const color = (m: string) => seriesColor(data!.run.config.models.indexOf(m));

  return (
    <>
      <section className="hero">
        <span className="pill reveal">
          <b>Open source</b> RAG evaluation on free-tier models
        </span>
        <h1 className="reveal reveal-1">
          Which LLM can you trust with <span className="gradient-text">your documents?</span>
        </h1>
        <p className="sub reveal reveal-2">
          EvalForge grades every answer claim by claim against the retrieved sources, checks that models abstain when they
          should, and tells you which differences are statistically real.
        </p>
        <div className="hero-actions reveal reveal-3">
          <Link href="/arena" className="btn btn-primary">
            Try the live arena <ArrowRight />
          </Link>
          {id && (
            <Link href={`/runs/${id}`} className="btn">
              See the latest results
            </Link>
          )}
        </div>

        {data && (
          <div className="stats reveal reveal-4">
            <div className="stat">
              <div className="stat-value">{data.results.length}</div>
              <div className="stat-label">answers judged</div>
              <div className="stat-note">
                {data.run.questionCount} questions × {data.run.config.models.length} models
              </div>
            </div>
            <div className="stat">
              <div className="stat-value">{claims}</div>
              <div className="stat-label">claims fact-checked</div>
              <div className="stat-note">against retrieved context</div>
            </div>
            <div className="stat">
              <div className="stat-value">{data.retrieval ? pct(data.retrieval.hitRate, 0) : "–"}</div>
              <div className="stat-label">retrieval hit rate</div>
              <div className="stat-note">source doc in top {data.run.config.topK}</div>
            </div>
            <div className="stat">
              <div className="stat-value">{leaders[0] ? pct(leaders[0].faithfulness, 1) : "–"}</div>
              <div className="stat-label">best faithfulness</div>
              <div className="stat-note">{leaders[0] ? shortName(leaders[0].model) : ""}</div>
            </div>
          </div>
        )}
      </section>

      {data && (
        <section className="section">
          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Latest leaderboard</h2>
                  <p className="caption">
                    Faithfulness on <span className="mono">{data.run.config.dataset}</span>, judged by{" "}
                    {shortName(data.run.config.judgeModel)}.
                  </p>
                </div>
                <Link href={`/runs/${id}`} className="back">
                  Full report <ArrowRight size={15} />
                </Link>
              </div>
              {leaders.map((m, i) => (
                <div key={m.model} className="rank-row" style={{ ["--model-color" as string]: color(m.model) }}>
                  <span className="rank">#{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>
                      <span className="swatch" style={{ background: color(m.model) }} />
                      {shortName(m.model)}
                    </div>
                    <div className="caption" style={{ margin: 0 }}>
                      correctness {score(m.correctness)} · hallucination {pct(m.hallucinationRate)} · p50{" "}
                      {seconds(m.latencyP50)}
                    </div>
                    <div className="meter" aria-hidden="true">
                      <span style={{ width: `${Math.max(0, m.faithfulness) * 100}%` }} />
                    </div>
                  </div>
                  <span className="value">{pct(m.faithfulness)}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <h2>Run it on your own data</h2>
              <p className="caption">
                Point it at a folder of markdown docs and a JSONL of questions. Results land in a local database and this
                dashboard{runCount > 1 ? ` (${runCount} runs so far)` : ""}.
              </p>
              <div className="terminal" role="region" aria-label="Example commands">
                <div className="terminal-bar" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <pre>
                  <span className="c"># free key from console.groq.com, or use Ollama locally</span>
                  {"\n"}
                  <span className="p">$</span> npm run eval -- --limit 8{"\n"}
                  <span className="p">$</span> npm run eval -- --models ollama:gemma4:e4b{"\n"}
                  <span className="p">$</span> npm run eval -- --fail-on-regression{"  "}
                  <span className="c"># CI gate</span>
                  {"\n"}
                  <span className="p">$</span> npm run export{"  "}
                  <span className="c"># publish a run to this site</span>
                </pre>
              </div>
            </div>
          </div>
        </section>
      )}

      {!data && (
        <section className="section card empty">
          <h2>No results yet</h2>
          <p className="caption">Run an evaluation from the terminal, then refresh this page.</p>
          <pre>npm run eval</pre>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">How it works</p>
          <h2 style={{ fontSize: 26 }}>Four steps from documents to a defensible verdict</h2>
        </div>
        <div className="pipeline">
          {STEPS.map(({ icon: I, title, text }) => (
            <div key={title} className="step">
              <span className="icon-tile">
                <I />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">What it measures</p>
          <h2 style={{ fontSize: 26 }}>Built for the failure modes that matter in RAG</h2>
        </div>
        <div className="features">
          {FEATURES.map(({ icon: I, title, text }) => (
            <div key={title} className="feature">
              <span className="icon-tile">
                <I />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <p className="caption" style={{ marginTop: 18 }}>
          <Link href="/methodology" className="back">
            <FileText size={15} /> Read the methodology
          </Link>
          <span style={{ margin: "0 10px" }}>·</span>
          <Link href="/runs" className="back">
            <Terminal size={15} /> Browse all runs
          </Link>
        </p>
      </section>
    </>
  );
}
