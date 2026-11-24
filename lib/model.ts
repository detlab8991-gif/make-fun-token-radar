// Token Radar: a fitted, honest token-launch radar.
// Written fresh in this build session (round 2, 24 Nov 2026). Standard
// library only, no network, no clock, no unseeded randomness: every run on
// the same snapshot writes the same bytes. The one seeded PRNG below
// (mulberry32, fixed seed) is used only for the bootstrap confidence
// interval, so it is deterministic too.
//
// MODEL (fitted at run time from the snapshot itself, never hardcoded):
//   Launch value: log10(mcap) = a + b*log10(TVL), OLS on the 128 protocols
//   that record a token AND a positive market cap, plus a per-category median
//   residual, shrunk toward zero by n/(n+4) where n is the peer count in
//   that category (only categories with >= 5 peers; fewer peers get no
//   adjustment, and their intervals are widened instead).
//   Growth, age and chain count were TESTED and DROPPED: adding them made
//   leave-one-out error worse (recomputed at run time, see
//   multi_feature_loo_med_abs_pct), so the blind test, not a hunch, removed
//   them. Three further variants (Huber-robust, nested-LOO category shrink,
//   log TVL + log age) are pre-registered and tested once each at run time;
//   one is adopted only if it beats the base model by >= 5 points on LOO
//   median error, keeps 80%-interval coverage in 75-85%, and passes a
//   bootstrap on the per-peer error difference. Otherwise the base model
//   is frozen and the Method tab says so.
//   Launch odds: a logistic model P(records a token | log TVL, log age)
//   fitted on all 758 protocols, turned into a one-year conditional hazard:
//   the chance a protocol that has not launched by age A launches in the
//   next year, shrunk 50% toward the mean conditional odds and capped
//   [0.05, 0.60]. This is a ranking signal, not a forecast: "records no
//   token" is not proof a token does not exist, and "not launched yet" is
//   not "never launches".
//   Expected value: EV = launch value x launch odds x public share, with
//   public share a LABELLED assumption (median 10%, range 5-15%) because the
//   snapshot carries no supply or airdrop data to fit it from.
//   The board ranks by median EV. P10/P90 come from the LOO residual spread.
//   AMBIGUOUS ROWS: a protocol whose product token already trades (a
//   stablecoin, a tokenised-asset receipt, a subnet token) is NOT a
//   pre-token protocol, even when the snapshot records no gecko_id/symbol
//   for it — that is a data gap, not proof of no token. Such rows stay on
//   the board only because the house watchlist requires 40/40 coverage;
//   they are flagged "ambiguous", capped at confidence C, and excluded
//   from the KPI totals. The flag list is a labelled, documented correction
//   (checked against public sources 24 Nov 2026), not a fitted result.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FarmStep {
  text: string;
  cost_usd: number;
  minutes: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  launch_value_usd: number;
  launch_exact_usd: number;
  launch_p10_usd: number;
  launch_p90_usd: number;
  launch_odds: number;
  ev_p10_usd: number;
  ev_p90_usd: number;
  confidence: 'A' | 'B' | 'C';
  peer_count: number;
  peer_names: string[];
  verdict: 'FARM' | 'THIN' | 'SKIP';
  verdict_optimistic: 'FARM' | 'THIN' | 'SKIP';
  robust: boolean;
  capital_usd: number;
  gas_per_tx_usd: number;
  hours: number;
  net_per_hour_usd: number;
  farm_cost_usd: number;
  wallets_median: number;
  wallets_low: number;
  wallets_high: number;
  breakeven_wallets: number | null;
  ambiguous: string | null;
  eligibility_note: string;
  change_note: string;
}

export interface VariantTest {
  name: string;
  loo_med_abs_pct: number;
  loo_coverage80: number;
  boot_mean_diff: number;
  boot_ci_low: number;
  boot_ci_high: number;
  accepted: boolean;
  note: string;
}

export interface ModelMetrics {
  peers: number;
  intercept: number;
  slope: number;
  resid_std: number;
  loo_med_abs_pct: number;
  loo_std: number;
  loo_coverage80: number;
  loo_within2x_pct: number;
  loo_within3x_pct: number;
  naive_med_abs_pct: number;
  multi_feature_loo_med_abs_pct: number;
  odds_brier: number;
  odds_base_brier: number;
  public_share_median: number;
  public_share_low: number;
  public_share_high: number;
  model_variant: string;
  variant_tests: VariantTest[];
}

