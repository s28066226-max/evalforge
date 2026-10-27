import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getResults, getRetrievals, getRun, listRuns } from "../lib/db.ts";
import { publishedPath, readPublished, type PublishedRun } from "../lib/store.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    only: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: npm run export -- [run id ...] [--only]

Copies runs from your local results database into data/published.json, the file a
deployment serves. With no run ids it exports your latest completed live run.

  --only    replace the published runs instead of adding to them`);
  process.exit(0);
}

const ids = positionals.length
  ? positionals
  : listRuns()
      .filter((r) => r.status === "done" && r.config.provider === "live")
      .slice(0, 1)
      .map((r) => r.id);

if (ids.length === 0) {
  console.error("No completed live run to export. Run `npm run eval` first, or pass a run id.");
  process.exit(1);
}

const exported: PublishedRun[] = ids.map((id) => {
  const run = getRun(id);
  if (!run) {
    console.error(`Run ${id} not found in the local database.`);
    process.exit(1);
  }
  return { run, results: getResults(id), retrievals: Object.fromEntries(getRetrievals(id)) };
});

const kept = values.only ? [] : readPublished().runs.filter((r) => !ids.includes(r.run.id));
const runs = [...exported, ...kept].sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
writeFileSync(publishedPath(), JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), runs }, null, 1) + "\n");

for (const r of exported) console.log(`Published ${r.run.id} (${r.results.length} answers)`);
console.log(`data/published.json now holds ${runs.length} run(s). Commit it and redeploy to update the live site.`);
