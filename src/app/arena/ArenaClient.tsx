"use client";

import { useRef, useState } from "react";
import type { ArenaEvent } from "@/lib/arena.ts";
import { Alert, ArrowRight, Check, X } from "../_components/icons.tsx";

interface ModelState {
  text: string;
  status: "waiting" | "streaming" | "judging" | "done" | "error";
  latencyMs?: number;
  tokens?: number;
  verdict?: Extract<ArenaEvent, { type: "verdict" }>;
  error?: string;
}

type Chunk = Extract<ArenaEvent, { type: "retrieval" }>["chunks"][number];

const SUGGESTIONS = [
  "Can I get a refund on a monthly plan?",
  "Does Northwind support SSO with Okta?",
  "What uptime does the Starter plan guarantee?",
  "How do I reach the sales team by phone?",
  "What happens to my data after I cancel?",
  "Which plans include live chat support?",
];

const STATUS_LABEL: Record<ModelState["status"], string> = {
  waiting: "waiting",
  streaming: "answering",
  judging: "judging",
  done: "graded",
  error: "error",
};

export function ArenaClient({
  enabled,
  mode,
  models,
}: {
  enabled: boolean;
  mode: "live" | "mock";
  models: { id: string; label: string; color: string }[];
}) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [state, setState] = useState<Record<string, ModelState>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (model: string, patch: Partial<ModelState>) =>
    setState((s) => ({ ...s, [model]: { ...s[model], ...patch } }));

  const handle = (e: ArenaEvent) => {
    switch (e.type) {
      case "retrieval":
        setChunks(e.chunks);
        break;
      case "delta":
        setState((s) => ({ ...s, [e.model]: { ...s[e.model], status: "streaming", text: (s[e.model]?.text ?? "") + e.text } }));
        break;
      case "answer":
        update(e.model, { status: "judging", latencyMs: e.latencyMs, tokens: e.tokens });
        break;
      case "verdict":
        update(e.model, { status: "done", verdict: e });
        break;
      case "error":
        if (e.model) update(e.model, { status: "error", error: e.message });
        else setError(e.message);
        break;
    }
  };

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3 || running) return;
    setQuestion(text);
    setAsked(text);
    setRunning(true);
    setError(null);
    setChunks([]);
    setState(Object.fromEntries(models.map((m) => [m.id, { text: "", status: "waiting" as const }])));
    try {
      const res = await fetch("/api/arena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as ArenaEvent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState((s) =>
        Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.status === "done" ? v : { ...v, status: "error" as const }])),
      );
    } finally {
      setRunning(false);
    }
  }

  if (!enabled) {
    return (
      <div className="alert info">
        <Alert size={18} /> The live arena is turned off on this deployment. The published evaluation runs are still available.
      </div>
    );
  }

  return (
    <>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="arena-q" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
          Your question
        </label>
        <div className="ask">
          <input
            ref={inputRef}
            id="arena-q"
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How long are backups kept?"
            maxLength={300}
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={running || question.trim().length < 3}>
            {running ? "Running…" : "Ask"} {!running && <ArrowRight size={16} />}
          </button>
        </div>
        <div className="suggestions" aria-label="Example questions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" disabled={running} onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
        {mode === "mock" && (
          <div className="alert info">
            <Alert size={18} />
            <span>
              No API key is configured, so answers and grades come from the offline mock provider. Add a free{" "}
              <span className="mono">GROQ_API_KEY</span> to run real models.
            </span>
          </div>
        )}
        {error && (
          <div className="alert" role="alert">
            <Alert size={18} /> <span>{error}</span>
          </div>
        )}
      </form>

      {asked && (
        <>
          <p className="caption" style={{ marginTop: 22 }} aria-live="polite">
            {running ? "Answering" : "Results for"}: <strong style={{ color: "var(--text-primary)" }}>{asked}</strong>
          </p>
          <div className="arena-grid">
            {models.map((m) => {
              const s = state[m.id] ?? { text: "", status: "waiting" };
              const v = s.verdict;
              const tone = s.status === "done" ? "better" : s.status === "error" ? "worse" : "same running";
              return (
                <article key={m.id} className="answer-card" style={{ ["--model-color" as string]: m.color }} aria-busy={s.status !== "done" && s.status !== "error"}>
                  <div className="chip-row">
                    <span className="swatch" style={{ background: m.color, marginRight: 0 }} />
                    <strong>{m.label}</strong>
                    <span className={`badge ${tone}`} style={{ marginLeft: "auto" }}>
                      <span className="dot" />
                      {STATUS_LABEL[s.status]}
                    </span>
                  </div>
                  {s.status === "waiting" ? (
                    <div aria-hidden="true" style={{ minHeight: 72, paddingTop: 6 }}>
                      <div className="skeleton" style={{ width: "92%" }} />
                      <div className="skeleton" style={{ width: "78%" }} />
                      <div className="skeleton" style={{ width: "55%" }} />
                    </div>
                  ) : (
                    <p className={`stream-text${s.status === "streaming" ? " cursor" : ""}`}>{s.text}</p>
                  )}
                  {s.error && <p className="caption" style={{ color: "var(--critical)" }}>{s.error}</p>}
                  {s.status === "judging" && (
                    <div aria-hidden="true">
                      <div className="skeleton" style={{ width: "60%" }} />
                      <div className="skeleton" style={{ width: "40%" }} />
                    </div>
                  )}
                  {v && (
                    <>
                      <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "6px 0 12px" }}>
                        <div className="score-ring" style={{ ["--p" as string]: Math.round(v.faithfulness * 100) }}>
                          <span>{Math.round(v.faithfulness * 100)}%</span>
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {v.abstained
                              ? "Abstained"
                              : v.claims.length === 0
                                ? "No factual claims"
                                : `${v.claims.filter((c) => c.supported).length} of ${v.claims.length} claims supported`}
                          </div>
                          <div className="caption" style={{ margin: 0 }}>
                            faithfulness · relevance {v.relevance}/5
                          </div>
                        </div>
                      </div>
                      {v.claims.length > 0 && (
                        <ul className="claims" aria-label="Claims checked against the context">
                          {v.claims.map((c, i) => (
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
                        <strong>Judge:</strong> {v.rationale}
                      </p>
                    </>
                  )}
                  {s.latencyMs !== undefined && (
                    <div className="chip-row" style={{ marginTop: 12 }}>
                      <span className="chip">{(s.latencyMs / 1000).toFixed(2)}s</span>
                      <span className="chip">{s.tokens?.toLocaleString()} tokens</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {chunks.length > 0 && (
            <details className="card" style={{ marginTop: 18 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                Retrieved context: {chunks.length} chunks shown to both models and the judge
              </summary>
              <div style={{ marginTop: 14 }}>
                {chunks.map((c, i) => (
                  <div key={c.id} className="chunk">
                    <div className="chunk-head">
                      <span className="chip mono">#{i + 1}</span>
                      <span className="mono">{c.id}</span>
                      <span className="muted">score {c.score.toFixed(2)}</span>
                    </div>
                    {c.text}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}