export interface Radar {
  as_of: string;
  rows: RadarRow[];
  metrics: ModelMetrics;
  ledger: { label: string; count: number; reason: string }[];
  ambiguous_rows: { slug: string; name: string; reason: string }[];
  watchlist_size: number;
  total_protocols: number;
  farm_counts: { FARM: number; THIN: number; SKIP: number };
  farm_counts_optimistic: { FARM: number; THIN: number; SKIP: number };
  total_ev_usd: number;
  total_ev_p10_usd: number;
  total_ev_p90_usd: number;
  total_ev_all_usd: number;
  total_ev_all_p10_usd: number;
  total_ev_all_p90_usd: number;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;

// Ambiguous rows: the product token already trades, so the protocol is not
// really pre-token, but the snapshot records no gecko_id/symbol for it.
// Checked against public sources on 24 Nov 2026; each reason states the
// token that already exists. These rows stay on the board only because the
// house watchlist requires 40/40 coverage; they are flagged, capped at
// confidence C, and excluded from the KPI totals.
export const AMBIGUOUS: Record<string, string> = {
  'usdd': 'USDD is a stablecoin that already trades (launched 2022, listed on HTX, KuCoin, Gate and others); the snapshot recording no token is a data gap.',
  'bittensor-dtao': 'dTAO subnet (alpha) tokens already trade against TAO in on-chain AMM pools, and TAO itself trades on Binance and others; the product is the token.',
  'theo-network-thusd': 'thUSD is a yield-bearing stablecoin that already trades (Uniswap V4, CoinGecko lists THUSD); the product is the token.',
  'r25': 'rcUSD / rcUSDp / rcUSD+ yield-bearing tokenised dollars already launched on Sui and Polygon; the product is the token.',
  'onre': 'ONyc, the tokenised-reinsurance token, already exists and trades (CoinGecko lists ONyc); the product is the token.',
  'opentrade': 'Tokenised vault/product tokens (e.g. SIERRA) already exist via its infrastructure; no separate governance token was found.',
  'plume-vaults': 'PLUME, the native token of the Plume network behind these vaults, already trades (TGE June 2025, ~$75M market cap); the vaults are its product line.',
  'axis': 'Issues USDX, a stablecoin product token already trading; the product is the token.',
};

export function ambiguousReason(p: SnapshotProtocol): string | null {
  return AMBIGUOUS[p.slug] ?? null;
}

// Labelled gas assumptions, priced at the snapshot date 14 Nov 2026.
// EVM chains: gas_units (per action) x gas_price_gwei x 1e-9 x native_price_usd.
// Non-EVM chains: a flat labelled per-transaction USD figure (Solana and
// Sui charge fractions of a cent; Tron charges for energy rental).
// Action sizes: main action 200k units, second action 150k, midway action
// 120k, claim 100k — four priced transactions per farm.
const GAS_UNITS = [0, 200_000, 150_000, 120_000, 0, 100_000];
const GAS_PRICE_GWEI: Record<string, number> = {
  Ethereum: 12, Base: 0.05, Arbitrum: 0.05, Optimism: 0.05,
  Polygon: 30, Binance: 3, Avalanche: 2,
};
const NATIVE_PRICE_USD: Record<string, number> = {
  Ethereum: 3200, Base: 3200, Arbitrum: 3200, Optimism: 3200,
  Polygon: 0.15, Binance: 600, Avalanche: 12,
};
const FLAT_GAS_USD: Record<string, number> = { Solana: 0.05, Sui: 0.1, Tron: 2 };
const DEFAULT_FLAT_GAS = 0.5;

export function gasCostsForChain(chain: string): number[] {
  const gwei = GAS_PRICE_GWEI[chain];
  if (gwei !== undefined) {
    const native = NATIVE_PRICE_USD[chain] ?? 3200;
    return GAS_UNITS.map((u) => (u * gwei * 1e-9 * native));
  }
  const flat = FLAT_GAS_USD[chain] ?? DEFAULT_FLAT_GAS;
  return GAS_UNITS.map((u) => (u === 0 ? 0 : flat));
}

export function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

export function derivativeReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category:' + p.category;
  if (WRAPPED_RE.test(p.name)) return 'name:wrapped-or-staked';
  for (const e of EXCHANGE_PREFIXES) if (p.name.startsWith(e)) return 'name:exchange-product';
  if (VERSION_RE.test(p.name)) return 'name:version-marker';
  return null;
}

export function isEligible(p: SnapshotProtocol): boolean {
  return !hasToken(p) && derivativeReason(p) === null;
}

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 86400000));
}

export function parseSnapshot(text: string): Snapshot {
  const o = JSON.parse(text) as Snapshot;
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('snapshot.json has no protocols/watchlist');
  return o;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

// Solve A x = b by Gaussian elimination with partial pivoting. A tiny ridge
// (1e-9 on the diagonal) keeps near-singular systems solvable.
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) M[i]![i]! += 1e-9;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const d = M[col]![col]!;
    if (d === 0) continue;
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = M[i]![i]! === 0 ? 0 : s / M[i]![i]!;
  }
  return x;
}

// Ordinary least squares for a design matrix whose rows already include the
// intercept column. Returns coefficients, or null if the system is degenerate.
function olsMulti(X: number[][], y: number[]): number[] | null {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < k; r++) {
      b[r]! += X[i]![r]! * y[i]!;
      for (let c = 0; c < k; c++) A[r]![c]! += X[i]![r]! * X[i]![c]!;
    }
  }
  const beta = solveLinear(A, b);
  if (beta.some((v) => !isFinite(v))) return null;
  return beta;
}

