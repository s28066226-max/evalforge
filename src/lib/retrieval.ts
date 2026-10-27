import type { Chunk, Doc, RetrievedChunk } from "./types.ts";

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from how i if in is it its of on or our that the this to was what when where which who why will with you your".split(
    " ",
  ),
);

/** Light suffix stripping so "refunded", "refunds" and "refund" match. Not Porter, but close enough for BM25. */
export function stem(t: string): string {
  if (t.length <= 4 || /\d/.test(t)) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length > 5) return t.slice(0, -2);
  if (t.endsWith("es") && /(s|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Split each document on paragraph boundaries, packing paragraphs into chunks of
 * up to `maxChars`. The section heading is carried into every chunk so a chunk
 * stays interpretable on its own.
 */
export function chunkDocs(docs: Doc[], maxChars = 700): Chunk[] {
  const chunks: Chunk[] = [];
  for (const doc of docs) {
    let heading = "";
    let buf: string[] = [];
    let n = 0;
    const flush = () => {
      const body = buf.join("\n\n").trim();
      if (body) {
        const text = heading && !body.startsWith(heading) ? `${heading}\n\n${body}` : body;
        chunks.push({ id: `${doc.id}#${n++}`, docId: doc.id, docTitle: doc.title, text });
      }
      buf = [];
    };
    for (const para of doc.text.split(/\n\s*\n/)) {
      const p = para.trim();
      if (!p) continue;
      if (/^#{1,3}\s/.test(p)) {
        flush();
        heading = p;
        continue;
      }
      if (buf.join("\n\n").length + p.length > maxChars) flush();
      buf.push(p);
    }
    flush();
  }
  return chunks;
}

/** Okapi BM25 over chunks. Lexical retrieval keeps the pipeline dependency-free and inspectable. */
export class BM25Index {
  private readonly docs: { chunk: Chunk; tf: Map<string, number>; len: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(chunks: Chunk[], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.docs = chunks.map((chunk) => {
      const tokens = tokenize(chunk.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { chunk, tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, k: number): RetrievedChunk[] {
    const terms = [...new Set(tokenize(query))];
    const N = this.docs.length;
    return this.docs
      .map(({ chunk, tf, len }) => {
        let score = 0;
        for (const t of terms) {
          const f = tf.get(t);
          if (!f) continue;
          const df = this.df.get(t) ?? 0;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * len) / this.avgLen));
        }
        return { ...chunk, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

export interface RetrievalScore {
  /** A chunk from a gold source document is in the top k. */
  hit: boolean;
  /** 1 / rank of the first gold chunk; 0 when none was retrieved. */
  reciprocalRank: number;
  /** Share of retrieved chunks that come from a gold source document. */
  precision: number;
}

/** Doc-level retrieval quality for one question. Chunk ids look like "<docId>#<n>". */
export function scoreRetrieval(sources: string[], chunks: { id: string }[]): RetrievalScore {
  const gold = new Set(sources);
  const isGold = chunks.map((c) => gold.has(c.id.slice(0, c.id.lastIndexOf("#"))));
  const first = isGold.indexOf(true);
  return {
    hit: first >= 0,
    reciprocalRank: first >= 0 ? 1 / (first + 1) : 0,
    precision: chunks.length ? isGold.filter(Boolean).length / chunks.length : 0,
  };
}
