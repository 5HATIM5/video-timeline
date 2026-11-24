// Spike benchmark: three ways to build a filmstrip, measured on the same files.
//   video      hidden <video> + seek + drawImage (universal fallback)
//   mb-main    Mediabunny CanvasSink on the main thread (WebCodecs)
//   mb-worker  Mediabunny CanvasSink inside a Web Worker (proposed architecture)
// Plus scrub latency: how long until the requested frame is available after a click/drag.
import { Input, ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink } from 'mediabunny';
import { readFrameIndex } from './pattern.mjs';

const FPS = 30;
const TW = 160, TH = 90;
const params = new URLSearchParams(location.search);
const FIXTURES = (params.get('fixtures') ?? 'fhd-10min-kf2.mp4,fhd-10min-kf10.mp4,uhd-3min-kf2.mp4').split(',');
const COUNTS = (params.get('n') ?? '12,100').split(',').map(Number);
const ENGINES = (params.get('engines') ?? 'video,video-fastSeek,mb-main,mb-worker,mb-keyframe').split(',');
const BROWSER = detectBrowser();
const out = document.getElementById('out');
const statusEl = document.getElementById('status');
const status = (s) => { statusEl.textContent = s; document.title = s; };

window.__bench = { state: 'running', rows: [] };
run().catch((e) => report({ type: 'bench-error', error: String(e?.stack ?? e) }));

async function run() {
  for (const fixture of FIXTURES) {
    status(`${fixture}: loading`);
    const res = await fetch(`./fixtures/${fixture}`);
    if (!res.ok) { await report({ type: 'bench-error', fixture, error: `HTTP ${res.status}` }); continue; }
    const blob = await res.blob();
    section(`${fixture} — ${(blob.size / 1e6).toFixed(0)} MB`);
    const table = makeTable(['engine', 'n', 'probe ms', 'first thumb ms', 'total ms', 'ms/thumb', 'max UI stall ms', 'frame-exact', 'max off (frames)']);

    for (const n of COUNTS) {
      for (const engine of ENGINES) {
        status(`${fixture}: ${engine} n=${n}`);
        let r;
        try {
          r = await withTimeout(ENGINE_FNS[engine](blob, n), 180_000, `${engine} timed out`);
        } catch (e) {
          await report({ type: 'bench', browser: BROWSER, fixture, engine, n, error: String(e?.message ?? e) });
          addRow(table, [engine, n, 'ERROR', String(e?.message ?? e).slice(0, 80)]);
          continue;
        }
        const exact = r.thumbs.filter((x) => x.got === x.expected).length;
        const maxOff = Math.max(...r.thumbs.map((x) => Math.abs(x.got - x.expected)));
        const row = {
          type: 'bench', browser: BROWSER, fixture, engine, n,
          probeMs: round(r.probeMs), firstMs: round(r.firstMs), totalMs: round(r.totalMs),
          perThumbMs: round(r.totalMs / n), jankMaxMs: r.jankMaxMs,
          exact, maxOff, sampleOffs: r.thumbs.slice(0, 12).map((x) => x.got - x.expected),
          extra: r.extra,
        };
        await report(row);
        addRow(table, [engine, n, row.probeMs, row.firstMs, row.totalMs, row.perThumbMs, row.jankMaxMs,
          `<span class="${exact === n ? 'ok' : 'bad'}">${exact}/${n}</span>`, maxOff]);
        if (n === COUNTS[0]) addStrip(engine, r.thumbs);
        r.thumbs.forEach((x) => x.bitmap?.close?.());
      }
    }

    if (params.get('scrub') === '0') continue;
    status(`${fixture}: scrub latency`);
    const st = makeTable(['scrub test', 'mode', 'avg ms', 'p50', 'p95', 'max', 'frame-exact']);
    for (const [name, fn] of Object.entries(SCRUB_FNS)) {
      for (const mode of ['random', 'drag']) {
        try {
          const r = await withTimeout(fn(blob, mode), 180_000, `${name} timed out`);
          if (!r) continue;
          const s = stats(r.lat);
          await report({ type: 'scrub', browser: BROWSER, fixture, engine: name, mode, ...s, exact: r.exact, total: r.lat.length });
          addRow(st, [name, mode, s.avg, s.p50, s.p95, s.max, `${r.exact}/${r.lat.length}`]);
        } catch (e) {
          await report({ type: 'scrub', browser: BROWSER, fixture, engine: name, mode, error: String(e?.message ?? e) });
          addRow(st, [name, mode, 'ERROR', String(e?.message ?? e).slice(0, 80)]);
        }
      }
    }
  }
  status('BENCH DONE');
  window.__bench.state = 'done';
  await report({ type: 'bench-done', browser: BROWSER, ua: navigator.userAgent });
}

