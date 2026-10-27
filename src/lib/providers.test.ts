import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { missingKeys, OpenAICompatProvider, parseModel } from "./providers.ts";
import type { RetrievedChunk } from "./types.ts";

type Handler = (body: Record<string, any>, res: ServerResponse) => void;

/** A fake OpenAI-compatible server; each test scripts its responses in order. */
async function fakeServer(handlers: Handler[]) {
  const bodies: Record<string, any>[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    bodies.push(body);
    const handler = handlers[Math.min(bodies.length - 1, handlers.length - 1)];
    handler(body, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { bodies, close: () => new Promise((r) => server.close(r)) };
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const completion = (content: string, finish = "stop") => ({
  id: "x",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
});

const chunks: RetrievedChunk[] = [{ id: "d#0", docId: "d", docTitle: "D", text: "Trials last 14 days.", score: 1 }];
const question = { id: "q", question: "How long is the trial?", reference: "14 days." };
const verdict = { claims: [{ claim: "Trials last 14 days", supported: true }], relevance: 5, correctness: 5, abstained: false, rationale: "ok" };

test("parseModel requires a known provider prefix", () => {
  assert.deepEqual(parseModel("groq:openai/gpt-oss-20b"), { backend: "groq", id: "openai/gpt-oss-20b" });
  assert.deepEqual(parseModel("ollama:qwen3:8b"), { backend: "ollama", id: "qwen3:8b" });
  assert.throws(() => parseModel("llama-3.3-70b"), /provider prefix/);
  assert.throws(() => parseModel("acme:model"), /provider prefix/);
});

test("missingKeys reports each provider once and skips keyless ollama", () => {
  const saved = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  const missing = missingKeys(["groq:a", "groq:b", "ollama:c"]);
  assert.deepEqual(missing.map((m) => m.keyEnv), ["GROQ_API_KEY"]);
  if (saved !== undefined) process.env.GROQ_API_KEY = saved;
});

test("answer strips <think> blocks, reads usage, and sends reasoning_effort only to reasoning models", async () => {
  const srv = await fakeServer([(_, res) => json(res, 200, completion("<think>hmm</think>Trials last 14 days. [d#0]"))]);
  try {
    const p = new OpenAICompatProvider();
    const a = await p.answer("ollama:gpt-oss:20b", question.question, chunks, "max");
    assert.equal(a.text, "Trials last 14 days. [d#0]");
    assert.deepEqual(a.usage, { inputTokens: 100, outputTokens: 20 });
    assert.equal(srv.bodies[0].reasoning_effort, "high"); // max maps to the highest level providers accept
    await p.answer("ollama:llama3.2", question.question, chunks, "medium");
    assert.equal(srv.bodies[1].reasoning_effort, undefined);
  } finally {
    await srv.close();
  }
});

test("rate-limited requests are retried after retry-after", async () => {
  const srv = await fakeServer([
    (_, res) => json(res, 429, { error: { message: "rate limited" } }, { "retry-after": "0" }),
    (_, res) => json(res, 200, completion("Trials last 14 days.")),
  ]);
  try {
    const a = await new OpenAICompatProvider().answer("ollama:llama3.2", question.question, chunks, "low");
    assert.equal(a.text, "Trials last 14 days.");
    assert.equal(srv.bodies.length, 2);
  } finally {
    await srv.close();
  }
});

test("judge falls back from strict json_schema to json_object, then remembers", async () => {
  const srv = await fakeServer([
    (_, res) => json(res, 400, { error: { message: "json_schema not supported" } }),
    (_, res) => json(res, 200, completion(`Here is the verdict:\n${JSON.stringify(verdict)}`)),
  ]);
  try {
    const p = new OpenAICompatProvider();
    const v = await p.judge("ollama:llama3.2", question, chunks, "Trials last 14 days.");
    assert.equal(v.claims.length, 1);
    assert.equal(v.correctness, 5);
    assert.equal(srv.bodies[0].response_format.type, "json_schema");
    assert.equal(srv.bodies[1].response_format.type, "json_object");
    assert.match(srv.bodies[1].messages[0].content, /Respond with only a JSON object/);

    await p.judge("ollama:llama3.2", question, chunks, "Trials last 14 days.");
    assert.equal(srv.bodies[2].response_format.type, "json_object", "should not retry strict mode");
  } finally {
    await srv.close();
  }
});

test("judge clamps out-of-range scores and rejects malformed verdicts", async () => {
  const srv = await fakeServer([
    (_, res) => json(res, 200, completion(JSON.stringify({ ...verdict, relevance: 9, correctness: 0 }))),
    (_, res) => json(res, 200, completion(JSON.stringify({ claims: "nope" }))),
  ]);
  try {
    const p = new OpenAICompatProvider();
    const v = await p.judge("ollama:llama3.2", question, chunks, "x");
    assert.equal(v.relevance, 5);
    assert.equal(v.correctness, 1);
    await assert.rejects(p.judge("ollama:llama3.2", question, chunks, "x"), /invalid verdict/);
  } finally {
    await srv.close();
  }
});
