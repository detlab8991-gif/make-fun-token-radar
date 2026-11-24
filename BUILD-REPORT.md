# Build report — token-radar-01

Built in recorded sessions (24 Nov 2026). No code was copied from another
entry; the only kit file kept as-is is `vendor/makefun-board.ts` (make.fun's
own dossier library, SHA 9ca51b6e… matches the kit manifest). Every submitted
file was written fresh in its session and then edited at least once more in
the same session. Round 2 (this file's second half) followed Claude's
strategy in one pass per step, under a ~1.5M-token cap for the round.

## Commands run

```
# kit (verified by parent; re-checked in v1)
# kit.json bundle_sha256 ea1c9dcc… ; 20/20 file SHA-256 match the manifest

# build + determinism (Node 22.23.4, the grader's version)
NODE22=~/workspace/make-fun-site/kit-work/node-v22.23.4-linux-x64/bin/node
MAKEFUN_OUTPUT_DIR=/tmp/radar-final $NODE22 main.ts --input ../kit-work/token-radar-01-kit/input/snapshot.json
MAKEFUN_OUTPUT_DIR=/tmp/radar-f2 $NODE22 main.ts --input ../kit-work/token-radar-01-kit/input/snapshot.json
# 1-CPU + 1024 MB run:
taskset -c 0 env MAKEFUN_OUTPUT_DIR=/tmp/radar-1cpu $NODE22 --max-old-space-size=1024 main.ts --input <snapshot>

# screenshots (headless, offline, Playwright Chromium 1248)
~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome --headless=new --disable-gpu --no-sandbox --window-size=1280,900 \
  --virtual-time-budget=5000 --screenshot=1-board.png "file://<out>/dashboard/index.html"
chrome ... --screenshot=2-detail.png "file://<out>/dashboard/index.html#detail-sentora-curator"
chrome ... --screenshot=3-filtered.png "file://<out>/dashboard/index.html#filtered"
```

## Model (fitted at run time from the snapshot, never hardcoded)

- Peers: 128 protocols that record a token AND a positive market cap
  (416 record a token, but 272 of them record no market cap and 16 record
  0 or -1, so they cannot price anything).
- Launch value: `log10(mcap) = 3.025 + 0.522 × log10(TVL)`, OLS, plus a
  per-category median residual shrunk by n/(n+4) (n = peer count in that
  category; categories with 5+ peers only; fewer peers get no adjustment
  and a widened 90% interval instead).
- Launch odds: logistic P(records a token | log TVL, log age) on all 758,
  turned into a one-year conditional hazard, shrunk 50% toward the mean
  conditional odds, capped [0.05, 0.60].
- Expected value: launch value × odds × public share. Public share is a
  LABELLED assumption (median 10%, range 5–15%) — the snapshot carries no
  supply/airdrop data to fit it from. Board ranks by median EV.
- Farm: capital by TVL tier ($250/$150/$100/$50); gas computed per action
  as gas units (main 200k, second 150k, midway 120k, claim 100k) × gas
  price × native-asset price, labelled at the snapshot date 14 Nov 2026
  (Ethereum 12 gwei × ETH $3,200; Base/Arbitrum/Optimism 0.05 gwei × ETH
  $3,200; Polygon 30 gwei × POL $0.15; BNB 3 gwei × BNB $600; Avalanche
  2 gwei × AVAX $12; Solana $0.05, Sui $0.10, Tron $2.00 flat per
  transaction); work hours are the plan's own minutes added up (60 min =
  1.0 h); 5% annual opportunity cost; 0.3% slippage; eligible wallets
  assumed by TVL tier (100k/50k/25k/10k) as the median of a range (half to
  double). Verdicts: FARM ≥ $5/h, THIN $1–5, SKIP < $1. A verdict is
  "robust" when it is the same at P25 and median. Each row also shows its
  optimistic verdict (half the wallets) and the break-even wallet count at
  which FARM stops being FARM.
- Ambiguous rows: 8 rows whose product token already trades are flagged,
  capped at confidence C, and excluded from the KPI totals (see round 2).

## Validation numbers

