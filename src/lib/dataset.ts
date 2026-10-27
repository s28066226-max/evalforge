import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Dataset, Doc, Question } from "./types.ts";

/**
 * A dataset is a directory with:
 *   docs/*.md | docs/*.txt   the retrieval corpus
 *   questions.jsonl          one {"id","question","reference"?,"unanswerable"?} per line
 */
export function loadDataset(dir: string): Dataset {
  const docsDir = path.join(dir, "docs");
  const docs: Doc[] = readdirSync(docsDir)
    .filter((f) => /\.(md|txt)$/.test(f))
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(docsDir, file), "utf8");
      const heading = text.match(/^#\s+(.+)$/m);
      return {
        id: file.replace(/\.(md|txt)$/, ""),
        title: heading ? heading[1].trim() : file,
        text,
      };
    });

  const questions: Question[] = readFileSync(path.join(dir, "questions.jsonl"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const q = JSON.parse(line) as Question;
      if (!q.id || !q.question) {
        throw new Error(`questions.jsonl line ${i + 1}: "id" and "question" are required`);
      }
      return q;
    });

  if (docs.length === 0) throw new Error(`No .md/.txt documents in ${docsDir}`);
  return { name: path.basename(path.resolve(dir)), docs, questions };
}