// ---------------------------------------------------------------- engines

const ENGINE_FNS = {
  async video(blob, n) {
    const v = await openVideo(blob);
    const probeMs = v.__probeMs;
    const ts = slotTimes(v.duration, n);
    const { canvas, ctx } = readCanvas(TW, TH);
    const thumbs = [];
    const stopJank = jankMonitor();
    const t1 = performance.now();
    let firstMs = null;
    for (const t of ts) {
      await seekTo(v, t);
      ctx.drawImage(v, 0, 0, TW, TH);
      const got = readFrameIndex(ctx, TW, TH);
      thumbs.push({ t, expected: Math.floor(t * FPS), got, bitmap: thumbs.length < COUNTS[0] ? await createImageBitmap(canvas) : null });
      firstMs ??= performance.now() - t1;
    }
    const totalMs = performance.now() - t1;
    const jankMaxMs = stopJank();
    closeVideo(v);
    return { probeMs, firstMs, totalMs, jankMaxMs, thumbs };
  },

  async 'mb-main'(blob, n) {
    const t0 = performance.now();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    const canDecode = await track.canDecode();
    const probeMs = performance.now() - t0;

    const tf = performance.now();
    const fr = n === COUNTS[0] ? await track.computeFrameRateMetrics() : null;
    const frameRateMs = performance.now() - tf;

    const sink = new CanvasSink(track, { width: TW, height: TH, fit: 'cover' });
    const { canvas, ctx } = readCanvas(TW, TH);
    const ts = slotTimes(duration, n);
    const thumbs = [];
    const stopJank = jankMonitor();
    const t1 = performance.now();
    let firstMs = null;
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(ts)) {
      const t = ts[i++];
      let got = -1;
      if (wc) { ctx.drawImage(wc.canvas, 0, 0, TW, TH); got = readFrameIndex(ctx, TW, TH); }
      thumbs.push({ t, expected: Math.floor(t * FPS), got, bitmap: thumbs.length < COUNTS[0] ? await createImageBitmap(canvas) : null });
      firstMs ??= performance.now() - t1;
    }
    const totalMs = performance.now() - t1;
    const jankMaxMs = stopJank();
    input.dispose();
    return {
      probeMs, firstMs, totalMs, jankMaxMs, thumbs,
      extra: { canDecode, codec: track.codec, width: await track.getDisplayWidth?.(), frameRate: fr && { ms: round(frameRateMs), best: fr.bestGuessFrameRate, min: round(fr.minFrameRate), max: round(fr.maxFrameRate) } },
    };
  },

  // Same as `video`, but fastSeek() (Safari/Firefox) which snaps to a nearby keyframe
  async 'video-fastSeek'(blob, n) {
    const v = await openVideo(blob);
    if (typeof v.fastSeek !== 'function') { closeVideo(v); throw new Error('fastSeek unsupported'); }
    const probeMs = v.__probeMs;
    const ts = slotTimes(v.duration, n);
    const { canvas, ctx } = readCanvas(TW, TH);
    const thumbs = [];
    const stopJank = jankMonitor();
    const t1 = performance.now();
    let firstMs = null;
    for (const t of ts) {
      const p = once(v, 'seeked');
      v.fastSeek(t);
      await p;
      ctx.drawImage(v, 0, 0, TW, TH);
      const got = readFrameIndex(ctx, TW, TH);
      // "expected" here is whatever frame the browser says it landed on
      const landed = Math.floor(v.currentTime * FPS + 1e-3);
      thumbs.push({ t, expected: landed, got, snapSec: Math.abs(t - v.currentTime), bitmap: thumbs.length < COUNTS[0] ? await createImageBitmap(canvas) : null });
      firstMs ??= performance.now() - t1;
    }
    const totalMs = performance.now() - t1;
    const jankMaxMs = stopJank();
    closeVideo(v);
    return { probeMs, firstMs, totalMs, jankMaxMs, thumbs, extra: { maxSnapSec: round(Math.max(...thumbs.map((x) => x.snapSec))) } };
  },

  // Filmstrip trick: snap each slot to the keyframe at/before it, so every thumbnail
  // decodes exactly ONE frame instead of keyframe..target.
  async 'mb-keyframe'(blob, n) {
    const t0 = performance.now();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    const probeMs = performance.now() - t0;

    const packets = new EncodedPacketSink(track);
    const sink = new CanvasSink(track, { width: TW, height: TH, fit: 'cover' });
    const { canvas, ctx } = readCanvas(TW, TH);
    const ts = slotTimes(duration, n);
    const thumbs = [];
    const stopJank = jankMonitor();
    const t1 = performance.now();
    const keyTs = [];
    for (const t of ts) keyTs.push((await packets.getKeyPacket(t, { metadataOnly: true }))?.timestamp ?? 0);
    const lookupMs = performance.now() - t1;
    let firstMs = null;
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(keyTs)) {
      const k = keyTs[i], t = ts[i++];
      let got = -1;
      if (wc) { ctx.drawImage(wc.canvas, 0, 0, TW, TH); got = readFrameIndex(ctx, TW, TH); }
      thumbs.push({ t, expected: Math.round(k * FPS), got, snapSec: t - k, bitmap: thumbs.length < COUNTS[0] ? await createImageBitmap(canvas) : null });
      firstMs ??= performance.now() - t1;
    }
    const totalMs = performance.now() - t1;
    const jankMaxMs = stopJank();
    input.dispose();
    return {
      probeMs, firstMs, totalMs, jankMaxMs, thumbs,
      extra: { lookupMs: round(lookupMs), uniqueKeyframes: new Set(keyTs).size, maxSnapSec: round(Math.max(...thumbs.map((x) => x.snapSec))) },
    };
  },

  // Hybrid: Mediabunny only reads the keyframe index (metadata, no decoding),
  // the browser's own <video> decodes, seeking exactly onto keyframes.
  async 'video-keyframe'(blob, n) {
    const t0 = performance.now();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    const packets = new EncodedPacketSink(track);
    const v = await openVideo(blob);
    const probeMs = performance.now() - t0;

    const ts = slotTimes(duration, n);
    const { canvas, ctx } = readCanvas(TW, TH);
    const thumbs = [];
    const stopJank = jankMonitor();
    const t1 = performance.now();
    const keyTs = [];
    for (const t of ts) keyTs.push((await packets.getKeyPacket(t, { metadataOnly: true }))?.timestamp ?? 0);
    let firstMs = null, prevK = null, got = -1;
    for (let i = 0; i < ts.length; i++) {
      const k = keyTs[i];
      if (k !== prevK) {
        await seekTo(v, k + 0.25 / FPS); // a hair past the keyframe so rounding can't land on the previous frame
        ctx.drawImage(v, 0, 0, TW, TH);
        got = readFrameIndex(ctx, TW, TH);
        prevK = k;
      }
      thumbs.push({ t: ts[i], expected: Math.round(k * FPS), got, snapSec: ts[i] - k, bitmap: thumbs.length < COUNTS[0] ? await createImageBitmap(canvas) : null });
      firstMs ??= performance.now() - t1;
    }
    const totalMs = performance.now() - t1;
    const jankMaxMs = stopJank();
    closeVideo(v);
    input.dispose();
    return { probeMs, firstMs, totalMs, jankMaxMs, thumbs, extra: { uniqueKeyframes: new Set(keyTs).size, maxSnapSec: round(Math.max(...thumbs.map((x) => x.snapSec))) } };
  },

  async 'mb-worker'(blob, n) {
    const t0 = performance.now();
    const worker = new Worker('./bench-worker.mjs', { type: 'module' });
    const thumbs = [];
    let probeMs = null, firstMs = null, t1 = null;
    const stopJank = jankMonitor();
    await new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
      worker.onmessage = ({ data }) => {
        if (data.type === 'probe') { probeMs = performance.now() - t0; t1 = performance.now(); }
        else if (data.type === 'thumb') {
          thumbs.push(data);
          if (thumbs.length > COUNTS[0]) { data.bitmap?.close(); data.bitmap = null; }
          firstMs ??= performance.now() - t1;
        } else if (data.type === 'done') resolve();
        else if (data.type === 'error') reject(new Error(data.error));
      };
      worker.postMessage({ blob, n, TW, TH, FPS });
    });
    const totalMs = performance.now() - t1;
    const jankMaxMs = stopJank();
    worker.terminate();
    return { probeMs, firstMs, totalMs, jankMaxMs, thumbs };
  },
};