function ols(x: number[], y: number[]): { a: number; b: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i]! - mx) * (x[i]! - mx);
    sxy += (x[i]! - mx) * (y[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

// Per-category median residual, shrunk toward zero. `shrink` is either the
// count-dependent factor n/(n+4) ('count') or a fixed factor ('fixed', f).
function categoryAdj(
  peers: SnapshotProtocol[],
  resid: number[],
  mode: 'count' | 'fixed',
  fixedF = 0.5,
): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (let i = 0; i < peers.length; i++) {
    const c = peers[i]!.category ?? 'Unknown';
    const arr = byCat.get(c) ?? [];
    arr.push(resid[i]!);
    byCat.set(c, arr);
  }
  const out = new Map<string, number>();
  for (const [c, rs] of byCat) {
    if (rs.length >= 5) {
      const f = mode === 'count' ? rs.length / (rs.length + 4) : fixedF;
      out.set(c, Math.max(-0.6, Math.min(0.6, f * median(rs))));
    }
  }
  return out;
}

function peerCatCount(peers: SnapshotProtocol[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of peers) {
    const c = p.category ?? 'Unknown';
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

function peerNamesByCat(peers: SnapshotProtocol[]): Map<string, string[]> {
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of peers) {
    const c = p.category ?? 'Unknown';
    const arr = byCat.get(c) ?? [];
    arr.push(p);
    byCat.set(c, arr);
  }
  const out = new Map<string, string[]>();
  for (const [c, ps] of byCat) {
    out.set(
      c,
      [...ps].sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1)).slice(0, 3).map((p) => p.name),
    );
  }
  return out;
}

type FeatureFn = (p: SnapshotProtocol, age: number | null) => number[];

const FEAT_BASE: FeatureFn = (p) => [1, Math.log10(p.tvl_usd)];
const FEAT_AGE: FeatureFn = (p, age) => [1, Math.log10(p.tvl_usd), Math.log10((age ?? 365) + 1)];
const FEAT_MULTI: FeatureFn = (p, age) => [
  1,
  Math.log10(p.tvl_usd),
  p.change_7d ?? 0,
  Math.log10((age ?? 365) + 1),
  Math.log10(p.chains.length),
];

interface FittedValue {
  predict: (p: SnapshotProtocol, age: number | null) => number; // log10 launch value
  looErrsPct: number[];
  looResidDex: number[];
  looMedAbsPct: number;
  looStd: number;
  looCoverage80: number;
  intercept: number;
  slope: number;
}

// Fit a feature-based OLS value model on `peers` and run its leave-one-out
// test (refit + category adjustment each time). `shrinkMode` picks the
// category-shrink rule used both in fitting and in the LOO loop.
function fitFeatureModel(
  peers: SnapshotProtocol[],
  featFn: FeatureFn,
  asOf: string,
  shrinkMode: 'count' | 'fixed',
  fixedF = 0.5,
): FittedValue | null {
  const ages = peers.map((p) => ageDays(p.listed_at, asOf));
  const X = peers.map((p, i) => featFn(p, ages[i]!));
  const y = peers.map((p) => Math.log10(p.mcap_usd!));
  const beta = olsMulti(X, y);
  if (beta === null) return null;
  const resid = y.map((v, i) => v - X[i]!.reduce((s, xv, j) => s + xv * beta[j]!, 0));
  const adj = categoryAdj(peers, resid, shrinkMode, fixedF);
  const predict = (p: SnapshotProtocol, age: number | null): number => {
    const f = featFn(p, age);
    return f.reduce((s, xv, j) => s + xv * beta[j]!, 0) + (adj.get(p.category ?? 'Unknown') ?? 0);
  };
  const looErrsPct: number[] = [];
  const looResidDex: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const Xi = X.filter((_, j) => j !== i);
    const yi = y.filter((_, j) => j !== i);
    const pi = peers.filter((_, j) => j !== i);
    const bi = olsMulti(Xi, yi);
    if (bi === null) return null;
    const ri = yi.map((v, j) => v - Xi[j]!.reduce((s, xv, k) => s + xv * bi[k]!, 0));
    const adji = categoryAdj(pi, ri, shrinkMode, fixedF);
    const pred = X[i]!.reduce((s, xv, j) => s + xv * bi[j]!, 0) + (adji.get(peers[i]!.category ?? 'Unknown') ?? 0);
    const e = y[i]! - pred;
    looResidDex.push(e);
    looErrsPct.push(Math.abs(Math.pow(10, e) - 1) * 100);
  }
  const looStd = Math.sqrt(looResidDex.reduce((s, v) => s + v * v, 0) / Math.max(1, looResidDex.length - 1));
  return {
    predict,
    looErrsPct,
    looResidDex,
    looMedAbsPct: median(looErrsPct),
    looStd,
    looCoverage80: looResidDex.filter((e) => Math.abs(e) <= 1.2816 * looStd).length / Math.max(1, looResidDex.length),
    intercept: beta[0]!,
    slope: beta[1]!,
  };
}

