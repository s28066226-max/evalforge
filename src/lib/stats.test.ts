import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapMeanCI,
  comparePaired,
  holmAdjust,
  normalCdf,
  pairedTTest,
  quantile,
  tTestPValue,
  wilcoxonSignedRank,
} from "./stats.ts";

// Reference values computed with scipy 1.x (see comments).
const a = [3, 4, 2, 5, 4, 3, 4, 2, 5, 3, 4, 4];
const b = [4, 5, 3, 5, 5, 4, 3, 4, 5, 4, 5, 5];

const close = (actual: number, expected: number, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tol, `expected ${expected}, got ${actual}`);

test("t distribution p-values match scipy", () => {
  close(tTestPValue(2.0, 7), 0.08561932856297597); // 2 * stats.t.sf(2.0, 7)
  close(tTestPValue(0.5, 30), 0.6207230048851273);
});

test("normal CDF matches scipy", () => {
  close(normalCdf(1.96), 0.9750021048517795, 1e-6);
  close(normalCdf(-0.5), 0.3085375387259869, 1e-6);
});

test("paired t-test matches scipy.stats.ttest_rel", () => {
  const r = pairedTTest(a, b);
  close(r.statistic, 3.4467375879228173);
  close(r.pValue, 0.005459380054375159);
});

test("wilcoxon signed-rank matches scipy (wilcox, correction, approx)", () => {
  const r = wilcoxonSignedRank(a, b);
  assert.equal(r.statistic, 5);
  close(r.pValue, 0.014659603227530273, 1e-5);
});

test("identical samples are not significant", () => {
  assert.equal(pairedTTest(a, a).pValue, 1);
  assert.equal(wilcoxonSignedRank(a, a).pValue, 1);
});

test("bootstrap CI is reproducible and brackets the mean", () => {
  const d = b.map((x, i) => x - a[i]);
  const ci1 = bootstrapMeanCI(d, { seed: 7 });
  const ci2 = bootstrapMeanCI(d, { seed: 7 });
  assert.deepEqual(ci1, ci2);
  const m = d.reduce((s, x) => s + x, 0) / d.length;
  assert.ok(ci1[0] < m && m < ci1[1]);
  assert.ok(ci1[0] > 0, "a clear improvement should have a CI above zero");
});

test("holm adjustment", () => {
  const adj = holmAdjust([0.01, 0.04, 0.03, 0.005]);
  [0.03, 0.06, 0.06, 0.02].forEach((e, i) => close(adj[i], e, 1e-12));
});

test("quantile interpolates", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([5], 0.9), 5);
});

test("comparePaired summarizes direction and effect size", () => {
  const c = comparePaired(a, b);
  assert.equal(c.n, 12);
  close(c.diff, 0.75);
  assert.ok(c.effectSize > 0.9);
  assert.throws(() => comparePaired([1, 2], [1]));
});
