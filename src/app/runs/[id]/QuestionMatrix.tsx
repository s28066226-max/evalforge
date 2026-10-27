"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "../../_components/icons.tsx";

export interface MatrixCell {
  supported: number;
  total: number;
  refused: boolean;
  abstained: boolean;
  correctness: number | null;
  rationale: string;
}

export interface MatrixRow {
  id: string;
  question: string;
  unanswerable: boolean;
  /** null when the question has no labeled source documents. */
  retrievalHit: boolean | null;
  cells: Record<string, MatrixCell | null>;
}

type Filter = "all" | "hallucination" | "disagree" | "unanswerable" | "miss";

const FILTERS: { key: Filter; label: string; test: (r: MatrixRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  {
    key: "hallucination",
    label: "Hallucinations",
    test: (r) => Object.values(r.cells).some((c) => c && c.total > c.supported),
  },
  {
    key: "disagree",
    label: "Models disagree",
    test: (r) => {
      const cells = Object.values(r.cells).filter((c): c is MatrixCell => c !== null);
      return new Set(cells.map((c) => `${c.abstained}|${c.correctness}|${c.total > c.supported}`)).size > 1;
    },
  },
  { key: "unanswerable", label: "Unanswerable", test: (r) => r.unanswerable },
  { key: "miss", label: "Retrieval misses", test: (r) => r.retrievalHit === false },
];

/**
 * Sequential ramp step for the share of unsupported claims (0-1). Clean answers stay on
 * the surface so the eye goes straight to the hallucinations; ink flips on the dark steps.
 */
function heat(unsupportedShare: number) {
  const step = unsupportedShare === 0 ? 0 : Math.min(5, 1 + Math.floor(unsupportedShare * 4.999));
  return { background: `var(--seq-${step})`, color: step >= 4 ? "var(--seq-ink-light)" : "var(--seq-ink-dark)" };
}

export function QuestionMatrix({
  runId,
  models,
  rows,
}: {
  runId: string;
  models: { id: string; label: string; color: string }[];
  rows: MatrixRow[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => new Map(FILTERS.map((f) => [f.key, rows.filter(f.test).length])), [rows]);
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => test(r) && (!q || r.question.toLowerCase().includes(q)));

  return (
    <>
      <div className="toolbar">
        <div className="input-wrap">
          <Search size={16} />
          <input
            className="input"
            type="search"
            placeholder="Search questions"
            aria-label="Search questions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chip-row" role="group" aria-label="Filter questions">
          {FILTERS.filter((f) => f.key === "all" || counts.get(f.key)).map((f) => (
            <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} <span className="muted">{counts.get(f.key)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>all claims supported</span>
        {[0, 1, 2, 3, 4, 5].map((s) => (
          <i key={s} style={{ background: `var(--seq-${s})`, border: s === 0 ? "1px solid var(--border)" : undefined }} />
        ))}
        <span>all unsupported</span>
      </div>
      <div className="table-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th>Question</th>
              {models.map((m) => (
                <th key={m.id} className="num" style={{ textAlign: "center" }}>
                  <span className="swatch" style={{ background: m.color }} />
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr className="empty-row">
                <td colSpan={models.length + 1}>No questions match.</td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/runs/${runId}/q/${r.id}`} className="row-link">
                    {r.question}
                  </Link>
                  <div className="chip-row" style={{ marginTop: 4 }}>
                    {r.unanswerable && <span className="chip">unanswerable</span>}
                    {r.retrievalHit === false && <span className="chip warn">source not retrieved</span>}
                  </div>
                </td>
                {models.map((m) => {
                  const c = r.cells[m.id];
                  if (!c) return <td key={m.id} className="cell">–</td>;
                  const label = c.refused ? "refused" : c.abstained ? "abstained" : c.total ? `${c.supported}/${c.total}` : "no claims";
                  return (
                    <td key={m.id} className="cell" style={heat(c.total ? 1 - c.supported / c.total : 0)} title={c.rationale}>
                      {label}
                      {c.total > c.supported ? " ✗" : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
