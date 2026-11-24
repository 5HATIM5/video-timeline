// Bundle-size check: what an app actually ships for each entry point (minified + gzip).
// Mediabunny is loaded lazily via import(), so it's measured as its own chunk.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const entries = [
  { name: 'video-timeline (web component + core)', entry: 'dist/index.js', external: ['mediabunny'] },
  { name: 'video-timeline/react (wrapper only)', entry: 'dist/react/index.js', external: ['mediabunny', 'react', '../element/*', '../core/*', '../engines/*'] },
  { name: 'lazy chunk: mediabunny subset', entry: 'dist/engines/mediabunny.js', external: [] },
];

for (const { name, entry, external } of entries) {
  const out = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, external, splitting: false, logLevel: 'silent' });
  const code = out.outputFiles[0].contents;
  console.log(`${name.padEnd(44)} ${(code.length / 1024).toFixed(1).padStart(6)} KB min  ${(gzipSync(code, { level: 9 }).length / 1024).toFixed(1).padStart(6)} KB gzip`);
}
