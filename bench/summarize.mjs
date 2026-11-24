// Turn results/results.jsonl into markdown tables (latest run per browser wins).
import { readFileSync } from 'node:fs';

const file = new URL('./results/results.jsonl', import.meta.url);
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Keep only rows from the last complete run of each browser
const byBrowser = new Map();
let current = [];
for (const r of rows) {
  if (r.type === 'bench' || r.type === 'scrub' || r.type === 'bench-error') current.push(r);
  if (r.type === 'bench-done') { byBrowser.set(r.browser, current.filter((x) => x.browser === r.browser || !x.browser)); current = []; }
}

for (const [browser, rs] of byBrowser) {
  console.log(`\n### ${browser}\n`);
  console.log('| fixture | engine | n | probe ms | first thumb ms | total ms | ms/thumb | max UI stall ms | frame-exact | notes |');
  console.log('|---|---|--:|--:|--:|--:|--:|--:|--:|---|');
  for (const r of rs.filter((x) => x.type === 'bench')) {
    if (r.error) { console.log(`| ${r.fixture} | ${r.engine} | ${r.n} | ERROR: ${r.error} |||||||`); continue; }
    console.log(`| ${r.fixture} | ${r.engine} | ${r.n} | ${r.probeMs} | ${r.firstMs} | ${r.totalMs} | ${r.perThumbMs} | ${r.jankMaxMs} | ${r.exact}/${r.n} | ${notes(r.extra)} |`);
  }
  console.log('\n| fixture | scrub engine | mode | avg ms | p50 | p95 | max | frame-exact |');
  console.log('|---|---|---|--:|--:|--:|--:|--:|');
  for (const r of rs.filter((x) => x.type === 'scrub')) {
    if (r.error) { console.log(`| ${r.fixture} | ${r.engine} | ${r.mode} | ERROR: ${r.error} |||||`); continue; }
    console.log(`| ${r.fixture} | ${r.engine} | ${r.mode} | ${r.avg} | ${r.p50} | ${r.p95} | ${r.max} | ${r.exact}/${r.total} |`);
  }
}

function notes(x) {
  if (!x) return '';
  const parts = [];
  if (x.maxSnapSec != null) parts.push(`max snap ${x.maxSnapSec}s`);
  if (x.uniqueKeyframes != null) parts.push(`${x.uniqueKeyframes} unique keyframes`);
  if (x.lookupMs != null) parts.push(`keyframe lookup ${x.lookupMs}ms`);
  if (x.frameRate) parts.push(`fps ${x.frameRate.best} (computed in ${x.frameRate.ms}ms)`);
  return parts.join(', ');
}