// ---------------------------------------------------------------- scrub latency

const SCRUB_STEPS = 30;

const SCRUB_FNS = {
  // Click-to-seek / drag on the real <video>: time from setting currentTime to 'seeked'
  async 'video.currentTime'(blob, mode) {
    const v = await openVideo(blob);
    const r = await scrubVideo(v, mode, (t) => { v.currentTime = t; });
    closeVideo(v);
    return r;
  },
  async 'video.fastSeek'(blob, mode) {
    const v = await openVideo(blob);
    if (typeof v.fastSeek !== 'function') { closeVideo(v); return null; }
    const r = await scrubVideo(v, mode, (t) => v.fastSeek(t));
    closeVideo(v);
    return r;
  },
  // Preview-frame decode (hover preview / scrub preview) at 640x360
  async 'mb.getCanvas 640'(blob, mode) {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    const sink = new CanvasSink(track, { width: 640, height: 360, fit: 'cover' });
    const { ctx } = readCanvas(640, 360);
    const lat = []; let exact = 0;
    for (const t of scrubTimes(duration, mode)) {
      const s = performance.now();
      const wc = await sink.getCanvas(t);
      lat.push(performance.now() - s);
      if (wc) { ctx.drawImage(wc.canvas, 0, 0); if (readFrameIndex(ctx, 640, 360) === Math.floor(t * FPS)) exact++; }
    }
    input.dispose();
    return { lat, exact };
  },
};

