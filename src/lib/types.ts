export interface Doc {
  id: string;
  title: string;
  text: string;
}

export interface Question {
  id: string;
  question: string;
  /** Gold answer. Optional: faithfulness is scored without one, correctness is not. */
  reference?: string;
  /** True when the corpus does not contain the answer; the model should decline. */
  unanswerable?: boolean;
  /** Ids of the documents that contain the answer. Enables retrieval metrics (hit rate, MRR). */
  sources?: string[];
}

export interface Dataset {
  name: string;
  docs: Doc[];
  questions: Question[];
}

export interface Chunk {
  id: string;
  docId: string;
  docTitle: string;
  text: string;
}

export interface RetrievedChunk extends Chunk {
  score: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Answer {
  text: string;
  usage: Usage;
  latencyMs: number;
  /** The model declined for safety reasons (stop_reason "refusal"). */
  refused: boolean;
}

export interface Claim {
  claim: string;
  supported: boolean;
}

export interface Verdict {
  claims: Claim[];
  /** 1-5: does the answer address the question? */
  relevance: number;
  /** 1-5 vs the reference answer; null when the question has no reference. */
  correctness: number | null;
  /** For unanswerable questions: did the model correctly say it doesn't know? */
  abstained: boolean;
  rationale: string;
}

export interface ResultRow {
  runId: string;
  questionId: string;
  model: string;
  answer: string;
  refused: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  /** Share of answer claims supported by the retrieved context, 0-1. */
  faithfulness: number;
  relevance: number;
  correctness: number | null;
  abstained: boolean;
  claims: Claim[];
  rationale: string;
}

export interface RunConfig {
  dataset: string;
  models: string[];
  baseline: string;
  judgeModel: string;
  topK: number;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  provider: "live" | "mock";
}

export interface RunRow {
  id: string;
  createdAt: string;
  status: "running" | "done" | "failed";
  config: RunConfig;
  questionCount: number;
  error: string | null;
}
