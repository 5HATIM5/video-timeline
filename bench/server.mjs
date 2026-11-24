// Tiny zero-dependency dev server for the extraction spike.
// - Serves static files (with HTTP Range support, which Safari needs for <video>)
// - POST /save/<name>   -> writes the request body to fixtures/<name>
// - POST /results       -> appends one JSON line to results/results.jsonl
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5174);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.css': 'text/css',
};

mkdirSync(join(ROOT, 'fixtures'), { recursive: true });
mkdirSync(join(ROOT, 'results'), { recursive: true });

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname.startsWith('/save/')) {
    const name = url.pathname.slice('/save/'.length);
    if (!/^[\w.-]+$/.test(name)) return send(res, 400, 'bad name');
    const out = createWriteStream(join(ROOT, 'fixtures', name));
    req.pipe(out);
    out.on('finish', () => send(res, 200, 'ok'));
    out.on('error', (e) => send(res, 500, String(e)));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/results') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      appendFileSync(join(ROOT, 'results', 'results.jsonl'), body.trim() + '\n');
      send(res, 200, 'ok');
    });
    return;
  }

  // Static files
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '') || 'index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');
  let stat;
  try {
    stat = statSync(file);
    if (stat.isDirectory()) return send(res, 404, 'not found');
  } catch {
    return send(res, 404, 'not found');
  }

  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    createReadStream(file).pipe(res);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`spike server on http://127.0.0.1:${PORT}`));

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain' });
  res.end(text);
}