async function scrubVideo(v, mode, seek) {
  const { ctx } = readCanvas(TW, TH);
  const lat = []; let exact = 0;
  for (const t of scrubTimes(v.duration, mode)) {
    const s = performance.now();
    const done = once(v, 'seeked');
    seek(t);
    await done;
    lat.push(performance.now() - s);
    ctx.drawImage(v, 0, 0, TW, TH);
    if (readFrameIndex(ctx, TW, TH) === Math.floor(t * FPS)) exact++;
  }
  return { lat, exact };
}

function scrubTimes(duration, mode) {
  if (mode === 'drag') {
    // Dragging the playhead across a ~1200px timeline: ~5s jumps per pointermove on a 10-min clip
    const step = duration / 120;
    return Array.from({ length: SCRUB_STEPS }, (_, i) => duration * 0.2 + i * step + 0.5 / FPS);
  }
  const rand = mulberry32(42);
  return Array.from({ length: SCRUB_STEPS }, () => Math.floor(rand() * (duration - 1) * FPS) / FPS + 0.5 / FPS);
}

// ---------------------------------------------------------------- helpers

async function openVideo(blob) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
  document.body.append(v);
  const t0 = performance.now();
  v.src = URL.createObjectURL(blob);
  await once(v, 'loadeddata');
  v.__probeMs = performance.now() - t0;
  return v;
}
function closeVideo(v) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); v.remove(); }

function seekTo(v, t) { const p = once(v, 'seeked'); v.currentTime = t; return p; }

function once(target, event, ms = 15000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`${event} timeout`)), ms);
    target.addEventListener(event, () => { clearTimeout(to); resolve(); }, { once: true });
    target.addEventListener('error', () => { clearTimeout(to); reject(new Error(`media error ${target.error?.code}: ${target.error?.message}`)); }, { once: true });
  });
}

function slotTimes(duration, n) {
  // Centre of each thumbnail slot, nudged half a frame so the expected frame is unambiguous
  return Array.from({ length: n }, (_, i) => ((i + 0.5) * duration) / n + 0.5 / FPS);
}

function readCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

function jankMonitor() {
  let last = performance.now(), max = 0, on = true;
  const loop = (now) => { max = Math.max(max, now - last); last = now; if (on) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return () => { on = false; return Math.round(Math.max(max, performance.now() - last)); };
}

function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  return { avg: round(s.reduce((a, b) => a + b, 0) / s.length), p50: q(0.5), p95: q(0.95), max: round(s[s.length - 1]) };
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const round = (x) => (x == null ? null : Math.round(x * 10) / 10);

function detectBrowser() {
  const ua = navigator.userAgent;
  if (/Claude\//.test(ua)) return 'chromium(electron)';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua)) return 'safari';
  return 'unknown';
}

async function report(obj) {
  window.__bench.rows.push(obj);
  try { await fetch('/results', { method: 'POST', body: JSON.stringify(obj) }); } catch {}
}

// ---------------------------------------------------------------- rendering

function section(title) { const h = document.createElement('h2'); h.textContent = title; out.append(h); }
function makeTable(cols) {
  const t = document.createElement('table');
  t.innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  out.append(t);
  return t;
}
function addRow(t, cells) { const tr = document.createElement('tr'); tr.innerHTML = cells.map((c) => `<td>${c ?? ''}</td>`).join(''); t.append(tr); }
function addStrip(engine, thumbs) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div style="color:#aaa">${engine} filmstrip (label = got/expected frame)</div>`;
  const strip = document.createElement('div');
  strip.className = 'strip';
  for (const th of thumbs.filter((x) => x.bitmap)) {
    const f = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = TW; c.height = TH;
    c.getContext('2d').drawImage(th.bitmap, 0, 0);
    const cap = document.createElement('figcaption');
    cap.className = th.got === th.expected ? 'ok' : 'bad';
    cap.textContent = `${th.got}/${th.expected}`;
    f.append(c, cap);
    strip.append(f);
  }
  wrap.append(strip);
  out.append(wrap);
}
