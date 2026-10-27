import { missingKeys } from "./providers.ts";

export const ARENA_DATASET = "datasets/northwind";

/** Models the public arena compares. Override with ARENA_MODELS / ARENA_JUDGE on the deployment. */
export function arenaConfig() {
  const models = (process.env.ARENA_MODELS ?? "groq:openai/gpt-oss-20b,groq:qwen/qwen3.8-27b")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const judge = process.env.ARENA_JUDGE ?? "groq:openai/gpt-oss-120b";
  const mode: "live" | "mock" = missingKeys([...models, judge]).length ? "mock" : "live";
  return { models, judge, mode, enabled: process.env.ARENA_DISABLED !== "1" };
}

/** Events streamed by /api/arena as newline-delimited JSON. */
export type ArenaEvent =
  | { type: "meta"; mode: "live" | "mock"; models: string[]; judge: string }
  | { type: "retrieval"; chunks: { id: string; docTitle: string; text: string; score: number }[] }
  | { type: "delta"; model: string; text: string }
  | { type: "answer"; model: string; latencyMs: number; tokens: number; refused: boolean }
  | {
      type: "verdict";
      model: string;
      faithfulness: number;
      relevance: number;
      abstained: boolean;
      claims: { claim: string; supported: boolean }[];
      rationale: string;
    }
  | { type: "error"; model?: string; message: string }
  | { type: "done" };
