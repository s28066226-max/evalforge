import type { Usage } from "./types.ts";

/**
 * USD per million tokens. Free-tier models cost nothing, so this starts empty; add an
 * entry ("openrouter:some/model": { input, output }) to track spend on a paid model.
 */
export const PRICING: Record<string, { input: number; output: number }> = {};

export function costUsd(model: string, usage: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}