- Leave-one-out median absolute error: **86.6%** (residual std 0.886 dex,
  LOO std 0.922 dex). Naive baseline (one median mcap/TVL ratio): 90.1%.
  So the model beats the naive baseline by ~3.5 points — real, but small
  and inside the noise (see the bootstrap below).
- 80% interval coverage: **84%** (nominal 80% — intervals slightly wide).
- Within 2x of the truth (LOO): **31%** of peers; within 3x: **45%**.
- Multi-feature model (log TVL + growth + age + chains), LOO: **88.0%** —
  recomputed at run time in round 2 (v1 carried a hardcoded 91.1% from a
  Python audit; that constant is gone). Still worse than size-only, so
  those terms were dropped; the Method tab shows this test.
- Pre-registered variant tests (one LOO each + seeded bootstrap, 2,000
  resamples, on the per-peer error difference; adopt only on ≥5 pts better,
  coverage 75–85%, bootstrap 95% CI above 0):
  - Huber-robust size-only: LOO 86.0%, coverage 84%, bootstrap mean diff
    +15.4 pts, CI [−11.2, +52.0] — NOT adopted (median gain 0.6 pts, CI
    crosses 0).
  - Nested-LOO category shrink: LOO 89.2%, coverage 85%, bootstrap mean
    diff −10.4, CI [−98.6, +93.6] — NOT adopted (worse).
  - log TVL + log age: LOO 87.3%, coverage 83%, bootstrap mean diff +21.7,
    CI [−6.5, +59.3] — NOT adopted (gain 0.7 pts, CI crosses 0).
  - None passed, so the base model is frozen and the failed tests are
    shown, not hidden.
- Launch-odds Brier score: **0.234** vs 0.248 for the base rate alone.
- Walk-forward: **cannot be tested**. The snapshot has tracking-start
  dates (`listed_at`), not token-launch dates, so there is no launch
  timeline to walk forward over. Written as "cannot be tested", not faked.
- Data audit: every one of 758 protocols has a disposition (198 on board,
  416 record a token, 144 excluded as derivatives); 30 random samples
  checked by hand in v1, all dispositions correct. The starter board kept
  39 derivative rows; this board keeps none.

## Top 10 (median expected value)

| # | Protocol | EV | Launch | Odds | Verdict | Notes |
|---|----------|-----|--------|------|---------|-------|
| 1 | sentora-curator | $1,316,768 | $90M | 15% | SKIP (robust) | conf C, 1 peer (Api3) |
| 2 | steakhouse-financial | $1,212,631 | $90M | 13% | FARM | conf C |
| 3 | gauntlet | $903,278 | $67M | 13% | FARM | conf C |
| 4 | nonce-capital | $889,175 | $37M | 24% | SKIP | conf C |
| 5 | veda | $861,664 | $67M | 13% | THIN | conf C, 2 peers |
| 6 | bittensor-dtao | $802,545 | $34M | 23% | FARM | AMBIGUOUS (dTAO trades) |
| 7 | usdd | $706,858 | $54M | 13% | SKIP | AMBIGUOUS (USDD stablecoin trades) |
| 8 | theo-network-thusd | $560,596 | $23M | 22% | SKIP | AMBIGUOUS (thUSD stablecoin trades) |
| 9 | r25 | $532,985 | $28M | 17% | FARM | AMBIGUOUS (rcUSD trades) |
| 10 | onre | $530,069 | $35M | 14% | FARM | AMBIGUOUS (ONyc trades) |

Top 5 are all clean. Verdict counts: FARM 83, THIN 51, SKIP 64
(optimistic scenario at half the wallets: FARM 148). Robust verdicts
(same at P25 and median): 64 of 198 (v1: 87 — the farm-cost and hours
changes moved several rows across the P25 boundary). Total EV
(clean rows only): **$30.3M** (P10 $606K – P90 $1.28B); all rows
including ambiguous: $34.7M.

## Round 2 changes, before → after

