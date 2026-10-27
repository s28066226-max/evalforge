import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadDataset } from "./dataset.ts";
import { BM25Index, chunkDocs, scoreRetrieval, stem, tokenize } from "./retrieval.ts";

test("stemming normalizes common inflections", () => {
  assert.equal(stem("refunded"), "refund");
  assert.equal(stem("refunds"), "refund");
  assert.equal(stem("plans"), "plan");
  assert.equal(stem("policies"), "policy");
  assert.equal(stem("access"), "access");
  assert.deepEqual(tokenize("What is the SLA?"), ["sla"]);
});

test("chunks carry their section heading", () => {
  const chunks = chunkDocs([{ id: "d", title: "D", text: "# D\n\n## Billing\n\nInvoices are monthly." }]);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /^## Billing/);
});

test("BM25 retrieves the chunk that contains the answer for every answerable sample question", () => {
  const ds = loadDataset(path.join(import.meta.dirname, "../../datasets/northwind"));
  const index = new BM25Index(chunkDocs(ds.docs));
  const misses: string[] = [];
  for (const q of ds.questions.filter((q) => !q.unanswerable)) {
    // Each reference shares at least one distinctive token with its source chunk.
    const refTokens = new Set(tokenize(q.reference!));
    const top = index.search(q.question, 4);
    const hit = top.some((c) => tokenize(c.text).filter((t) => refTokens.has(t)).length >= Math.min(2, refTokens.size));
    if (!hit) misses.push(q.id);
  }
  assert.deepEqual(misses, [], `retrieval missed: ${misses.join(", ")}`);
});

test("retrieval scoring uses the document id of each chunk", () => {
  const chunks = [{ id: "sla#1" }, { id: "pricing#0" }, { id: "pricing#3" }, { id: "api#0" }];
  assert.deepEqual(scoreRetrieval(["pricing"], chunks), { hit: true, reciprocalRank: 0.5, precision: 0.5 });
  assert.deepEqual(scoreRetrieval(["refunds"], chunks), { hit: false, reciprocalRank: 0, precision: 0 });
  assert.deepEqual(scoreRetrieval(["sla"], []), { hit: false, reciprocalRank: 0, precision: 0 });
});

test("every labeled sample question retrieves a chunk from its source document", () => {
  const ds = loadDataset(path.join(import.meta.dirname, "../../datasets/northwind"));
  const index = new BM25Index(chunkDocs(ds.docs));
  const misses = ds.questions.filter((q) => q.sources && !scoreRetrieval(q.sources, index.search(q.question, 4)).hit);
  assert.deepEqual(misses.map((q) => q.id), []);
});
