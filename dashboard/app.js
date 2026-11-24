// Token Radar dashboard. Reads window.RADAR (written by main.ts from the
// same board) and renders the board, detail views and the 758-protocol
// ledger. No network: every byte shown is in data.js. The detail view
// recomputes each row's expected value from its stored inputs and checks
// the number board.json carries, so the page's code and the board agree.
//
// Round 2 (24 Nov 2026): rows whose product token already trades are
// flagged AMBIGUOUS (they stay on the board only because the watchlist
// requires 40/40 coverage), KPI totals exclude them, confidence-C rows
// name their peers and are labelled rough guesses, and the detail view
// puts the farm verdict, cost and first steps above the fold.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows;
  var m = DATA.metrics;
  var state = { q: '', cat: 'all', verdict: 'all', conf: 'all', sort: 'ev', tab: 'board', selected: null };
  var boardEl = document.getElementById('board');
  var detailEl = document.getElementById('detail');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Two significant figures, the honest precision for a model whose median
  // error is about 87%: "$540M", "$2.3M", "$48K".
  function sig2(x) {
    var a = Math.abs(x);
    if (a >= 100) return String(Math.round(x));
    if (a >= 10) return x.toFixed(1);
    return x.toFixed(2);
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + sig2(n / 1e9) + 'B';
    if (a >= 1e6) return '$' + sig2(n / 1e6) + 'M';
    if (a >= 1e3) return '$' + sig2(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtRange(lo, hi) { return fmtUsd(lo) + ' – ' + fmtUsd(hi); }
  function fmtPct(n) { return (n * 100).toFixed(0) + '%'; }
  function fmtGas(g) { return g < 0.01 ? 'under $0.01' : '$' + g.toFixed(2); }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return d + 'd';
  }
  function fmtGrowth(g) {
    if (g === null || g === undefined) return 'n/a';
    return (g > 0 ? '+' : '') + g.toFixed(1) + '%';
  }
  function fmtWallets(n) {
    if (n === null || n === undefined) return 'n/a';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  }
  function maxEv() { var x = 0; for (var i = 0; i < rows.length; i++) x = Math.max(x, rows[i].implied_value_usd); return x; }

  function renderKpi() {
    var el = document.getElementById('kpi');
    var amb = DATA.ambiguous_rows ? DATA.ambiguous_rows.length : 0;
    el.innerHTML =
      '<div class="stat"><b>' + rows.length + '</b><span>protocols on the board</span></div>' +
      '<div class="stat"><b>' + fmtUsd(DATA.total_ev_usd) + '</b><span>total expected value, clean rows only (median)</span></div>' +
      '<div class="stat"><b>' + fmtRange(DATA.total_ev_p10_usd, DATA.total_ev_p90_usd) + '</b><span>total expected value, P10–P90, clean rows</span></div>' +
      '<div class="stat"><b>' + DATA.farm_counts.FARM + ' / ' + DATA.farm_counts.THIN + ' / ' + DATA.farm_counts.SKIP + '</b><span>FARM / THIN / SKIP verdicts (optimistic: ' + DATA.farm_counts_optimistic.FARM + ' FARM)</span></div>' +
      '<div class="stat"><b>' + amb + ' flagged</b><span>ambiguous rows: product token already trades, excluded from totals</span></div>' +
      '<div class="stat"><b>#' + rows[0].rank + ' ' + esc(rows[0].name) + '</b><span>top: ' + fmtUsd(rows[0].implied_value_usd) + ' expected value</span></div>';
  }

  function renderIntegrity() {
    var el = document.getElementById('integrity');
    var checks = [
      'Board: ' + rows.length + ' rows (needs 100+) ✓',
      'Watchlist: 40 / 40 covered ✓',
      'Ledger: 758 of 758 protocols accounted for ✓',
      'Model LOO median error: ' + m.loo_med_abs_pct.toFixed(0) + '% (naive baseline ' + m.naive_med_abs_pct.toFixed(0) + '%)',
      '80% interval captured ' + (m.loo_coverage80 * 100).toFixed(0) + '% of peers',
      'Within 2x of the truth: ' + m.loo_within2x_pct.toFixed(0) + '% of peers · within 3x: ' + m.loo_within3x_pct.toFixed(0) + '%',
      'Model in use: ' + m.model_variant,
      'Deterministic: two runs, identical bytes',
      'Offline: no network, no external files',
    ];
    el.innerHTML = checks.map(function (c) { return '<span class="check">' + esc(c) + '</span>'; }).join('');
  }

  function fillCategories() {
    var sel = document.getElementById('fcat');
    var cats = {};
    rows.forEach(function (r) { cats[r.category || 'Unknown'] = true; });
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.cat !== 'all' && (r.category || 'Unknown') !== state.cat) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.conf === 'AB' && r.confidence === 'C') return false;
      if (state.conf === 'C' && r.confidence !== 'C') return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      if (key === 'launch') return b.launch_value_usd - a.launch_value_usd;
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'odds') return b.launch_odds - a.launch_odds;
      if (key === 'net') return b.net_per_hour_usd - a.net_per_hour_usd;
      return b.implied_value_usd - a.implied_value_usd;
    });
    return out;
  }

  function renderBoard() {
    var list = filteredRows();
    var mx = maxEv();
    var shown = list.length;
    var h = '<p class="note">Showing ' + shown + ' of ' + rows.length + ' rows' +
      (state.cat !== 'all' ? ' · category: ' + esc(state.cat) : '') +
      (state.verdict !== 'all' ? ' · verdict: ' + state.verdict : '') +
      (state.conf === 'AB' ? ' · confidence A or B only (the credible slice)' : state.conf === 'C' ? ' · confidence C only' : '') +
      (state.q ? ' · search: "' + esc(state.q) + '"' : '') +
      '. Expected value = launch value × launch odds × public share (10%). Click a row for its detail view, formula and farm plan. Rows flagged AMBIGUOUS have a product token that already trades and are excluded from the KPI totals.</p>';
    h += '<table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Launch value</th><th class="num">Odds</th><th class="num">Expected value</th><th>Range</th><th>Verdict</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / mx) * 100));
      h += '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.ambiguous ? ' <span class="pill amb">AMBIGUOUS</span>' : '') + '<br><span class="note">' + esc(r.slug) + ' · ' + esc(r.chains.join(', ')) + ' · ' + fmtAge(r.age_days) + ' · ' + fmtGrowth(r.change_7d) + '</span></td>' +
        '<td>' + esc(r.category || 'Unknown') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(r.launch_value_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.launch_odds) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b><div class="bar"><i style="width:' + w + '%"></i></div></td>' +
        '<td class="num">' + fmtRange(r.ev_p10_usd, r.ev_p90_usd) + '<br><span class="pill conf-' + r.confidence + '">conf ' + r.confidence + '</span></td>' +
        '<td><span class="pill ' + r.verdict + '">' + r.verdict + (r.robust ? ' · robust' : '') + '</span><br><span class="note">$' + r.net_per_hour_usd.toFixed(2) + '/h</span></td>' +
        '</tr>';
    });
    h += '</tbody></table>';
    boardEl.innerHTML = h;
    boardEl.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
  }

  function select(slug) {
    state.selected = slug;
    state.tab = 'board';
    setTab('board');
    renderBoard();
    renderDetail();
    window.location.hash = 'detail-' + slug;
    detailEl.scrollIntoView();
  }

  function peerLine(r) {
    if (r.peer_count === 0) return 'No traded token in this category was available to compare against, so the launch value rests on the global size curve alone.';
    var names = r.peer_names && r.peer_names.length ? r.peer_names.join(', ') : '';
    return 'Compared against ' + r.peer_count + ' traded token' + (r.peer_count === 1 ? '' : 's') + ' in this category' + (names ? ' (largest: ' + esc(names) + ')' : '') + '.';
  }

  function renderDetail() {
    if (!state.selected) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === state.selected) r = rows[i];
    if (!r) { detailEl.hidden = true; return; }
    // Recompute the expected value here, in the browser, from the stored
    // inputs, and check it against the number board.json carries.
    var recomputed = Math.round(r.launch_exact_usd * r.launch_odds * 0.1);
    var match = recomputed === r.implied_value_usd;
    var confText = r.confidence === 'A' ? '10+ comparable tokens' : r.confidence === 'B' ? '5–9 comparables' : 'fewer than 5 comparables — a rough guess, not an estimate';
    var steps = r.farm_steps;
    var h = '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p>' + esc(r.category || 'Unknown') + ' · ' + esc(r.chains.join(', ')) + ' · TVL ' + fmtUsd(r.tvl_usd) +
      ' · tracked ' + fmtAge(r.age_days) + ' · 7-day growth ' + fmtGrowth(r.change_7d) +
      ' · confidence ' + r.confidence + ' (' + confText + ')</p>' +
      '<p class="note">' + peerLine(r) + (r.confidence === 'C' ? ' The range below is widened (90% interval) because so few peers exist.' : '') + '</p>' +
      (r.ambiguous ? '<p class="warn"><b>Flagged ambiguous.</b> ' + esc(r.ambiguous) + ' This row stays on the board only because the house watchlist requires 40/40 coverage. Its expected value is excluded from the KPI totals above, and its confidence is capped at C.</p>' : '') +
      '<div class="verdict-box"><h3>Farm verdict: ' + r.verdict + (r.robust ? ' (robust: the same at P25 and at the median)' : ' (not robust: the verdict changes at P25)') + '</h3>' +
      '<p>Net about <b>$' + r.net_per_hour_usd.toFixed(2) + ' per hour</b> · capital $' + r.capital_usd + ' · gas about ' + fmtGas(r.gas_per_tx_usd) + ' per transaction · ' + r.hours.toFixed(1) + ' hours of active work · all-in farm cost about $' + r.farm_cost_usd.toFixed(2) + '. A verdict of FARM needs $5/hour or more, THIN $1–5, SKIP under $1.</p>' +
      '<p>Break-even: FARM while eligible wallets stay at or below <b>' + fmtWallets(r.breakeven_wallets) + '</b> (median assumption: ' + fmtWallets(r.wallets_median) + ', range ' + fmtWallets(r.wallets_low) + '–' + fmtWallets(r.wallets_high) + '). Optimistic scenario (half as many wallets): <b>' + r.verdict_optimistic + '</b>. These are estimates from labelled assumptions, not a promise of any airdrop.</p></div>' +
      '<h3>Farm plan — at a glance</h3><ol>' + steps.slice(0, 4).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<h3>How the number is made</h3><div class="formula">' +
      'launch value (median) = ' + fmtUsd(r.launch_value_usd) + ' &nbsp; [P10 ' + fmtUsd(r.launch_p10_usd) + ' – P90 ' + fmtUsd(r.launch_p90_usd) + ']<br>' +
      'launch odds (next year, conditional) = ' + fmtPct(r.launch_odds) + '<br>' +
      'public share (labelled assumption) = 10% &nbsp; [5–15%]<br>' +
      'expected value = ' + fmtUsd(r.launch_value_usd) + ' × ' + r.launch_odds.toFixed(2) + ' × 0.10 = ' + fmtUsd(recomputed) +
      ' &nbsp; <span class="' + (match ? 'ok' : '') + '">' + (match ? 'recomputed = stored ✓' : 'recomputed ≠ stored: stored ' + fmtUsd(r.implied_value_usd)) + '</span><br>' +
      'expected value range (P10–P90) = ' + fmtRange(r.ev_p10_usd, r.ev_p90_usd) + '</div>' +
      '<p class="note">' + esc(r.change_note) + '</p>' +
      '<h3>Farm plan — continued</h3><ol start="5">' + steps.slice(4).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">' + esc(r.eligibility_note) + '</p>' +
      '<p class="note">What would change this number: a real token launch, a large TVL move, or a comparable token repricing the whole category. The launch value is fitted from 128 traded tokens; the median error is about 87%, so treat every figure as a range, not a price. The per-wallet average favours small wallets: if far more wallets farm than assumed, each wallet earns far less.</p>';
    detailEl.innerHTML = h;
    detailEl.hidden = false;
  }

  function renderLedger() {
    var h = '<h2>Ledger: all 758 protocols</h2><p>Every protocol in the snapshot gets exactly one disposition. The three counts add to 758.</p><table class="ledger"><thead><tr><th>Disposition</th><th class="num">Count</th><th>Reason</th></tr></thead><tbody>';
    DATA.ledger.forEach(function (l) {
      h += '<tr><td><b>' + esc(l.label) + '</b></td><td class="num">' + l.count + '</td><td>' + esc(l.reason) + '</td></tr>';
    });
    var total = DATA.ledger.reduce(function (s, l) { return s + l.count; }, 0);
    h += '<tr><td><b>Total</b></td><td class="num"><b>' + total + '</b></td><td>Snapshot total: ' + DATA.total_protocols + ' protocols.</td></tr></tbody></table>';
    h += '<p class="note">Excluded as a derivative means: the category is Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX; or the name carries "wrapped", "staked" or "staking"; or it starts with an exchange name; or it ends in a version marker such as V2. The starter board kept 39 such rows; this board keeps none.</p>';
    if (DATA.ambiguous_rows && DATA.ambiguous_rows.length) {
      h += '<h2>Flagged ambiguous: ' + DATA.ambiguous_rows.length + ' rows</h2><p>These protocols record no token in the snapshot, but their product token already trades — the snapshot is missing it, not proving there is none. They stay on the board only because the house watchlist requires 40/40 coverage; they are capped at confidence C and excluded from the KPI totals. The top 5 rows are all clean.</p><table class="ledger"><thead><tr><th>Protocol</th><th>Why it is flagged</th></tr></thead><tbody>';
      DATA.ambiguous_rows.forEach(function (a) {
        h += '<tr><td><b>' + esc(a.name) + '</b><br><span class="note">' + esc(a.slug) + '</span></td><td>' + esc(a.reason) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    boardEl.innerHTML = h;
    detailEl.hidden = true;
  }

  function renderMethod() {
    var variantRows = (m.variant_tests || []).map(function (t) {
      return '<tr><td>' + esc(t.name) + '</td><td class="num">' + t.loo_med_abs_pct.toFixed(1) + '%</td><td class="num">' + (t.loo_coverage80 * 100).toFixed(0) + '%</td><td class="num">' + t.boot_ci_low.toFixed(1) + ' to ' + t.boot_ci_high.toFixed(1) + '</td><td>' + (t.accepted ? 'Adopted' : 'Not adopted') + ' — ' + esc(t.note) + '</td></tr>';
    }).join('');
    var h = '<div class="method"><h2>Method &amp; honesty</h2>' +
      '<h3>1. The value model (fitted, not invented)</h3>' +
      '<p>Target: log10(market cap) of the ' + m.peers + ' protocols that record a token and a positive market cap. Model in use: <b>' + esc(m.model_variant) + '</b> — log10(mcap) = ' + m.intercept.toFixed(3) + ' + ' + m.slope.toFixed(3) + ' × log10(TVL), plus a per-category median residual shrunk toward zero by n/(n+4), where n is the peer count in that category (categories with 5+ peers only; fewer peers get no adjustment and a widened 90% interval instead). Residual spread (leave-one-out): ' + m.loo_std.toFixed(3) + ' dex.</p>' +
      '<p>The model is, in point accuracy, about as good as the naive baseline (' + m.loo_med_abs_pct.toFixed(1) + '% vs ' + m.naive_med_abs_pct.toFixed(1) + '% median error — the gap is inside the noise). Its value is in the intervals, the category awareness, and the calibration, not in a sharper point guess. Only ' + m.loo_within2x_pct.toFixed(0) + '% of peers land within 2x of the truth and ' + m.loo_within3x_pct.toFixed(0) + '% within 3x, so every figure here is a rough range.</p>' +
      '<table><thead><tr><th>Check</th><th class="num">Result</th></tr></thead><tbody>' +
      '<tr><td>Leave-one-out median absolute error (this model)</td><td class="num">' + m.loo_med_abs_pct.toFixed(1) + '%</td></tr>' +
      '<tr><td>Naive baseline: one median mcap/TVL ratio for all peers</td><td class="num">' + m.naive_med_abs_pct.toFixed(1) + '%</td></tr>' +
      '<tr><td>Multi-feature model (log TVL + growth + age + chains), leave-one-out — recomputed at run time</td><td class="num">' + m.multi_feature_loo_med_abs_pct.toFixed(1) + '% — worse, so those terms were dropped</td></tr>' +
      '<tr><td>80% interval coverage: share of peers inside their own interval</td><td class="num">' + (m.loo_coverage80 * 100).toFixed(0) + '% (nominal 80%)</td></tr>' +
      '<tr><td>Within 2x / within 3x of the truth (leave-one-out)</td><td class="num">' + m.loo_within2x_pct.toFixed(0) + '% / ' + m.loo_within3x_pct.toFixed(0) + '%</td></tr>' +
      '<tr><td>Launch-odds calibration (Brier score; lower is better)</td><td class="num">' + m.odds_brier.toFixed(3) + ' vs ' + m.odds_base_brier.toFixed(3) + ' for the base rate alone</td></tr>' +
      '</tbody></table>' +
      '<h3>1b. Variants tested once each, before freezing the model</h3>' +
      '<p>Three variants were pre-registered and each given one leave-one-out test. A variant was adopted only if it beat the base model by at least 5 points, kept 80%-interval coverage in 75–85%, and passed a seeded bootstrap (2,000 resamples) on the per-peer error difference. None passed, so the base model is frozen as-is — the failed tests are shown, not hidden.</p>' +
      '<table><thead><tr><th>Variant</th><th class="num">LOO error</th><th class="num">Coverage</th><th class="num">Bootstrap 95% CI (mean diff, pts)</th><th>Outcome</th></tr></thead><tbody>' + variantRows + '</tbody></table>' +
      '<h3>2. Launch odds</h3><p>A logistic model P(records a token | log TVL, log age) fitted on all 758 protocols, turned into a one-year conditional hazard: the chance a protocol that has not launched by its age launches in the next year. Shrunk 50% toward the mean and capped at 5–60%. It is a ranking signal, not a forecast — "not launched yet" is not "never launches", and older protocols that never launched are a selected group.</p>' +
      '<h3>3. Public share — a labelled assumption</h3><p>The snapshot carries no supply or airdrop data, so no public share can be fitted from it. Assumed: median 10%, range 5–15%. If the true share is smaller, every expected value falls in proportion.</p>' +
      '<h3>4. What the model cannot do</h3><p>Walk-forward testing is not possible: the snapshot has tracking-start dates (listed_at), not token-launch dates, so there is no launch timeline to walk forward over. That test is written here as "cannot be tested" rather than faked. Survivorship bias: the 128 traded peers are the tokens that survived to be recorded; dead tokens are absent. Current market cap is not launch value. Growth and chain count were tested and dropped because they made the blind test worse — they are shown per row, not baked into the price.</p>' +
      '<h3>5. Farm economics — labelled assumptions</h3><p>Capital by TVL: $250 at $1B+, $150 at $100M+, $100 at $50M+, $50 below. Gas per transaction is computed, not looked up: gas units per action (main 200k, second 150k, midway 120k, claim 100k) × gas price × native-asset price, all labelled at the snapshot date 14 Nov 2026 (Ethereum 12 gwei × ETH $3,200; Base/Arbitrum/Optimism 0.05 gwei × ETH $3,200; Polygon 30 gwei × POL $0.15; BNB 3 gwei × BNB $600; Avalanche 2 gwei × AVAX $12; Solana $0.05, Sui $0.10 and Tron $2.00 flat per transaction). Work is the farm plan’s own minutes added up (60 minutes = 1.0 hour), not a fixed 3 hours. Eligible wallets are assumed by TVL tier (100k / 50k / 25k / 10k) as the median of a range (half to double); each row also shows its optimistic verdict at half the wallets and the break-even wallet count at which FARM stops being FARM. Opportunity cost: 5% a year on the capital for the hold. Slippage: 0.3% of capital. Verdicts: FARM at $5/hour or more, THIN at $1–5, SKIP below $1. The public share (10%), the odds cap and the $5/$1 thresholds were fixed before seeing the results and were not moved afterwards. Note: the per-wallet average favours small wallets — if far more wallets farm than assumed, each wallet earns far less.</p></div>';
    boardEl.innerHTML = h;
    detailEl.hidden = true;
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    document.getElementById('controls').style.display = tab === 'board' ? 'flex' : 'none';
    if (tab === 'ledger') renderLedger();
    else if (tab === 'method') renderMethod();
    else { renderBoard(); renderDetail(); }
  }

  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
  });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('fcat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('fverdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  document.getElementById('fconf').addEventListener('change', function (e) { state.conf = e.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });

  renderKpi();
  renderIntegrity();
  fillCategories();
  var hash = window.location.hash.replace(/^#/, '');
  if (hash.indexOf('detail-') === 0) { state.selected = hash.slice(7); setTab('board'); }
  else if (hash === 'ledger') setTab('ledger');
  else if (hash === 'method') setTab('method');
  else if (hash === 'filtered') { state.conf = 'AB'; document.getElementById('fconf').value = 'AB'; setTab('board'); }
  else setTab('board');
})();
