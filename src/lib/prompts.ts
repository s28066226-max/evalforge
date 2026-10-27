import type { Question, RetrievedChunk } from "./types.ts";

export const ABSTAIN_PHRASE = "I don't know based on the provided documents.";

export const ANSWER_SYSTEM = `You answer questions using only the documents provided in the user's message.

- Base every statement on the documents. Do not add facts from general knowledge.
- Cite the document id in square brackets after each statement, like [pricing#2].
- If the documents do not contain the answer, reply exactly: "${ABSTAIN_PHRASE}"
- Be concise: a few sentences at most.`;

export function renderContext(chunks: RetrievedChunk[]): string {
  return chunks.map((c) => `<document id="${c.id}" title="${c.docTitle}">\n${c.text}\n</document>`).join("\n");
}

export function answerPrompt(question: string, chunks: RetrievedChunk[]): string {
  return `<documents>\n${renderContext(chunks)}\n</documents>\n\nQuestion: ${question}`;
}

export const JUDGE_SYSTEM = `You are a strict evaluator of retrieval-augmented answers. You grade one answer at a time.

Grading procedure:
1. Claims. Break the answer into atomic factual claims (one checkable fact each). Ignore citations, hedges and the abstention sentence itself. For each claim, set supported=true only if the provided documents explicitly state or directly entail it. A claim that is true in the real world but absent from the documents is NOT supported. An answer that only abstains has zero claims.
2. relevance (integer 1-5): how directly the answer addresses the question. 5 = fully on point, 1 = off-topic.
3. correctness (integer 1-5, or null if no reference answer is given): agreement with the reference answer. 5 = same facts, 3 = partially correct or missing key facts, 1 = contradicts the reference.
4. abstained: true if the answer declines to answer because the documents lack the information.
5. rationale: one or two sentences explaining the scores, naming any unsupported claim.`;

export function judgePrompt(q: Question, chunks: RetrievedChunk[], answer: string): string {
  const reference = q.unanswerable
    ? "The documents do not contain this information; the ideal answer abstains."
    : (q.reference ?? null);
  return [
    `<documents>\n${renderContext(chunks)}\n</documents>`,
    `<question>${q.question}</question>`,
    reference ? `<reference_answer>${reference}</reference_answer>` : "<reference_answer>none</reference_answer>",
    `<answer_to_grade>\n${answer}\n</answer_to_grade>`,
  ].join("\n\n");
}
