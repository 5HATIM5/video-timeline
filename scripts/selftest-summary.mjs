// Print the latest complete self-test run per browser as a markdown table.
import { readFileSync } from 'node:fs';

const rows = readFileSync(new URL('../selftest-results.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Group per browser so concurrent runs in different browsers can't mix.
const current = new Map();
const runs = new Map();
for (const r of rows) {
  if (r.type === 'selftest-start') current.set(r.browser, []); // drop runs that were cut short
  if (r.type === 'selftest') current.set(r.browser, [...(current.get(r.browser) ?? []), r]);
  if (r.type === 'selftest-done') {
    runs.set(r.browser, current.get(r.browser) ?? []);
    current.set(r.browser, []);
  }
}

const only = process.argv[2];
for (const [browser, rs] of runs) {
  if (only && !browser.includes(only)) continue;
  console.log(`\n### ${browser}\n`);
  console.log('| file | engine | ready ms | thumbs ms | thumbs correct | click err s | drag err s | → step | preview correct | zoomed thumbs correct |');
  console.log('|---|---|--:|--:|---|--:|--:|--:|---|---|');
  for (const r of rs) {
    if (r.error) { console.log(`| ${r.sample} | ERROR: ${r.error} |||||||||`); continue; }
    if (r.mediaError) { console.log(`| ${r.sample} | mediaerror after ${r.mediaErrorMs} ms: ${r.mediaError} |||||||||`); continue; }
    console.log(`| ${r.sample} | ${r.engine} | ${r.readyMs} | ${r.firstThumbsMs} | ${r.thumbCheck} | ${r.clickSeekErr ?? ''} | ${r.dragSeekErr ?? ''} | ${r.keyStepFrames ?? ''} | ${r.previewCheck} | ${r.zoomThumbCheck} |`);
  }
}
