import path from "node:path";
import { parseArgs } from "node:util";
import { loadDataset } from "../lib/dataset.ts";
import { getResults } from "../lib/db.ts";
import { missingKeys } from "../lib/providers.ts";
import { runEval } from "../lib/runner.ts";
import { summarize, type MetricComparison } from "../lib/summary.ts";
import type { RunConfig } from "../lib/types.ts";

try {
  process.loadEnvFile();
} catch {
  // no .env file - fine
}

const { values } = parseArgs({
  options: {
    dataset: { type: "string", default: "datasets/northwind" },
    models: { type: "string", default: "groq:openai/gpt-oss-20b,groq:qwen/qwen3.8-27b" },
    baseline: { type: "string" },
    judge: { type: "string", default: "groq:openai/gpt-oss-120b" },
    "top-k": { type: "string", default: "4" },
    effort: { type: "string", default: "medium" },
    concurrency: { type: "string", default: "1" },
    limit: { type: "string" },
    mock: { type: "boolean", default: false },
    "fail-on-regression": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: npm run eval -- [options]

  --dataset <dir>          dataset directory (default: datasets/northwind)
  --models <a,b,c>         models as <provider>:<model id> (default: two Groq free-tier models)
                           providers: groq, gemini, openrouter, ollama
  --baseline <model>       model the others are compared against (default: first model)
  --judge <model>          LLM judge (default: groq:openai/gpt-oss-120b)
  --top-k <n>              chunks retrieved per question (default: 4)
  --effort <level>         low | medium | high | xhigh | max (default: medium)
  --concurrency <n>        parallel requests (default: 1, to stay inside free-tier rate limits)
  --limit <n>              evaluate only the first n questions (quick runs, smaller quota use)
  --mock                   offline deterministic mode (automatic when a needed API key is unset)
  --fail-on-regression     exit 1 if any model is significantly worse than the baseline`);
  process.exit(0);
}

const models = values.models.split(",").map((m) => m.trim()).filter(Boolean);
const missing = values.mock ? [] : missingKeys([...models, values.judge]);
const provider: RunConfig["provider"] = values.mock || missing.length ? "mock" : "live";
if (missing.length) {
  console.log("Missing free API key(s), so running in mock mode instead:");
  for (const m of missing) console.log(`  ${m.keyEnv.padEnd(20)} get one free at ${m.signup}`);
  console.log("Add them to .env for real evaluations.\n");
}

const dataset = loadDataset(path.resolve(values.dataset));
if (values.limit) dataset.questions = dataset.questions.slice(0, Number(values.limit));
const config: RunConfig = {
  dataset: dataset.name,
  models,
  baseline: values.baseline ?? models[0],
  judgeModel: values.judge,
  topK: Number(values["top-k"]),
  effort: values.effort as RunConfig["effort"],
  provider,
};

console.log(
  `EvalForge: ${dataset.questions.length} questions x ${models.length} models on "${dataset.name}" ` +
    `(${provider}${provider === "live" ? `, judge ${config.judgeModel}` : ""})`,
);

const { runId, failed } = await runEval(dataset, config, {
  concurrency: Number(values.concurrency),
  onProgress: (p) => {
    const line = `  ${p.done}/${p.total} answered and judged${p.failed ? `, ${p.failed} failed` : ""}`;
    if (process.stdout.isTTY) process.stdout.write(`\r${line}   `);
    else if (p.done === p.total || p.done % 10 === 0) console.log(line);
  },
});
process.stdout.write("\n\n");

const unanswerable = new Set(dataset.questions.filter((q) => q.unanswerable).map((q) => q.id));
const summary = summarize(getResults(runId), models, config.baseline, unanswerable);

const pct = (x: number | null) => (x === null || Number.isNaN(x) ? "-" : `${(x * 100).toFixed(1)}%`);
const num = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(2));

console.table(
  Object.fromEntries(
    summary.models.map((m) => [
      m.model,
      {
        faithfulness: pct(m.faithfulness),
        "hallucination rate": pct(m.hallucinationRate),
        "correctness (1-5)": num(m.correctness),
        "abstains when it should": pct(m.abstentionRecall),
        "p50 latency": `${(m.latencyP50 / 1000).toFixed(2)}s`,
        "tokens / answer": Math.round(m.tokensPerAnswer),
        ...(m.totalCost > 0 && { "cost / answer": `$${m.costPerAnswer.toFixed(5)}` }),
      },
    ]),
  ),
);

const nameWidth = Math.max(...models.map((m) => m.length)) + 1;
const fmt = (c: MetricComparison) => {
  const scale = c.metric === "faithfulness" ? 100 : 1;
  const unit = c.metric === "faithfulness" ? " pts" : "";
  const sign = c.diff >= 0 ? "+" : "";
  return (
    `  ${c.model.padEnd(nameWidth)} ${c.metric.padEnd(13)} ${sign}${(c.diff * scale).toFixed(2)}${unit}` +
    `  95% CI [${(c.ci[0] * scale).toFixed(2)}, ${(c.ci[1] * scale).toFixed(2)}]` +
    `  p=${c.pAdjusted.toFixed(4)} (Holm)  -> ${c.verdict}`
  );
};

if (summary.comparisons.length) {
  console.log(`\nPaired comparison vs baseline ${config.baseline} (Wilcoxon signed-rank, Holm-adjusted):`);
  for (const c of summary.comparisons) console.log(fmt(c));
}

console.log(`\nRun ${runId} saved. View it with: npm run dev  ->  http://localhost:3000/runs/${runId}`);
if (failed) console.log(`Warning: ${failed} task(s) failed; see the run page for details.`);

if (values["fail-on-regression"] && summary.comparisons.some((c) => c.verdict === "worse")) {
  console.error("\nRegression detected: at least one model is significantly worse than the baseline.");
  process.exit(1);
}