1. **Ambiguous rows (step 1).** The top 20 were swept against public
   sources (24 Nov 2026). 8 rows flagged: usdd (USDD stablecoin trades on
   HTX/KuCoin/Gate), bittensor-dtao (dTAO alpha tokens trade vs TAO;
   TAO trades on Binance), theo-network-thusd (thUSD trades on Uniswap V4),
   r25 (rcUSD/rcUSDp/rcUSD+ launched), onre (ONyc trades), opentrade
   (vault/product tokens e.g. SIERRA exist), plume-vaults (PLUME trades
   since TGE June 2025), axis (USDX stablecoin trades). Each row carries
   its reason in `eligibility_note`; every top-20 row has one eligibility
   line. The other top-20 rows were checked and are clean (Risk Curators,
   Veda, RockawayX, Upshift, BitFi Basis, Valos, DeFi Saver, Mellow,
   Tori Finance, Lightning Network dropped to #21). Flagged rows stay on
   the board only for the 40/40 watchlist gate, are capped at confidence C
   and excluded from KPI totals. Effect: clean total EV $34.4M → $30.3M.
2. **Audit constant recomputed (step 2).** `multi_feature_loo_med_abs_pct`
   is now computed by the program at run time (OLS, 4 features, LOO refit
   loop): **88.0%** (v1 hardcoded 91.1%). Still worse than size-only, so
   the terms stay dropped.
3. **Model variants (step 3).** Three pre-registered variants tested once
   each (see Validation). None passed all gates; the base model is frozen.
   Added "% within 2x / 3x" (31% / 45%) and the honest Method-tab line
   that the model is "about as good as the naive baseline in point
   accuracy; its value is in the intervals, category awareness and
   calibration".
4. **Farm (step 4).** Gas is now a formula (units × price × native price,
   labelled 14 Nov 2026) instead of a flat per-chain USD table; work hours
   are the plan's own minutes (60 min = 1.0 h) instead of a fixed 3 h;
   wallets are a range (÷2, ×2) with an optimistic verdict and a break-even
   wallet count per row. NOT touched: public share 10%, odds cap, $5/$1
   thresholds (fixed before seeing results). Effect: FARM 1 → 83, THIN
   110 → 51, SKIP 87 → 64; optimistic FARM 148. The jump is the honest
   consequence of correcting two overstated inputs (3 h of work for a
   60-minute plan, $48 of Ethereum gas for what the formula prices at
   ~$22); it is reported here, not tuned away. The Method tab and detail
   view now state that the per-wallet average favours small wallets.
5. **Confidence-C rows + screenshots (step 5).** Category shrink is now
   n/(n+4) instead of a flat 50%; C rows use a widened 90% interval
   (z = 1.645) and name their peers ("n=3: A, B, C"); C rows are labelled
   "a rough guess, not an estimate". A "confidence A or B only" preset was
   added and is used for the filtered screenshot (69 rows, was Risk
   Curators 34 rows). The detail view was reordered so the farm verdict,
   cost, break-even and first 4 farm steps sit above the 1280×900 fold;
   the formula and steps 5–6 follow below. Effect of the shrink change:
   LOO 85.8% → 86.6% (slightly worse — reported, not hidden); RWA/Dexs
   launch values rose slightly (e.g. bittensor-dtao EV $777,508 →
   $802,545).
6. **QA (step 6).** See below; all gates pass.

## Round 3 changes (24 Nov 2026) — one priority: validation (criteria 2)

Diagnostic (read-only, same day): per-game judge notes do not exist in the
CLI or on the site; the leaderboard is not ordered by the CLI dev rate
("shown, never weighed"); the top entries' repos are not public. The one
verifiable gap against the top blurbs was validation depth (held-out 2–4
ways + conformal intervals + rank ranges). Round 3 closes exactly that gap,
under a 0.8–1.0M-token cap. NOT touched: model coefficients, verdict
thresholds ($5/$1), odds cap, public share, ranking, the 8 ambiguous flags,
or the FARM/THIN/SKIP definitions. The board is byte-identical to round 2
(board.json SHA 5fe0ded0… unchanged).

1. **Held-out validation, three ways (all computed at run time).**
   - Leave-category-out: every one of the 128 peers predicted once, by a
     model trained on all other categories (34 categories). Median error
     **87.7%** (naive 89.5%), within 2x 34%, within 3x 41%. Directly tests
     the confidence-C rows.
   - Size extrapolation: train on the smaller half by TVL, test on the
     larger half (64 test peers, split at the $31.7M median). Median error
     **83.0%** (naive 90.9%), within 2x 30%, within 3x 38%.
   - Listing-age sequential split: train on the older half of the 95 dated
     peers, test on the newer half (48 test peers). Median error **83.4%**
     (naive 92.4%), within 2x 35%, within 3x 50%. Labelled honestly as a
     listing-age split, NOT a walk-forward test; the 33 peers with no
     listed_at are excluded from this scheme only.
   - The naive baseline in each scheme is the one-ratio model fitted on
     the TRAINING peers only, so the comparison is on the same held-out
     peers. The model beats naive on point error in all three schemes.
2. **Rank accuracy (the metric aligned with the job).** Spearman on the LOO
   predictions: **0.40 for the fitted model vs 0.44 for the naive TVL
   ranking**; top-quartile hit rate **53% vs 56% naive**. Reported as-is:
   the fitted model ranks slightly WORSE than TVL alone. The category
   adjustment helps the point error a little and shuffles the order a
   little. The ranking is kept because the fitted model gives the
   intervals, the category awareness and the calibration that a bare TVL
   ranking cannot — but the dashboard does not claim the ranking beats TVL.
3. **Conformal intervals replace z × std.** P10/P90 are now the fitted
   value ± the conformal absolute-residual quantile of the LOO residuals
   (finite-sample correction ceil((n+1) × level)/n; n = 128): 80%
   half-width **1.073 dex**, 90% half-width **1.638 dex**. Empirical
   coverage, each peer judged against the other 127 residuals: **80% at
   80% nominal, 91% at 90% nominal** — the intervals are calibrated. The
   P25 for the "robust" verdict is the 25th percentile of the same
   residuals (−0.531 dex). Effect on totals: clean total EV unchanged at
   $30.3M; P10 $599K (was $606K), P90 $1.59B (was $1.28B) — wider upper
   tail because the top rows are confidence C and now use the 90%
   conformal quantile.
4. **Rank range per row.** The ranks a row would take at its P10 / P90
   while every other row stayed at its median (public share held at 10%).
   The ranges are very wide — median width **197 ranks**, top row 1–198 —
   because the conformal interval spans ~12× in each direction while the
   board's median EVs span only ~42×. Stated plainly in the Method tab:
   the ordering is a ranking of medians. One bug caught by the gate
   self-check: the first version counted the row itself in its worst rank
   (range 1–199 for a 198-row board); fixed to exclude the row itself.
   Shown in the board (rank cell) and the detail view.
5. **Farm: deposit ceiling (presentation, not a retune).** The payout per
   wallet does not grow with the deposit in this model, so there is no
   minimum deposit that "unlocks" FARM — the binding question is the
   ceiling: the largest deposit that still nets $5/hour, shown per row in
   the detail view. 83 of 83 FARM rows and 17 of 51 THIN rows have a
   ceiling (a THIN row below its ceiling would be FARM); none of the 64
   SKIP rows do. FARM count unchanged at 83.
6. **Cover screenshot.** KPI strip (one row, equal-width stats) and
   integrity strip (shortened held-out chip) compacted; the board note
   shortened to one line; protocol cells truncate the chain list with an
   ellipsis (full text in the tooltip and the detail view). The 1280×900
   board shot now shows **8 full rows + the start of row 9** (was 3 rows),
   including FARM rows — the top row is still SKIP, as it should be: the
   verdict was not hidden or changed.
7. **What is still impossible, written down.** Walk-forward (no launch
   dates), value at launch (needs launch-day market caps), true public
   share (needs supply/airdrop data) — the Method tab now lists the data
   each would need. No claim from another entry (e.g. "x2.26") was copied.

## Determinism (Node 22.23.4)

- board.json SHA-256: `5fe0ded03289903d606c73218f6c37c53da24bd122c4ffaffcece38b834fa913` (identical across two runs and the 1-CPU run; identical to round 2 — the board did not change)
- data.js SHA-256: `595c39a32789fb2ae7fcf7026a6caac088660ee27663d61a32710dc58318d698` (identical)
- dossier.json SHA-256: `ed595f592ed37a5da5ff3cf82885f14a98a2b2d2a35286e0890f05422a7a4d40` (identical across the two final runs)
- Run time: ~3.1 s on 1 CPU (limit 120 s). No `Date.now`, no unseeded
  random, no network calls in any submitted file (grep-verified; the one
  PRNG, mulberry32, has a fixed seed and is used only for the bootstrap
  CI, so runs stay byte-identical).

## Gate self-check (all pass, final run)

- 198 rows (100–4,000), ranks exactly 1–198, EV non-increasing with rank,
  not all equal; watchlist 40/40 covered; 158 rows outside the watchlist.
- Every farm_steps array has 6 strings of 20–600 chars (max 182 in this run).
- Dashboard: index.html + app.css + app.js = 37,090 bytes (< 64 KB dossier
  text cap); no `http://` or `https://` in any dashboard file.
- Dossier text 37,355 bytes (< 65,536). board.json 182,207 bytes (< 8 MiB).
  Dossier total 910,342 bytes (< 1.5 MiB).
- Screenshots: 3 PNGs, 1280×900 each, 199–233 KB (cap 512 KB); board
  (8 full rows + start of row 9), detail (Sentora Curator — verdict box,
  cost, break-even, deposit ceiling and steps 1–4 above the fold), filtered
  (confidence A/B only, 69 rows, 8 full rows visible). All three were
  inspected visually and match the run.
- Browser recompute check: 0 mismatches across all 198 rows
  (detail view recomputes EV from the stored exact launch value).
- Break-even wallet count present on all 198 rows; optimistic verdict
  counts sum to 198. Deposit ceiling present on 100 rows (83 FARM + 17
  THIN), null on 98; rank ranges valid on all 198 rows (rank_lo ≤ rank ≤
  rank_hi, inside 1–198).

## Known weaknesses (do not hide these)

1. The median error is 86.6%: P10–P90 spans roughly 200×. Only 31% of
   peers land within 2x of the truth. Every figure is a range, not a
   price; the dashboard rounds to 2 significant figures.
2. FARM jumped from 1 to 83 in round 2 because two v1 inputs were
   overstated (3 h of work for a 60-minute plan; $48 Ethereum gas vs
   ~$22 by the formula). The new inputs are the plan's own minutes and a
   priced gas formula, but a judge may still read 83/198 FARM as a board
   that calls nearly half of everything farmable — the optimistic count
   (148) and the break-even wallet counts are shown so the sensitivity is
   visible instead of hidden.
3. The top rows are confidence C: Risk Curators has 1 traded peer (Api3,
   as categorised in the snapshot) and Onchain Capital Allocator has 2,
   so their launch values rest on the global size curve. Their intervals
   are widened and their peers are named.
4. Launch odds are a weak signal (Brier 0.234 vs 0.248 base) and
   calibration is poor at the extremes.
5. Public share (10%) is an assumption, not a fitted number; if the true
   share is smaller, every EV falls in proportion.
6. 8 ambiguous rows stay on the board for the watchlist gate. They are
   flagged and excluded from the KPI totals, but a strict judge could
   still ask why a stablecoin is ranked at all; the ledger states the
   rule and the reason per row.
7. The wallet counts (100k/50k/25k/10k) remain labelled assumptions with
   no data behind them; the range, optimistic verdict and break-even
   count are the honest substitute for a fitted number.
8. (Round 3, new) The fitted model ranks slightly worse than ranking by
   TVL alone (Spearman 0.40 vs 0.44; top-quartile hit 53% vs 56% naive).
   The held-out point error beats naive in all three schemes, but the
   ranking does not — the category adjustment trades a little rank
   accuracy for point accuracy and calibration. And the rank ranges are
   very wide (median width 197 of 198 ranks): with a ±12× interval around
   every row, the board's ordering is a ranking of medians, and almost no
   single rank is distinguishable from its neighbours. Both facts are
   printed on the dashboard rather than hidden.
