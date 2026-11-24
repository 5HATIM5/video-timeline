import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Dev only: demo/selftest.ts POSTs results here; they're appended to selftest-results.jsonl. */
const selftestSink: Plugin = {
  name: 'selftest-sink',
  configureServer(server) {
    server.middlewares.use('/__selftest', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        appendFileSync(here('./selftest-results.jsonl'), body.trim() + '\n');
        res.end('ok');
      });
    });
  },
};

// Dev playground: `npm run dev` serves demo/ against the library source.
export default defineConfig({
  root: here('./demo'),
  plugins: [selftestSink],
  resolve: {
    alias: [
      { find: /^video-timeline-scrubber\/react$/, replacement: here('./src/react/index.ts') },
      { find: /^video-timeline-scrubber$/, replacement: here('./src/index.ts') },
    ],
  },
  oxc: { jsx: { runtime: 'automatic' } },
  server: { port: 5180, strictPort: true },
  build: {
    outDir: here('./demo-dist'),
    emptyOutDir: true,
    rollupOptions: { input: { main: here('./demo/index.html'), react: here('./demo/react.html') } },
  },
});
