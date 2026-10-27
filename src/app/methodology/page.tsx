import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How EvalForge retrieves, answers, judges and tests: every metric and statistical choice explained.",
};

const SECTIONS = [
  ["pipeline", "Pipeline"],
  ["faithfulness", "Faithfulness"],
  ["correctness", "Correctness & relevance"],
  ["abstention", "Abstention"],
  ["retrieval", "Retrieval metrics"],
  ["significance", "Significance testing"],
  ["limits", "Limitations"],
] as const;

export default function Methodology() {
  return (
    <article className="prose">
      <p className="eyebrow">Methodology</p>
      <h1>How EvalForge decides which model is better</h1>
      <p className="sub">
        A leaderboard number without uncertainty is a guess. EvalForge measures grounding claim by claim, tests the cases
        where models should refuse, and only calls a difference real when a corrected significance test says so.
      </p>
      <nav className="toc" aria-label="On this page">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip">
            {label}
          </a>
        ))}
      </nav>

      <h2 id="pipeline">Pipeline</h2>
      <p>
        Documents are split on paragraph boundaries into chunks of up to 700 characters, each carrying its section heading.
        For every question, <strong>BM25</strong> retrieves the top-k chunks once, and that identical context goes to every
        model and to the judge. Differences in scores therefore come from the models, not from retrieval luck.
      </p>
      <p>
        Models are told to answer only from the documents, cite chunk ids, and reply with a fixed abstention sentence when
        the documents don&apos;t contain the answer.
      </p>

      <h2 id="faithfulness">Faithfulness and hallucination rate</h2>
      <p>
        The judge breaks each answer into <strong>atomic claims</strong> (one checkable fact each) and marks a claim
        supported only if the retrieved documents state or directly entail it. A claim that is true in the real world but
        absent from the documents counts as unsupported, because the system can&apos;t verify it.
      </p>
      <div className="formula">faithfulness = supported claims / total claims (an answer with no claims scores 1)</div>
      <p>
        <strong>Hallucination rate</strong> is the share of answers with at least one unsupported claim. It is stricter
        than mean faithfulness: one invented fact in an otherwise grounded answer still counts.
      </p>

      <h2 id="correctness">Correctness and relevance</h2>
      <p>
        <strong>Correctness</strong> (1-5) compares the answer with a reference answer: 5 means the same facts, 3 means
        partially correct, 1 contradicts the reference. <strong>Relevance</strong> (1-5) scores how directly the answer
        addresses the question. The judge returns a strict JSON schema, which is validated before it&apos;s stored.
      </p>

      <h2 id="abstention">Abstention</h2>
      <p>
        Some questions are deliberately <strong>unanswerable</strong> from the corpus. A trustworthy model says it
        doesn&apos;t know. <strong>Correct abstain</strong> is the share of those questions where it did;{" "}
        <strong>false abstain</strong> is the share of answerable questions where it wrongly gave up. Together they
        separate cautious models from evasive ones.
      </p>

      <h2 id="retrieval">Retrieval metrics</h2>
      <p>
        Questions can name their <strong>source documents</strong>. A model can&apos;t be both faithful and correct if
        retrieval never surfaced the answer, so EvalForge scores retrieval separately:
      </p>
      <ul>
        <li>
          <strong>Hit rate @ k</strong>: a chunk from a source document is among the top k.
        </li>
        <li>
          <strong>MRR</strong>: the mean of 1 / rank of the first source chunk (0 when it was missed).
        </li>
        <li>
          <strong>Context precision</strong>: the share of retrieved chunks that come from a source document.
        </li>
      </ul>

      <h2 id="significance">Significance testing</h2>
      <p>
        Every model answers the same questions, so comparisons are <strong>paired</strong>: for each question, the
        challenger&apos;s score minus the baseline&apos;s. This removes question difficulty from the noise.
      </p>
      <ul>
        <li>
          <strong>Wilcoxon signed-rank test</strong> decides significance. Judge scores are bounded and ordinal, so a
          rank-based test is safer than assuming normal differences. A paired t-test and Cohen&apos;s d<sub>z</sub> are
          reported alongside.
        </li>
        <li>
          <strong>Bootstrap 95% confidence intervals</strong> (10,000 resamples, fixed seed) on the mean difference show
          how large the effect plausibly is.
        </li>
        <li>
          <strong>Holm-Bonferroni correction</strong> across every model × metric comparison in a run controls the
          chance of any false &quot;winner&quot; at 5%.
        </li>
      </ul>
      <p>
        In CI, <span className="mono">--fail-on-regression</span> exits with an error when any model is significantly worse
        than the baseline, so a prompt or model change can&apos;t silently make answers less grounded.
      </p>

      <h2 id="limits">Limitations</h2>
      <ul>
        <li>An LLM judge can be wrong. Every verdict ships with its claims and rationale so you can audit it.</li>
        <li>A judge from the same model family as a candidate may favor it; keep the judge separate from the models compared.</li>
        <li>
          With a few dozen questions, only large differences reach significance. &quot;No significant difference&quot;
          means &quot;not detected&quot;, not &quot;equal&quot;.
        </li>
        <li>BM25 is lexical: paraphrased questions can miss the right chunk, which the retrieval metrics make visible.</li>
      </ul>
      <p style={{ marginTop: 28 }}>
        <Link href="/arena" className="btn btn-primary">
          Try it in the live arena
        </Link>
      </p>
    </article>
  );
}
