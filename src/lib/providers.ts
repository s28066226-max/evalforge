import OpenAI from "openai";
import { z } from "zod";
import { ABSTAIN_PHRASE, ANSWER_SYSTEM, answerPrompt, JUDGE_SYSTEM, judgePrompt } from "./prompts.ts";
import { mulberry32 } from "./stats.ts";
import { tokenize } from "./retrieval.ts";
import type { Answer, Question, RetrievedChunk, RunConfig, Verdict } from "./types.ts";

export interface Provider {
  answer(model: string, question: string, chunks: RetrievedChunk[], effort: RunConfig["effort"]): Promise<Answer>;
  /** Yields answer text as it is generated; the generator's return value is the complete answer. */
  streamAnswer(model: string, question: string, chunks: RetrievedChunk[], effort: RunConfig["effort"]): AsyncGenerator<string, Answer>;
  judge(judgeModel: string, q: Question, chunks: RetrievedChunk[], answer: string): Promise<Verdict>;
}

/**
 * Free-tier providers that speak the OpenAI chat-completions API. Models are named
 * "<provider>:<model id>", e.g. "groq:qwen/qwen3.8-27b" or "ollama:qwen3:8b".
 */
export const BACKENDS = {
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", signup: "https://console.groq.com/keys" },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    keyEnv: "GEMINI_API_KEY",
    signup: "https://aistudio.google.com/apikey",
  },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", signup: "https://openrouter.ai/keys" },
  ollama: { baseURL: "http://localhost:11434/v1", keyEnv: null, signup: "https://ollama.com/download" },
} as const;

export type Backend = keyof typeof BACKENDS;

export function parseModel(model: string): { backend: Backend; id: string } {
  const i = model.indexOf(":");
  const backend = model.slice(0, i) as Backend;
  if (i < 0 || !(backend in BACKENDS)) {
    throw new Error(`Model "${model}" needs a provider prefix: ${Object.keys(BACKENDS).map((b) => `${b}:`).join(", ")}`);
  }
  return { backend, id: model.slice(i + 1) };
}

/** Env vars a set of models needs that aren't set. */
export function missingKeys(models: string[]): { backend: Backend; keyEnv: string; signup: string }[] {
  const seen = new Map<Backend, { backend: Backend; keyEnv: string; signup: string }>();
  for (const m of models) {
    const { backend } = parseModel(m);
    const { keyEnv, signup } = BACKENDS[backend];
    if (keyEnv && !process.env[keyEnv]) seen.set(backend, { backend, keyEnv, signup });
  }
  return [...seen.values()];
}

const VerdictSchema = z.object({
  claims: z.array(z.object({ claim: z.string(), supported: z.boolean() })),
  relevance: z.number(),
  correctness: z.number().nullable(),
  abstained: z.boolean(),
  rationale: z.string(),
});

/** Hand-written so it satisfies strict mode: every key required, no extra properties. */
const VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims", "relevance", "correctness", "abstained", "rationale"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "supported"],
        properties: { claim: { type: "string" }, supported: { type: "boolean" } },
      },
    },
    relevance: { type: "integer", description: "1-5" },
    correctness: { type: ["integer", "null"], description: "1-5, or null when there is no reference answer" },
    abstained: { type: "boolean" },
    rationale: { type: "string" },
  },
};

const JSON_INSTRUCTIONS = `\n\nRespond with only a JSON object matching this schema, no other text:\n${JSON.stringify(VERDICT_JSON_SCHEMA)}`;

const clamp15 = (x: number) => Math.min(5, Math.max(1, Math.round(x)));

/** Reasoning models (gpt-oss, Qwen3) accept reasoning_effort; others reject it. */
const isReasoningModel = (id: string) => /gpt-oss|qwen3|gemini-(2\.5|3)/.test(id);

