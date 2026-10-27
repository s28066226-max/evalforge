import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/store.ts";
import { summarize } from "@/lib/summary.ts";
import { ranked } from "../_components/data.ts";
import { date, pct, shortName } from "../_components/format.ts";
import { StatusBadge } from "../_components/StatusBadge.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  const store = await getStore();
  const runs = store.listRuns().map((r) => {
    const run = store.getRun(r.id)!;
    const unanswerable = new Set(run.questions.filter((q) => q.unanswerable).map((q) => q.id));
    const top = ranked(summarize(store.getResults(r.id), r.config.models, r.config.baseline, unanswerable).models)[0];
    return { ...r, top };
  });

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Evaluation runs</p>
        <h1>Runs</h1>
        <p className="sub">
          Each run answers every question with every model over the same retrieved context, scores the answers with an LLM
          judge, and tests whether the differences are statistically significant.
          {store.source === "published" && " These are the runs published with this deployment."}
        </p>
      </div>
      {runs.length === 0 ? (
        <div className="card empty">
          <h2>No runs yet</h2>
          <p className="caption">Start one from the terminal. Without a free GROQ_API_KEY in .env it runs in offline mock mode.</p>
          <pre>npm run eval</pre>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Started</th>
                <th>Models</th>
                <th className="num">Questions</th>
                <th>Top model</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`} className="row-link mono">
                      {r.id}
                    </Link>
                    <div className="caption" style={{ margin: 0 }}>
                      {r.config.dataset}
                      {r.config.provider === "mock" && " · mock mode"}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{date(r.createdAt)}</td>
                  <td>
                    <div className="chip-row">
                      {r.config.models.map((m) => (
                        <span key={m} className="chip mono">
                          {shortName(m)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num">{r.questionCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.top && !Number.isNaN(r.top.faithfulness) ? (
                      <>
                        {shortName(r.top.model)} <span className="muted">· {pct(r.top.faithfulness)}</span>
                      </>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