// Huber-robust fit of the size-only model: iteratively reweighted least
// squares (k = 1.345 x a MAD-based scale), then the usual category
// adjustment on the robust residuals. LOO refits the whole IRLS each time.
function fitHuberModel(peers: SnapshotProtocol[], asOf: string): FittedValue | null {
  const fitOnce = (ps: SnapshotProtocol[]): { a: number; b: number; adj: Map<string, number> } | null => {
    const x = ps.map((p) => Math.log10(p.tvl_usd));
    const y = ps.map((p) => Math.log10(p.mcap_usd!));
    let w = new Array<number>(ps.length).fill(1);
    let a = 0;
    let b = 0;
    for (let it = 0; it < 15; it++) {
      // Weighted OLS on [1, x] with weights w.
      let sw = 0;
      let swx = 0;
      let swy = 0;
      let swxx = 0;
      let swxy = 0;
      for (let i = 0; i < ps.length; i++) {
        sw += w[i]!;
        swx += w[i]! * x[i]!;
        swy += w[i]! * y[i]!;
        swxx += w[i]! * x[i]! * x[i]!;
        swxy += w[i]! * x[i]! * y[i]!;
      }
      const det = sw * swxx - swx * swx;
      if (det === 0) return null;
      a = (swy * swxx - swx * swxy) / det;
      b = (sw * swxy - swx * swy) / det;
      const resid = y.map((v, i) => v - (a + b * x[i]!));
      const medR = median(resid);
      const mad = median(resid.map((v) => Math.abs(v - medR))) || 0.1;
      const s = Math.max(1.4826 * mad, 0.05);
      const k = 1.345 * s;
      w = resid.map((v) => Math.min(1, k / Math.max(1e-9, Math.abs(v))));
    }
    const resid = y.map((v, i) => v - (a + b * x[i]!));
    return { a, b, adj: categoryAdj(ps, resid, 'count') };
  };
  const full = fitOnce(peers);
  if (full === null) return null;
  const predict = (p: SnapshotProtocol): number =>
    full.a + full.b * Math.log10(p.tvl_usd) + (full.adj.get(p.category ?? 'Unknown') ?? 0);
  const looErrsPct: number[] = [];
  const looResidDex: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const pi = peers.filter((_, j) => j !== i);
    const fi = fitOnce(pi);
    if (fi === null) return null;
    const p = peers[i]!;
    const pred = fi.a + fi.b * Math.log10(p.tvl_usd) + (fi.adj.get(p.category ?? 'Unknown') ?? 0);
    const e = Math.log10(p.mcap_usd!) - pred;
    looResidDex.push(e);
    looErrsPct.push(Math.abs(Math.pow(10, e) - 1) * 100);
  }
  const looStd = Math.sqrt(looResidDex.reduce((s, v) => s + v * v, 0) / Math.max(1, looResidDex.length - 1));
  return {
    predict: (p) => predict(p),
    looErrsPct,
    looResidDex,
    looMedAbsPct: median(looErrsPct),
    looStd,
    looCoverage80: looResidDex.filter((e) => Math.abs(e) <= 1.2816 * looStd).length / Math.max(1, looResidDex.length),
    intercept: full.a,
    slope: full.b,
  };
}

// Deterministic PRNG (mulberry32, fixed seed) — bootstrap only, so runs
// stay byte-identical.
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bootstrap (B resamples, seeded) on the per-peer error difference
// base-minus-variant. Returns the mean difference and a 95% percentile CI.
// Positive means the variant is better.
function bootstrapMeanDiff(base: number[], variant: number[], seed: number, B = 2000): { mean: number; lo: number; hi: number } {
  const d = base.map((v, i) => v - variant[i]!);
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  const rnd = mulberry32(seed);
  const boots: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[Math.floor(rnd() * d.length)]!;
    boots.push(s / d.length);
  }
  boots.sort((a, b2) => a - b2);
  return { mean, lo: boots[Math.floor(0.025 * B)]!, hi: boots[Math.floor(0.975 * B)]! };
}

interface OddsModel {
  wTvl: number;
  wAge: number;
  b: number;
  muTvl: number;
  sdTvl: number;
  muAge: number;
  sdAge: number;
  brier: number;
  baseBrier: number;
  meanCondOdds: number;
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function fitOddsModel(all: SnapshotProtocol[], asOf: string): OddsModel {
  const feats = all.map((p) => {
    const age = ageDays(p.listed_at, asOf) ?? 365;
    return [Math.log10(p.tvl_usd) - 7.5, Math.log10(age + 1) - 2.7];
  });
  const t = all.map((p) => (hasToken(p) ? 1 : 0));
  const n = all.length;
  const muTvl = feats.reduce((s, f) => s + f[0]!, 0) / n;
  const muAge = feats.reduce((s, f) => s + f[1]!, 0) / n;
  const sdTvl = Math.sqrt(feats.reduce((s, f) => s + (f[0]! - muTvl) ** 2, 0) / n) || 1;
  const sdAge = Math.sqrt(feats.reduce((s, f) => s + (f[1]! - muAge) ** 2, 0) / n) || 1;
  const xs = feats.map((f) => [(f[0]! - muTvl) / sdTvl, (f[1]! - muAge) / sdAge]);
  const base = t.reduce((s, v) => s + v, 0) / n;
  let wTvl = 0;
  let wAge = 0;
  let b = Math.log(base / (1 - base));
  for (let it = 0; it < 500; it++) {
    let gwT = 0;
    let gwA = 0;
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const pr = sigmoid(b + wTvl * xs[i]![0]! + wAge * xs[i]![1]!);
      const d = pr - t[i]!;
      gwT += d * xs[i]![0]!;
      gwA += d * xs[i]![1]!;
      gb += d;
    }
    wTvl -= 0.5 * (gwT / n + 0.05 * wTvl);
    wAge -= 0.5 * (gwA / n + 0.05 * wAge);
    b -= 0.5 * (gb / n);
  }
  const probs = xs.map((f) => sigmoid(b + wTvl * f[0]! + wAge * f[1]!));
  const brier = probs.reduce((s, pr, i) => s + (pr - t[i]!) ** 2, 0) / n;
  const baseBrier = t.reduce((s, v) => s + (base - v) ** 2, 0) / n;
  // One-year conditional hazard for every no-token protocol, shrunk to its mean.
  const cond: number[] = [];
  for (const p of all) {
    if (hasToken(p)) continue;
    const age = ageDays(p.listed_at, asOf) ?? 365;
    const fA = cumProb(p, age, wTvl, wAge, b, muTvl, sdTvl, muAge, sdAge);
    const fB = cumProb(p, age + 365, wTvl, wAge, b, muTvl, sdTvl, muAge, sdAge);
    cond.push(fA >= 1 ? 0 : (fB - fA) / (1 - fA));
  }
  const meanCondOdds = cond.reduce((s, v) => s + v, 0) / Math.max(1, cond.length);
  return { wTvl, wAge, b, muTvl, sdTvl, muAge, sdAge, brier, baseBrier, meanCondOdds };
}