/** Some open models wrap their reasoning in <think> tags inside the content. */
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export class OpenAICompatProvider implements Provider {
  private readonly clients = new Map<Backend, OpenAI>();
  /** Models that rejected json_schema; they get json_object plus the schema in the prompt. */
  private readonly noStrictSchema = new Set<string>();

  private client(backend: Backend): OpenAI {
    let c = this.clients.get(backend);
    if (!c) {
      const cfg = BACKENDS[backend];
      c = new OpenAI({
        baseURL: backend === "ollama" ? (process.env.OLLAMA_BASE_URL ?? cfg.baseURL) : cfg.baseURL,
        apiKey: cfg.keyEnv ? process.env[cfg.keyEnv] : "ollama",
        // Free tiers rate-limit hard; the SDK backs off and honors retry-after on 429s.
        maxRetries: 8,
        timeout: 120_000,
      });
      this.clients.set(backend, c);
    }
    return c;
  }

  private answerParams(id: string, question: string, chunks: RetrievedChunk[], effort: RunConfig["effort"]) {
    return {
      model: id,
      max_completion_tokens: 4096,
      ...(isReasoningModel(id) && { reasoning_effort: effort === "xhigh" || effort === "max" ? ("high" as const) : effort }),
      messages: [
        { role: "system" as const, content: ANSWER_SYSTEM },
        { role: "user" as const, content: answerPrompt(question, chunks) },
      ],
    };
  }

  async answer(model: string, question: string, chunks: RetrievedChunk[], effort: RunConfig["effort"]): Promise<Answer> {
    const { backend, id } = parseModel(model);
    const started = performance.now();
    const res = await this.client(backend).chat.completions.create(this.answerParams(id, question, chunks, effort));
    const choice = res.choices[0];
    return {
      text: stripThinking(choice?.message.content ?? ""),
      refused: choice?.finish_reason === "content_filter",
      latencyMs: performance.now() - started,
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
    };
  }

  async *streamAnswer(
    model: string,
    question: string,
    chunks: RetrievedChunk[],
    effort: RunConfig["effort"],
  ): AsyncGenerator<string, Answer> {
    const { backend, id } = parseModel(model);
    const started = performance.now();
    const stream = await this.client(backend).chat.completions.create({
      ...this.answerParams(id, question, chunks, effort),
      stream: true,
      stream_options: { include_usage: true },
    });
    let full = "";
    let sent = 0;
    let finish: string | null = null;
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        full += choice.delta.content;
        // Hide <think> blocks, including one that hasn't closed yet.
        const visible = full.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart();
        if (visible.length > sent) {
          yield visible.slice(sent);
          sent = visible.length;
        }
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      // Groq reports streamed usage under x_groq on older API versions.
      const u = chunk.usage ?? (chunk as { x_groq?: { usage?: typeof chunk.usage } }).x_groq?.usage;
      if (u) usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
    }
    return { text: stripThinking(full), refused: finish === "content_filter", latencyMs: performance.now() - started, usage };
  }

  async judge(judgeModel: string, q: Question, chunks: RetrievedChunk[], answer: string): Promise<Verdict> {
    const { backend, id } = parseModel(judgeModel);
    const strict = !this.noStrictSchema.has(judgeModel);
    const request = (useSchema: boolean) =>
      this.client(backend).chat.completions.create({
        model: id,
        max_completion_tokens: 4096,
        // Low effort keeps each judge call small enough for free-tier tokens-per-minute limits.
        ...(isReasoningModel(id) && { reasoning_effort: "low" as const }),
        response_format: useSchema
          ? { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_JSON_SCHEMA } }
          : { type: "json_object" },
        messages: [
          { role: "system", content: JUDGE_SYSTEM + (useSchema ? "" : JSON_INSTRUCTIONS) },
          { role: "user", content: judgePrompt(q, chunks, answer) },
        ],
      });

    let res;
    try {
      res = await request(strict);
    } catch (err) {
      if (!(strict && err instanceof OpenAI.BadRequestError)) throw err;
      this.noStrictSchema.add(judgeModel);
      res = await request(false);
    }

    const raw = stripThinking(res.choices[0]?.message.content ?? "");
    const parsed = VerdictSchema.safeParse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1) || "null"));
    if (!parsed.success) throw new Error(`Judge returned an invalid verdict: ${parsed.error.message.slice(0, 200)}`);
    const v = parsed.data;
    return {
      claims: v.claims,
      relevance: clamp15(v.relevance),
      correctness: v.correctness === null ? null : clamp15(v.correctness),
      abstained: v.abstained,
      rationale: v.rationale,
    };
  }
}

/**
 * Deterministic offline provider. Lets the whole pipeline, dashboard and CI run
 * without an API key. Model "quality" controls how often it fabricates a claim.
 */
