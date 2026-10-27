import type { Metadata } from "next";
import { arenaConfig } from "@/lib/arena.ts";
import { seriesColor, shortName } from "../_components/format.ts";
import { ArenaClient } from "./ArenaClient.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Live arena",
  description: "Ask a question, watch models answer from the same retrieved documents, and see an LLM judge fact-check every claim.",
};

export default function ArenaPage() {
  const { models, judge, mode, enabled } = arenaConfig();
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Live arena</p>
        <h1>Ask the docs. Watch the models answer. See every claim fact-checked.</h1>
        <p className="sub">
          Questions are answered from the docs of <strong>Northwind Cloud</strong>, a fictional SaaS company (pricing,
          refunds, SLA, security, API and support). Both models get the same retrieved context, then{" "}
          <span className="mono">{shortName(judge)}</span> checks each claim against it. Try something the docs don&apos;t
          cover to see which model admits it.
        </p>
      </div>
      <ArenaClient
        enabled={enabled}
        mode={mode}
        models={models.map((m, i) => ({ id: m, label: shortName(m), color: seriesColor(i) }))}
      />
    </>
  );
}
