export const seriesColor = (i: number) => `var(--series-${(i % 5) + 1})`;

export const pct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(digits)}%`;

export const score = (x: number | null | undefined) =>
  x === null || x === undefined || Number.isNaN(x) ? "–" : x.toFixed(2);

export const usd = (x: number) => {
  if (x === 0) return "$0";
  if (x < 0.01) return `$${x.toPrecision(2)}`;
  return `$${x.toFixed(x < 1 ? 3 : 2)}`;
};

export const seconds = (ms: number) => (Number.isNaN(ms) ? "–" : `${(ms / 1000).toFixed(2)}s`);

export const pValue = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);

export const date = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** "groq:openai/gpt-oss-20b" -> "gpt-oss-20b": short enough for chart labels. Tables keep the full id. */
export const shortName = (model: string) => {
  const id = model.includes(":") ? model.slice(model.indexOf(":") + 1) : model;
  return id.slice(id.lastIndexOf("/") + 1);
};
