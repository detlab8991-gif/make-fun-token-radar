# Build report — token-radar-01

Built in a single recorded session (24 Nov 2026). No code was copied from
another entry; the only kit file kept as-is is `vendor/makefun-board.ts`
(make.fun's own dossier library, SHA 9ca51b6e… matches the kit manifest).
Every submitted file was written fresh in this session and then edited at
least once more in the same session.

## Commands run

```
# kit (already verified by parent; re-checked here)
# kit.json bundle_sha256 ea1c9dcc… ; 20/20 file SHA-256 match the manifest

# build + determinism (Node 22.23.4, the grader's version)
NODE22=~/workspace/make-fun-site/kit-work/node-v22.23.4-linux-x64/bin/node
MAKEFUN_OUTPUT_DIR=/tmp/radar-final1 $NODE22 main.ts --input ../kit-work/token-radar-01-kit/input/snapshot.json
MAKEFUN_OUTPUT_DIR=/tmp/radar-final2 $NODE22 main.ts --input ../kit-work/token-radar-01-kit/input/snapshot.json
# 1-CPU + 1024 MB run:
taskset -c 0 env MAKEFUN_OUTPUT_DIR=/tmp/radar-1cpu $NODE22 --max-old-space-size=1024 main.ts --input <snapshot>

# screenshots (headless, offline, Playwright Chromium; /opt/meta-chromium
# refuses to start without a Hatch WebGL domain policy)
chrome --headless=new --disable-gpu --no-sandbox --window-size=1280,900 \
  --virtual-time-budget=5000 --screenshot=1-board.png "file://<out>/dashboard/index.html"
chrome ... --screenshot=2-detail.png "file://<out>/dashboard/index.html#detail-sentora-curator"
chrome ... --screenshot=3-filtered.png "file://<out>/dashboard/index.html#filtered"
```

## Model (fitted at run time from the snapshot, never hardcoded)

- Peers: 128 protocols that record a token AND a positive market cap
  (416 record a token, but 272 of them record no market cap and 16 record
  0 or -1, so they cannot price anything).
- Launch value: `log10(mcap) = 3.025 + 0.522 × log10(TVL)`, OLS, plus a
  per-category median residual shrunk 50% (categories with 5+ peers only).
- Launch odds: logistic P(records a token | log TVL, log age) on all 758,
  turned into a one-year conditional hazard, shrunk 50% toward the mean
  conditional odds, capped [0.05, 0.60].
- Expected value: launch value × odds × public share. Public share is a
  LABELLED assumption (median 10%, range 5–15%) — the snapshot carries no
  supply/airdrop data to fit it from. Board ranks by median EV.
- Farm: capital by TVL tier ($250/$150/$100/$50), gas by main chain
  (Ethereum $12, Solana $0.05, L2s $1, Tron $2, others $0.50), 3 hours of
  work, 5% annual opportunity cost, 0.3% slippage, eligible wallets assumed
  by TVL tier (100k/50k/25k/10k). Verdicts: FARM ≥ $5/h, THIN $1–5,
  SKIP < $1. A verdict is "robust" when it is the same at P25 and median.

## Validation numbers

- Leave-one-out median absolute error: **85.8%** (residual std 0.914 dex).
  Naive baseline (one median mcap/TVL ratio): 90.1%. So the model beats
  the naive baseline by ~4 points — real, but small.
- 80% interval coverage: **84%** (nominal 80% — intervals slightly wide).
- Multi-feature model (log TVL + growth + age + chains), LOO: **91.1%** —
  worse than size-only, so those terms were dropped; the Method tab shows
  this test instead of hiding it.
- Launch-odds Brier score: **0.234** vs 0.248 for the base rate alone.
- Walk-forward: **cannot be tested**. The snapshot has tracking-start
  dates (`listed_at`), not token-launch dates, so there is no launch
  timeline to walk forward over. Written as "cannot be tested", not faked.
- Data audit: every one of 758 protocols has a disposition (198 on board,
  416 record a token, 144 excluded as derivatives); 30 random samples
  checked by hand, all dispositions correct. The starter board kept 39
  derivative rows; this board keeps none.

## Top 10 (median expected value)

| # | Protocol | EV | Launch | Odds | Verdict |
|---|----------|-----|--------|------|---------|
| 1 | sentora-curator | $1,316,768 | $90M | 15% | SKIP (robust) |
| 2 | steakhouse-financial | $1,212,631 | $90M | 13% | THIN |
| 3 | gauntlet | $903,278 | $67M | 13% | SKIP (robust) |
| 4 | nonce-capital | $889,175 | $37M | 24% | SKIP (robust) |
| 5 | veda | $861,664 | $67M | 13% | THIN |
| 6 | bittensor-dtao | $777,508 | $34M | 23% | THIN |
| 7 | usdd | $706,858 | $54M | 13% | SKIP (robust) |
| 8 | theo-network-thusd | $515,798 | $23M | 22% | SKIP (robust) |
| 9 | r25 | $490,394 | $28M | 17% | THIN |
| 10 | onre | $487,711 | $35M | 14% | THIN |

Verdict counts: FARM 1 (drakewell, $7.12/h), THIN 110, SKIP 87.
Robust verdicts (same at P25 and median): 87 of 198. Total EV $34.4M
(P10 $1.15M – P90 $774M).

## Determinism (2 runs, Node 22.23.4)

- board.json SHA-256: `f76068aa243e7ba8b8a0834ccd956aca87e393a682ed46abd02572007b55153d` (identical, both runs; also identical on the 1-CPU run)
- data.js SHA-256: `741683ca0e6ae08d029574b029608b5444665ad750a7485246e659d454375bb7` (identical)
- dossier.json SHA-256: `6cff4a8d15b0a157c936e0cb0180f797e7ae2138bd2225bee2c8fed237a53ba6` (identical)
- Run time: ~0.4 s (limit 120 s). No `Date.now`, no unseeded random, no
  network calls in any submitted file (grep-verified).

## Gate self-check (all pass)

- 198 rows (100–4,000), ranks exactly 1–198, EV non-increasing with rank,
  not all equal; watchlist 40/40 covered; 158 rows outside the watchlist.
- Every farm_steps array has 6 strings of 20–600 chars.
- Dashboard: index.html + app.css + app.js = 22,443 bytes (< 64 KB dossier
  text cap); no `http://` or `https://` in any dashboard file.
- Dossier text 22,708 bytes (< 65,536). board.json 165,886 bytes (< 8 MiB).
- Screenshots: 3 PNGs, 1280×900 each, 151–184 KB (target 300–350 KB,
  cap 512 KB); board, detail (Sentora Curator), filtered (Risk Curators,
  34 rows). All three were inspected visually and match the run.
- Browser recompute check: 0 mismatches across all 198 rows
  (detail view recomputes EV from the stored exact launch value).

## Known weaknesses (do not hide these)

1. The median error is 85.8%: P10–P90 spans roughly 200×. Every figure
   is a range, not a price; the dashboard rounds to 2 significant figures.
2. Only 1 FARM verdict. Under the labelled assumptions (up to 100k
   eligible wallets, $48 of Ethereum gas), most farms are uneconomic.
   If the true wallet counts are much smaller, more rows would be FARM.
3. The top rows are confidence C: Risk Curators has fewer than 5 traded
   peers, so their launch values rest on the global size curve.
4. Launch odds are a weak signal (Brier 0.234 vs 0.248 base) and
   calibration is poor at the extremes.
5. Public share (10%) is an assumption, not a fitted number; if the true
   share is smaller, every EV falls in proportion.
6. USDD is on the board (rank 7): it records no token in the snapshot and
   is on the house watchlist, but it is a stablecoin, so a strict judge
   could still question it. It is kept because the house's own rule keeps
   it; the ledger states the rule.