function cumProb(p: SnapshotProtocol, age: number, wTvl: number, wAge: number, b: number, muTvl: number, sdTvl: number, muAge: number, sdAge: number): number {
  const xT = (Math.log10(p.tvl_usd) - 7.5 - muTvl) / sdTvl;
  const xA = (Math.log10(age + 1) - 2.7 - muAge) / sdAge;
  return sigmoid(b + wTvl * xT + wAge * xA);
}

function launchOdds(p: SnapshotProtocol, asOf: string, om: OddsModel): number {
  const age = ageDays(p.listed_at, asOf) ?? 365;
  const fA = cumProb(p, age, om.wTvl, om.wAge, om.b, om.muTvl, om.sdTvl, om.muAge, om.sdAge);
  const fB = cumProb(p, age + 365, om.wTvl, om.wAge, om.b, om.muTvl, om.sdTvl, om.muAge, om.sdAge);
  const raw = fA >= 1 ? 0 : (fB - fA) / (1 - fA);
  const shrunk = 0.5 * raw + 0.5 * om.meanCondOdds;
  return Math.max(0.05, Math.min(0.6, shrunk));
}

function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 100_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

function walletsFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 100000;
  if (tvl >= 100_000_000) return 50000;
  if (tvl >= 50_000_000) return 25000;
  return 10000;
}

function categoryAction(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex')) return 'Provide liquidity to the main pool';
  if (c.includes('lending')) return 'Supply assets to the lending market';
  if (c.includes('yield')) return 'Deposit into the main yield vault';
  if (c.includes('derivative')) return 'Open a small hedged position on the main market';
  if (c.includes('rwa')) return 'Deposit into the main tokenised-asset pool';
  if (c.includes('risk') || c.includes('curator') || c.includes('allocator')) return 'Allocate to the main curator vault';
  if (c.includes('bridge')) return 'Bridge assets through the protocol once';
  if (c.includes('farm')) return 'Stake in the main farm';
  if (c.includes('cdp') || c.includes('stable')) return 'Mint the stable asset against collateral';
  if (c.includes('basis')) return 'Open the basis trade the protocol runs';
  if (c.includes('restak')) return 'Restake through the main vault';
  if (c.includes('liquid')) return 'Mint the liquid token from the main pool';
  return 'Use the protocol’s main product once';
}

function fmtGas(g: number): string {
  return g < 0.01 ? 'less than $0.01' : '$' + g.toFixed(2);
}

function farmSteps(p: SnapshotProtocol, capital: number, gasCosts: number[], chain: string, holdDays: number): FarmStep[] {
  const action = categoryAction(p.category);
  const second =
    p.category !== null && p.category.toLowerCase().includes('lending')
      ? `Borrow a small amount against the supply on ${chain} (about $${Math.round(capital / 2)}), then repay it the same week.`
      : p.category !== null && p.category.toLowerCase().includes('dex')
        ? `Swap a small amount in the same pool on ${chain} (about $${Math.round(capital / 2)}) to register a second action type.`
        : `Do a second, different action in the same protocol on ${chain} (about $${Math.round(capital / 2)}) so the farm is not a single repeated click.`;
  return [
    { text: `Use a fresh wallet that holds only the $${capital} you plan to farm, and keep its seed phrase offline.`, cost_usd: 0, minutes: 5 },
    { text: `${action} on ${chain} with $${capital} and keep the position open; gas is about ${fmtGas(gasCosts[1]!)} for this transaction.`, cost_usd: gasCosts[1]!, minutes: 20 },
    { text: second + ` Gas is about ${fmtGas(gasCosts[2]!)} for this transaction.`, cost_usd: gasCosts[2]!, minutes: 15 },
    { text: `Do one more qualifying action midway through the ${holdDays}-day hold on ${chain}, so the activity spans more than one snapshot. Gas is about ${fmtGas(gasCosts[3]!)} for this transaction.`, cost_usd: gasCosts[3]!, minutes: 10 },
    { text: `Hold the position for ${holdDays} days in total, then check the protocol’s own points page for eligibility.`, cost_usd: 0, minutes: 5 },
    { text: `Claim only from the link the protocol itself publishes, never pay anyone to claim for you, and log every transaction with its date. Gas is about ${fmtGas(gasCosts[5]!)} for this transaction.`, cost_usd: gasCosts[5]!, minutes: 5 },
  ];
}

