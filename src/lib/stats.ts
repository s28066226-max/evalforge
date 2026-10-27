/**
 * Statistics for paired model comparisons. Every model answers the same questions,
 * so we compare per-question differences (paired tests), which removes question
 * difficulty as a source of variance and needs far fewer samples than unpaired tests.
 */

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

/** Sample standard deviation (n - 1). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// ---------- distributions ----------

function lnGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9)
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes `betacf`). */
function betacf(a: number, b: number, x: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for Student's t with `df` degrees of freedom. */
export function tTestPValue(t: number, df: number): number {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Standard normal CDF via the Abramowitz-Stegun erf approximation (|error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

// ---------- tests ----------

export interface TestResult {
  statistic: number;
  pValue: number;
}

/** Paired t-test on b - a. */
export function pairedTTest(a: number[], b: number[]): TestResult {
  const d = b.map((x, i) => x - a[i]);
  const n = d.length;
  const sd = stdev(d);
  const m = mean(d);
  if (n < 2) return { statistic: NaN, pValue: NaN };
  if (sd === 0) return { statistic: m === 0 ? 0 : Infinity * Math.sign(m), pValue: m === 0 ? 1 : 0 };
  const t = m / (sd / Math.sqrt(n));
  return { statistic: t, pValue: tTestPValue(t, n - 1) };
}

/**
 * Wilcoxon signed-rank test on b - a (zero differences dropped, average ranks for ties),
 * normal approximation with tie and continuity correction - matches
 * scipy.stats.wilcoxon(a, b, zero_method="wilcox", correction=True, method="approx").
 * Preferred over the t-test for bounded/ordinal scores like 1-5 ratings.
 */
export function wilcoxonSignedRank(a: number[], b: number[]): TestResult {
  const d = b.map((x, i) => x - a[i]).filter((x) => x !== 0);
  const n = d.length;
  if (n === 0) return { statistic: 0, pValue: 1 };

  const order = d.map((x, i) => ({ abs: Math.abs(x), i })).sort((p, q) => p.abs - q.abs);
  const ranks = new Array<number>(n);
  let tieTerm = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && order[j + 1].abs === order[i].abs) j++;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[order[k].i] = avg;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }

  const wPlus = d.reduce((s, x, i) => (x > 0 ? s + ranks[i] : s), 0);
  const wMinus = (n * (n + 1)) / 2 - wPlus;
  const W = Math.min(wPlus, wMinus);
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieTerm / 48);
  if (sigma === 0) return { statistic: W, pValue: 1 };
  const z = (W - mu + 0.5) / sigma; // continuity correction toward the mean
  return { statistic: W, pValue: Math.min(1, 2 * normalCdf(-Math.abs(z))) };
}

/** Small, fast, seedable PRNG so bootstrap results are reproducible. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap confidence interval for the mean of `xs`. */
export function bootstrapMeanCI(xs: number[], { iterations = 10_000, alpha = 0.05, seed = 42 } = {}): [number, number] {
  if (xs.length === 0) return [NaN, NaN];
  const rand = mulberry32(seed);
  const n = xs.length;
  const means = new Float64Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(rand() * n)];
    means[it] = s / n;
  }
  means.sort();
  const at = (q: number) => means[Math.min(iterations - 1, Math.max(0, Math.floor(q * iterations)))];
  return [at(alpha / 2), at(1 - alpha / 2)];
}

/**
 * Holm-Bonferroni step-down adjustment. Comparing several models on several metrics
 * inflates false positives; Holm controls the family-wise error rate and is uniformly
 * more powerful than plain Bonferroni.
 */
export function holmAdjust(pValues: number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const adjusted = new Array<number>(m);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[i] = running;
  });
  return adjusted;
}

export interface Comparison {
  n: number;
  baselineMean: number;
  challengerMean: number;
  /** challenger - baseline */
  diff: number;
  ci: [number, number];
  tTest: TestResult;
  wilcoxon: TestResult;
  /** Cohen's d_z: mean difference in units of the difference's standard deviation. */
  effectSize: number;
}

/** Compare challenger vs baseline on paired per-question scores. */
export function comparePaired(baseline: number[], challenger: number[], seed = 42): Comparison {
  if (baseline.length !== challenger.length) throw new Error("comparePaired: arrays must be paired");
  const d = challenger.map((x, i) => x - baseline[i]);
  const sd = stdev(d);
  return {
    n: d.length,
    baselineMean: mean(baseline),
    challengerMean: mean(challenger),
    diff: mean(d),
    ci: bootstrapMeanCI(d, { seed }),
    tTest: pairedTTest(baseline, challenger),
    wilcoxon: wilcoxonSignedRank(baseline, challenger),
    effectSize: sd === 0 ? 0 : mean(d) / sd,
  };
}