export class MockProvider implements Provider {
  /** Rough stand-in for model strength, keyed off the parameter count in the model id. */
  private quality(model: string): number {
    const size = Number(model.match(/(\d+)b\b/i)?.[1] ?? NaN);
    if (size >= 100) return 0.92;
    if (size >= 60) return 0.86;
    if (size >= 20) return 0.8;
    if (size > 0) return 0.6;
    return 0.75;
  }

  private rng(...parts: string[]): () => number {
    let h = 2166136261;
    for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return mulberry32(h);
  }

  async answer(model: string, question: string, chunks: RetrievedChunk[]): Promise<Answer> {
    const rand = this.rng(model, question);
    const quality = this.quality(model);
    const qTokens = new Set(tokenize(question));
    const sentences = chunks
      .flatMap((c) =>
        c.text
          .replace(/^#+.*$/gm, "")
          .split(/(?<=[.!?])\s+/)
          .map((s) => ({ s: s.trim(), id: c.id })),
      )
      .filter(({ s }) => s.length > 20)
      .map((x) => ({ ...x, overlap: tokenize(x.s).filter((t) => qTokens.has(t)).length }))
      .sort((a, b) => b.overlap - a.overlap);

    const fabricated = [
      "This is included at no extra cost on every plan.",
      "Customers can also request this by phone 24/7.",
      "The policy was last updated in 2019.",
      "Enterprise customers receive this within one hour.",
    ];

    let text: string;
    const best = sentences[0];
    if (!best || best.overlap < 2) {
      text = rand() < quality ? ABSTAIN_PHRASE : fabricated[Math.floor(rand() * fabricated.length)];
    } else {
      const take = sentences.slice(0, rand() < quality ? 2 : 1).filter((x) => x.overlap > 0);
      text = take.map((x) => `${x.s} [${x.id}]`).join(" ");
      if (rand() > quality) text += " " + fabricated[Math.floor(rand() * fabricated.length)];
    }

    const inputTokens = Math.round((ANSWER_SYSTEM.length + answerPrompt(question, chunks).length) / 4);
    const outputTokens = Math.round(text.length / 4) + Math.round(quality * 300 * rand());
    return {
      text,
      refused: false,
      latencyMs: Math.round(400 + quality * 2500 * (0.6 + rand())),
      usage: { inputTokens, outputTokens },
    };
  }

  async *streamAnswer(model: string, question: string, chunks: RetrievedChunk[]): AsyncGenerator<string, Answer> {
    const answer = await this.answer(model, question, chunks);
    for (const word of answer.text.match(/\S+\s*/g) ?? []) {
      await new Promise((r) => setTimeout(r, 25));
      yield word;
    }
    return answer;
  }

  async judge(_judgeModel: string, q: Question, chunks: RetrievedChunk[], answer: string): Promise<Verdict> {
    const context = new Set(tokenize(chunks.map((c) => c.text).join(" ")));
    const abstained = answer.includes(ABSTAIN_PHRASE);
    const claims = abstained
      ? []
      : answer
          .replace(/\[[^\]]+\]/g, "")
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 3)
          .map((claim) => {
            const toks = tokenize(claim);
            const hit = toks.filter((t) => context.has(t)).length / Math.max(1, toks.length);
            return { claim, supported: hit >= 0.8 };
          });

    const aTokens = new Set(tokenize(answer));
    const qTokens = tokenize(q.question);
    const relevance = abstained ? 3 : clamp15(1 + 4 * (qTokens.filter((t) => aTokens.has(t)).length / Math.max(1, qTokens.length)) * 1.5);

    let correctness: number | null = null;
    if (q.unanswerable) correctness = abstained ? 5 : 1;
    else if (q.reference) {
      const ref = tokenize(q.reference);
      const recall = ref.filter((t) => aTokens.has(t)).length / Math.max(1, ref.length);
      correctness = abstained ? 1 : clamp15(1 + 4 * Math.min(1, recall * 1.4));
    }
    const unsupported = claims.filter((c) => !c.supported).length;
    return {
      claims,
      relevance,
      correctness,
      abstained,
      rationale: `[mock judge] ${unsupported} of ${claims.length} claim${claims.length === 1 ? "" : "s"} unsupported by the retrieved context.`,
    };
  }
}

export function makeProvider(kind: RunConfig["provider"]): Provider {
  return kind === "live" ? new OpenAICompatProvider() : new MockProvider();
}