export function buildRadar(snapshot: Snapshot): Radar {
  const peers = snapshot.protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const asOf = snapshot.as_of;

  // --- Base value model (size-only, count-dependent category shrink) ---
  const base = fitFeatureModel(peers, FEAT_BASE, asOf, 'count');
  if (base === null) throw new Error('base value model failed to fit');
  // Naive baseline: one median mcap/TVL ratio for all peers.
  const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
  const medRatio = median(ratios);
  const naiveMedAbsPct = median(peers.map((p) => Math.abs(p.mcap_usd! / (medRatio * p.tvl_usd) - 1) * 100));

  // --- Multi-feature model, recomputed at run time (was a hardcoded 91.1% in v1) ---
  const multi = fitFeatureModel(peers, FEAT_MULTI, asOf, 'count');
  if (multi === null) throw new Error('multi-feature model failed to fit');
  const multiFeatureLoo = multi.looMedAbsPct;

  // --- Pre-registered variant tests (one LOO each; adopt only on all gates) ---
  const variantTests: VariantTest[] = [];
  const testVariant = (name: string, fitted: FittedValue | null, note: string): void => {
    if (fitted === null) {
      variantTests.push({ name, loo_med_abs_pct: NaN, loo_coverage80: NaN, boot_mean_diff: NaN, boot_ci_low: NaN, boot_ci_high: NaN, accepted: false, note: note + ' — fit failed, not adopted.' });
      return;
    }
    const boot = bootstrapMeanDiff(base.looErrsPct, fitted.looErrsPct, 20261114);
    const improvement = base.looMedAbsPct - fitted.looMedAbsPct;
    const accepted =
      improvement >= 5 && fitted.looCoverage80 >= 0.75 && fitted.looCoverage80 <= 0.85 && boot.lo > 0;
    variantTests.push({
      name,
      loo_med_abs_pct: fitted.looMedAbsPct,
      loo_coverage80: fitted.looCoverage80,
      boot_mean_diff: boot.mean,
      boot_ci_low: boot.lo,
      boot_ci_high: boot.hi,
      accepted,
      note:
        note +
        (accepted
          ? ' — passed all gates, adopted.'
          : ` — not adopted (needs ≥5 pts better, coverage 75–85%, bootstrap CI above 0; improvement ${improvement.toFixed(1)} pts).`),
    });
  };
  // V1: Huber-robust size-only regression.
  const huber = fitHuberModel(peers, asOf);
  testVariant('Huber-robust size-only', huber, 'IRLS, k = 1.345 x MAD scale, 15 iterations.');
  // V2: category shrink chosen by nested LOO (candidates 0 / 0.25 / 0.5 / 0.75 / 1).
  const nested = ((): FittedValue | null => {
    const candidates = [0, 0.25, 0.5, 0.75, 1];
    const looWithF = (ps: SnapshotProtocol[], f: number): number[] => {
      const fit = fitFeatureModel(ps, FEAT_BASE, asOf, 'fixed', f);
      return fit === null ? [] : fit.looErrsPct;
    };
    const bestF = (ps: SnapshotProtocol[]): number => {
      let best = candidates[0]!;
      let bestMed = Infinity;
      for (const f of candidates) {
        const errs = looWithF(ps, f);
        if (errs.length === 0) continue;
        const med = median(errs);
        if (med < bestMed) {
          bestMed = med;
          best = f;
        }
      }
      return best;
    };
    const fStar = bestF(peers);
    const full = fitFeatureModel(peers, FEAT_BASE, asOf, 'fixed', fStar);
    if (full === null) return null;
    const looErrsPct: number[] = [];
    const looResidDex: number[] = [];
    for (let i = 0; i < peers.length; i++) {
      const pi = peers.filter((_, j) => j !== i);
      const fi = bestF(pi);
      const fitI = fitFeatureModel(pi, FEAT_BASE, asOf, 'fixed', fi);
      if (fitI === null) return null;
      const e = Math.log10(peers[i]!.mcap_usd!) - fitI.predict(peers[i]!, ageDays(peers[i]!.listed_at, asOf));
      looResidDex.push(e);
      looErrsPct.push(Math.abs(Math.pow(10, e) - 1) * 100);
    }
    const looStd = Math.sqrt(looResidDex.reduce((s, v) => s + v * v, 0) / Math.max(1, looResidDex.length - 1));
    return {
      predict: full.predict,
      looErrsPct,
      looResidDex,
      looMedAbsPct: median(looErrsPct),
      looStd,
      looCoverage80: looResidDex.filter((e) => Math.abs(e) <= 1.2816 * looStd).length / Math.max(1, looResidDex.length),
      intercept: full.intercept,
      slope: full.slope,
    };
  })();
  testVariant('Nested-LOO category shrink', nested, 'Shrink factor picked by inner LOO from {0, 0.25, 0.5, 0.75, 1}.');
  // V3: log TVL + log age only.
  const ageOnly = fitFeatureModel(peers, FEAT_AGE, asOf, 'count');
  testVariant('log TVL + log age', ageOnly, 'One extra feature beyond size; growth and chain count already failed as a group.');

  // Adopt the best accepted variant, if any; otherwise freeze the base model.
  let vm: FittedValue = base;
  let modelVariant = 'size-only OLS (base)';
  const accepted = variantTests.filter((t) => t.accepted);
  if (accepted.length > 0) {
    const best = accepted.sort((a, b) => a.loo_med_abs_pct - b.loo_med_abs_pct)[0]!;
    const fittedByName = new Map<string, FittedValue | null>([
      ['Huber-robust size-only', huber],
      ['Nested-LOO category shrink', nested],
      ['log TVL + log age', ageOnly],
    ]);
    const chosen = fittedByName.get(best.name);
    if (chosen !== null && chosen !== undefined) {
      vm = chosen;
      modelVariant = best.name + ' (accepted variant)';
    }
  }

  // Residual spread and within-2x/3x shares, from the ADOPTED model.
  const residStd = Math.sqrt(
    peers
      .map((p) => Math.log10(p.mcap_usd!) - vm.predict(p, ageDays(p.listed_at, asOf)))
      .reduce((s, v) => s + v * v, 0) / Math.max(1, peers.length - 2),
  );
  const looWithin2xPct = (vm.looResidDex.filter((e) => Math.abs(e) <= Math.log10(2)).length / Math.max(1, vm.looResidDex.length)) * 100;
  const looWithin3xPct = (vm.looResidDex.filter((e) => Math.abs(e) <= Math.log10(3)).length / Math.max(1, vm.looResidDex.length)) * 100;

  const om = fitOddsModel(snapshot.protocols, asOf);
  const z80 = 1.2816;
  const z90 = 1.6449; // wider interval for confidence-C rows (< 5 peers)
  const z25 = 0.6745;
  const eligible = snapshot.protocols.filter(isEligible);
  const peerCounts = peerCatCount(peers);
  const peerNames = peerNamesByCat(peers);
  const rows: RadarRow[] = [];
  for (const p of eligible) {
    const age = ageDays(p.listed_at, asOf);
    const cat = p.category ?? 'Unknown';
    const logLaunch = vm.predict(p, age);
    const launch = Math.pow(10, logLaunch);
    const peerN = peerCounts.get(cat) ?? 0;
    const confidence: RadarRow['confidence'] = peerN >= 10 ? 'A' : peerN >= 5 ? 'B' : 'C';
    const z = confidence === 'C' ? z90 : z80;
    const launchP10 = launch * Math.pow(10, -z * vm.looStd);
    const launchP90 = launch * Math.pow(10, z * vm.looStd);
    const odds = launchOdds(p, asOf, om);
    const ev = launch * odds * 0.1;
    const evP10 = launchP10 * odds * 0.05;
    const evP90 = launchP90 * odds * 0.15;
    const evP25 = launch * Math.pow(10, -z25 * vm.looStd) * odds * 0.075;
    const chain = p.chains[0] ?? 'Ethereum';
    const gasCosts = gasCostsForChain(chain);
    const gasTotal = gasCosts.reduce((s, v) => s + v, 0);
    const gasPerTx = gasTotal / 4;
    const capital = capitalFor(p.tvl_usd);
    const holdDays = age !== null && age >= 365 ? 60 : 30;
    const steps = farmSteps(p, capital, gasCosts, chain, holdDays);
    const hours = steps.reduce((s, st) => s + st.minutes, 0) / 60;
    const oppCost = capital * 0.05 * (holdDays / 365);
    const slippage = capital * 0.003;
    const farmCost = gasTotal + oppCost + slippage;
    const walletsMedian = walletsFor(p.tvl_usd);
    const walletsLow = Math.round(walletsMedian / 2);
    const walletsHigh = walletsMedian * 2;
    const grossPerWallet = (launch * 0.1 * odds) / walletsMedian;
    const net = grossPerWallet - farmCost;
    const netPerHour = net / hours;
    const verdict: RadarRow['verdict'] = netPerHour >= 5 ? 'FARM' : netPerHour >= 1 ? 'THIN' : 'SKIP';
    // Optimistic scenario: half as many eligible wallets (the labelled range).
    const grossOpt = (launch * 0.1 * odds) / walletsLow;
    const netOptPerHour = (grossOpt - farmCost) / hours;
    const verdictOptimistic: RadarRow['verdict'] = netOptPerHour >= 5 ? 'FARM' : netOptPerHour >= 1 ? 'THIN' : 'SKIP';
    // Break-even wallet count: FARM needs net/hour >= $5, i.e. wallets <= EV / (farmCost + 5*hours).
    const breakeven = farmCost + 5 * hours <= 0 ? null : Math.max(0, Math.round(ev / (farmCost + 5 * hours)));
    const netP25 = (evP25 / walletsMedian) - farmCost;
    const verdictP25: RadarRow['verdict'] = netP25 / hours >= 5 ? 'FARM' : netP25 / hours >= 1 ? 'THIN' : 'SKIP';
    const ambiguous = ambiguousReason(p);
    const finalConfidence: RadarRow['confidence'] = ambiguous !== null ? 'C' : confidence;
    const growth = p.change_7d;
    const changeNote =
      growth === null
        ? '7-day growth was not reported for this protocol, so growth changes nothing here.'
        : growth >= 5
          ? `TVL grew ${growth.toFixed(1)}% in 7 days; if that pace held, the launch value would be higher, but growth did not improve the blind test, so it is shown, not baked in.`
          : growth <= -10
            ? `TVL fell ${Math.abs(growth).toFixed(1)}% in 7 days; a falling TVL would cut the launch value if it continued.`
            : `TVL moved ${growth.toFixed(1)}% in 7 days; that move is too small to change the ranking.`;
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: Math.max(1, Math.round(ev)),
      farm_steps: steps.map((s) => s.text),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      launch_value_usd: Math.round(launch),
      launch_exact_usd: launch,
      launch_p10_usd: Math.round(launchP10),
      launch_p90_usd: Math.round(launchP90),
      launch_odds: odds,
      ev_p10_usd: Math.round(evP10),
      ev_p90_usd: Math.round(evP90),
      confidence: finalConfidence,
      peer_count: peerN,
      peer_names: peerNames.get(cat) ?? [],
      verdict,
      verdict_optimistic: verdictOptimistic,
      robust: verdict === verdictP25,
      capital_usd: capital,
      gas_per_tx_usd: gasPerTx,
      hours,
      net_per_hour_usd: netPerHour,
      farm_cost_usd: farmCost,
      wallets_median: walletsMedian,
      wallets_low: walletsLow,
      wallets_high: walletsHigh,
      breakeven_wallets: breakeven,
      ambiguous,
      eligibility_note: '',
      change_note: changeNote,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  // One eligibility line per top-20 row (gate for step 1); the rest get the
  // shorter, honest note that they were not individually swept.
  for (const r of rows) {
    if (r.ambiguous !== null) {
      r.eligibility_note = `Flagged ambiguous: ${r.ambiguous} Kept on the board only because the house watchlist requires 40/40 coverage; confidence capped at C and excluded from the KPI totals.`;
    } else if (r.rank <= 20) {
      r.eligibility_note = 'Clean: no token recorded in the snapshot, and no traded product or governance token was identified for it in the 24 Nov 2026 sweep of the top 20.';
    } else {
      r.eligibility_note = 'Clean: no token recorded in the snapshot, no derivative marker, and not individually swept (only the top 20 were swept by hand).';
    }
  }
  const farmCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  const farmCountsOpt = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) {
    farmCounts[r.verdict]++;
    farmCountsOpt[r.verdict_optimistic]++;
  }
  const clean = rows.filter((r) => r.ambiguous === null);
  const ambiguousRows = rows
    .filter((r) => r.ambiguous !== null)
    .map((r) => ({ slug: r.slug, name: r.name, reason: r.ambiguous! }));
  const ledger = [
    { label: 'On the board', count: rows.length, reason: 'Records no token and is not a wrapped, staked or bridged product.' },
    { label: 'Records a token already', count: snapshot.protocols.filter(hasToken).length, reason: 'gecko_id or symbol is recorded, so its token already trades.' },
    { label: 'Excluded as a derivative', count: snapshot.protocols.filter((p) => !hasToken(p) && !isEligible(p)).length, reason: 'No token recorded, but category, name or version marks it as wrapped, staked, bridged or an exchange product.' },
  ];
  return {
    as_of: snapshot.as_of,
    rows,
    metrics: {
      peers: peers.length,
      intercept: vm.intercept,
      slope: vm.slope,
      resid_std: residStd,
      loo_med_abs_pct: vm.looMedAbsPct,
      loo_std: vm.looStd,
      loo_coverage80: vm.looCoverage80,
      loo_within2x_pct: looWithin2xPct,
      loo_within3x_pct: looWithin3xPct,
      naive_med_abs_pct: naiveMedAbsPct,
      multi_feature_loo_med_abs_pct: multiFeatureLoo,
      odds_brier: om.brier,
      odds_base_brier: om.baseBrier,
      public_share_median: 0.1,
      public_share_low: 0.05,
      public_share_high: 0.15,
      model_variant: modelVariant,
      variant_tests: variantTests,
    },
    ledger,
    ambiguous_rows: ambiguousRows,
    watchlist_size: snapshot.watchlist.length,
    total_protocols: snapshot.protocols.length,
    farm_counts: farmCounts,
    farm_counts_optimistic: farmCountsOpt,
    total_ev_usd: clean.reduce((s, r) => s + r.implied_value_usd, 0),
    total_ev_p10_usd: clean.reduce((s, r) => s + r.ev_p10_usd, 0),
    total_ev_p90_usd: clean.reduce((s, r) => s + r.ev_p90_usd, 0),
    total_ev_all_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    total_ev_all_p10_usd: rows.reduce((s, r) => s + r.ev_p10_usd, 0),
    total_ev_all_p90_usd: rows.reduce((s, r) => s + r.ev_p90_usd, 0),
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, not 100-4000`;
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (!snapshot.protocols.some((p) => p.slug === r.slug)) return `slug ${r.slug} is not in the snapshot`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `row ${r.slug} has a farm step of ${s.trim().length} chars`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'ranks are not exactly 1..N';
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'implied value rises with rank';
  for (const w of snapshot.watchlist) if (!slugs.has(w)) return `watchlist slug ${w} is missing`;
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'all implied values are equal';
  return null;
}

export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
