// Token Radar entry point (Node 22, standard library only).
// Reads the sealed snapshot, fits the model at run time, writes the ranked
// board, the dashboard data, copies dashboard/ and screenshots/, and writes
// dossier.json with the kit's vendored library. No network, no clock, no
// unseeded randomness: two runs on the same snapshot write identical bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);
const board = radar.rows.map((r) => ({
  slug: r.slug,
  name: r.name,
  rank: r.rank,
  implied_value_usd: r.implied_value_usd,
  farm_steps: r.farm_steps,
}));
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const src = join(from, e.name);
    if (e.isFile()) {
      copyFileSync(src, join(to, e.name));
      names.push(e.name);
    }
  }
  return names.sort();
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: only ${shots.length} screenshots in screenshots/, need at least 3\n`);
  process.exit(1);
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const top = radar.rows[0]!;
const boardBytes = Buffer.byteLength(`${JSON.stringify({ rows: board })}\n`, 'utf8');
process.stderr.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${radar.rows.length} rows scored\n` +
  `token radar: top ${top.slug} EV $${top.implied_value_usd}, verdicts FARM ${radar.farm_counts.FARM} / THIN ${radar.farm_counts.THIN} / SKIP ${radar.farm_counts.SKIP} (optimistic FARM ${radar.farm_counts_optimistic.FARM})\n` +
  `token radar: board.json ${boardBytes} bytes, LOO median error ${radar.metrics.loo_med_abs_pct.toFixed(1)}%, conformal 80% coverage ${radar.metrics.conformal_coverage80.toFixed(0)}% (Spearman ${radar.metrics.loo_spearman.toFixed(2)} vs naive ${radar.metrics.loo_spearman_naive.toFixed(2)}, top-quartile hit ${radar.metrics.loo_top_quartile_hit_pct.toFixed(0)}% vs naive ${radar.metrics.loo_top_quartile_hit_naive_pct.toFixed(0)}%)\n` +
  `token radar: held-out LOO-category ${radar.validation.held_out[0]!.med_abs_pct.toFixed(1)}% (naive ${radar.validation.held_out[0]!.naive_med_abs_pct.toFixed(1)}%), size-split ${radar.validation.held_out[1]!.med_abs_pct.toFixed(1)}% (naive ${radar.validation.held_out[1]!.naive_med_abs_pct.toFixed(1)}%), age-split ${radar.validation.held_out[2]!.med_abs_pct.toFixed(1)}% (naive ${radar.validation.held_out[2]!.naive_med_abs_pct.toFixed(1)}%)\n` +
  `token radar: model ${radar.metrics.model_variant}; multi-feature LOO ${radar.metrics.multi_feature_loo_med_abs_pct.toFixed(1)}%; ambiguous rows ${radar.ambiguous_rows.length}; clean total EV $${radar.total_ev_usd}\n` +
  `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
