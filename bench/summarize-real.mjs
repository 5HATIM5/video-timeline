// Summarise the real-file runs (latest row per browser + fixture wins).
import { readFileSync } from 'node:fs';

const rows = readFileSync(new URL('./results/results.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'real' || r.type === 'real-error');
const only = process.argv[2];
const latest = new Map();
for (const r of rows) latest.set(`${r.browser}|${r.fixture}`, r);

const browsers = [...new Set([...latest.values()].map((r) => r.browser))].filter((b) => !only || b.includes(only));
const ENG = ['video exact', 'mb exact', 'video→keyframe', 'mb keyframe', 'fastSeek'];
for (const b of browsers) {
  console.log(`\n### ${b}\n`);
  console.log(`| file | probe | ${ENG.map((e) => `${e} ms/thumb`).join(' | ')} | exact pair: same frame · MAD | keyframe pair: same frame · MAD |`);
  console.log(`|---|---|${ENG.map(() => '--:').join('|')}|---|---|`);
  for (const r of [...latest.values()].filter((x) => x.browser === b)) {
    if (r.type === 'real-error') { console.log(`| ERROR | ${r.error} |`); continue; }
    const m = r.info.mb;
    const probe = m.error ? `mb: ${m.error}` : `${m.codec} ${m.displayW}×${m.displayH}${m.rotation ? ` rot${m.rotation}` : ''}, fps ${m.fps.min}–${m.fps.max}` + (r.info.video.error ? `; <video>: ${r.info.video.error}` : '');
    const cells = ENG.map((e) => { const x = r.engines[e]; return !x ? '' : x.error ? `✗ ${x.error.slice(0, 40)}` : x.msPerThumb; });
    const pair = (c) => c.skipped ? `skipped (${c.skipped})` : `${c.sameFrame ?? 'rotated'} · ${c.madMedian}/${c.madMax}${c.frameDiffs?.length ? ` · diffs ${c.frameDiffs.join(',')}` : ''}`;
    console.log(`| ${r.fixture} | ${probe} | ${cells.join(' | ')} | ${pair(r.comparisons[0])} | ${pair(r.comparisons[1])} |`);
  }
  console.log('\nframe offset vs requested time (barcode − floor(t·30)), per engine:');
  for (const r of [...latest.values()].filter((x) => x.browser === b && x.offsets)) {
    console.log(`  ${r.fixture.padEnd(26)} ${Object.entries(r.offsets).map(([k, v]) => `${k}: ${v[0]}…${v[1]}`).join('  ')}`);
  }
}
