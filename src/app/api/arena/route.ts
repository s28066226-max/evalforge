import path from "node:path";
import { ARENA_DATASET, arenaConfig, type ArenaEvent } from "@/lib/arena.ts";
import { loadDataset } from "@/lib/dataset.ts";
import { makeProvider } from "@/lib/providers.ts";
import { BM25Index, chunkDocs } from "@/lib/retrieval.ts";

export const maxDuration = 60;

// The corpus is bundled via outputFileTracingIncludes in next.config.ts.
let index: BM25Index | undefined;
const getIndex = () => (index ??= new BM25Index(chunkDocs(loadDataset(path.join(/*turbopackIgnore: true*/ process.cwd(), ARENA_DATASET)).docs)));

// Per-IP sliding window. In-memory, so each server instance counts separately: a guard for a
// free API quota, not a security boundary.
const WINDOW_MS = 10 * 60_000;
const LIMIT = Number(process.env.ARENA_RATE_LIMIT ?? 6);
const hits = new Map<string, number[]>();

function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export async function POST(req: Request) {
  const config = arenaConfig();
  if (!config.enabled) return Response.json({ error: "The arena is turned off on this deployment." }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (question.length < 3 || question.length > 300) {
    return Response.json({ error: "Ask a question between 3 and 300 characters." }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (config.mode === "live" && !allow(ip)) {
    return Response.json(
      { error: `You've reached ${LIMIT} questions in 10 minutes, the limit that keeps this demo on a free API tier. Try again shortly.` },
      { status: 429 },
    );
  }

  const provider = makeProvider(config.mode);
  const chunks = getIndex().search(question, 4);
  const q = { id: "arena", question };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (e: ArenaEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // client went away
        }
      };
      send({ type: "meta", mode: config.mode, models: config.models, judge: config.judge });
      send({ type: "retrieval", chunks: chunks.map(({ id, docTitle, text, score }) => ({ id, docTitle, text, score })) });

      // Models answer in parallel. Judging is serialized: the judge model's per-minute token
      // budget on free tiers is the bottleneck.
      let judgeChain: Promise<unknown> = Promise.resolve();
      await Promise.all(
        config.models.map(async (model) => {
          try {
            const gen = provider.streamAnswer(model, question, chunks, "medium");
            let step = await gen.next();
            while (!step.done) {
              send({ type: "delta", model, text: step.value });
              step = await gen.next();
            }
            const answer = step.value;
            send({
              type: "answer",
              model,
              latencyMs: answer.latencyMs,
              tokens: answer.usage.inputTokens + answer.usage.outputTokens,
              refused: answer.refused,
            });
            const judged = judgeChain.then(() => provider.judge(config.judge, q, chunks, answer.text));
            judgeChain = judged.catch(() => undefined);
            const v = await judged;
            const supported = v.claims.filter((c) => c.supported).length;
            send({
              type: "verdict",
              model,
              faithfulness: v.claims.length ? supported / v.claims.length : 1,
              relevance: v.relevance,
              abstained: v.abstained,
              claims: v.claims,
              rationale: v.rationale,
            });
          } catch (err) {
            send({ type: "error", model, message: err instanceof Error ? err.message.slice(0, 300) : String(err) });
          }
        }),
      );
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
