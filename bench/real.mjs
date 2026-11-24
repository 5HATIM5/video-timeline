// Real-world file check: do the engines AGREE on messy files?
// For each file we extract the same N thumbnails with every engine, then compare pairs:
//   same frame   -> barcode (frame index) identical      (skipped for rotated video)
//   same picture -> mean absolute pixel difference (MAD)  (catches rotation / colour bugs)
// and we record where each engine actually landed in time.
import { Input, ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink } from 'mediabunny';
import { readFrameIndex } from './pattern.mjs';

const SRC_FPS = 30; // barcode = frame index of the 30 fps source
const params = new URLSearchParams(location.search);
const N = Number(params.get('n') ?? 24);
const FIXTURES = (params.get('fixtures') ??
  'h264-bframes.mp4,iphone-hevc.mov,iphone-hevc-hdr10bit.mov,portrait-rot90.mp4,vfr.mp4,copycut-editlist.mp4,vp9.webm,av1.mp4,obs.mkv,screenrec-gop20s.mp4').split(',');
const BROWSER = detectBrowser();
const out = document.getElementById('out');
const status = (s) => { document.getElementById('status').textContent = s; document.title = s; };
const PAIRS = [['video exact', 'mb exact'], ['video→keyframe', 'mb keyframe'], ['fastSeek', 'mb keyframe']];

window.__real = { state: 'running' };
run().catch((e) => post({ type: 'real-error', browser: BROWSER, error: String(e?.stack ?? e) }));

async function run() {
  for (const name of FIXTURES) {
    status(`${name}`);
    const blob = await (await fetch(`./fixtures/real/${name}`)).blob();
    const info = { mb: await probeMediabunny(blob), video: await probeVideo(blob) };
    const duration = info.mb.duration ?? info.video.duration;
    const [dw, dh] = info.mb.displayW ? [info.mb.displayW, info.mb.displayH] : [info.video.w, info.video.h];
    const TW = dw >= dh ? 160 : Math.round((160 * dw) / dh);
    const TH = dw >= dh ? Math.round((160 * dh) / dw) : 160;
    const ts = Array.from({ length: N }, (_, i) => ((i + 0.5) * duration) / N);

    const engines = {};
    for (const [label, fn] of Object.entries(ENGINES)) {
      status(`${name}: ${label}`);
      const t0 = performance.now();
      try {
        const thumbs = await withTimeout(fn(blob, ts, TW, TH), 120_000, 'timeout');
        engines[label] = { ok: true, ms: Math.round(performance.now() - t0), thumbs };
      } catch (e) {
        engines[label] = { ok: false, error: String(e?.message ?? e).slice(0, 160) };
      }
    }

    const rotated = (info.mb.rotation ?? 0) !== 0;
    const comparisons = PAIRS.map(([a, b]) => compare(engines[a], engines[b], a, b, rotated));
    const offsets = Object.fromEntries(Object.entries(engines).filter(([, e]) => e.ok && !rotated).map(([k, e]) => [k, offsetRange(e.thumbs, ts)]));

    const row = {
      type: 'real', browser: BROWSER, fixture: name, info,
      engines: Object.fromEntries(Object.entries(engines).map(([k, e]) => [k, e.ok ? { ms: e.ms, msPerThumb: Math.round(e.ms / N) } : { error: e.error }])),
      comparisons, offsets,
    };
    await post(row);
    render(name, info, engines, comparisons, offsets, TW, TH);
  }
  status('REAL DONE');
  window.__real.state = 'done';
  await post({ type: 'real-done', browser: BROWSER, ua: navigator.userAgent });
}

// ---------------------------------------------------------------- probes

async function probeMediabunny(blob) {
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const format = (await input.getFormat()).name;
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { format, error: 'no video track' };
    const r = {
      format, codec: track.codec, codecString: await track.getCodecParameterString(),
      displayW: await track.getDisplayWidth(), displayH: await track.getDisplayHeight(),
      rotation: await track.getRotation(), firstTimestamp: round3(await track.getFirstTimestamp()),
      duration: round3(await input.computeDuration()), canDecode: await track.canDecode(),
    };
    const fr = await track.computeFrameRateMetrics();
    r.fps = { best: round3(fr.bestGuessFrameRate), min: round3(fr.minFrameRate), max: round3(fr.maxFrameRate) };
    input.dispose();
    return r;
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 160) };
  }
}

async function probeVideo(blob) {
  try {
    const v = await openVideo(blob);
    const r = { w: v.videoWidth, h: v.videoHeight, duration: round3(v.duration), canFastSeek: typeof v.fastSeek === 'function' };
    closeVideo(v);
    return r;
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 160) };
  }
}

// ---------------------------------------------------------------- engines

const ENGINES = {
  async 'video exact'(blob, ts, TW, TH) {
    const v = await openVideo(blob);
    try {
      const res = [];
      for (const t of ts) { await seek(v, () => { v.currentTime = t; }); res.push(grabVideo(v, TW, TH)); }
      return res;
    } finally { closeVideo(v); }
  },
  async 'mb exact'(blob, ts, TW, TH) {
    return mbGrab(blob, async () => ts, TW, TH);
  },
  async 'video→keyframe'(blob, ts, TW, TH) {
    const keys = await keyframeTimes(blob, ts);
    const v = await openVideo(blob);
    try {
      const res = [];
      for (const k of keys) { await seek(v, () => { v.currentTime = k + 0.001; }); res.push(grabVideo(v, TW, TH)); }
      return res;
    } finally { closeVideo(v); }
  },
  async 'mb keyframe'(blob, ts, TW, TH) {
    return mbGrab(blob, () => keyframeTimes(blob, ts), TW, TH);
  },
  async fastSeek(blob, ts, TW, TH) {
    const v = await openVideo(blob);
    try {
      if (typeof v.fastSeek !== 'function') throw new Error('not supported');
      const res = [];
      for (const t of ts) { await seek(v, () => v.fastSeek(t)); res.push(grabVideo(v, TW, TH)); }
      return res;
    } finally { closeVideo(v); }
  },
};

async function mbGrab(blob, getTimes, TW, TH) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    const times = await getTimes();
    const sink = new CanvasSink(track, { width: TW, height: TH, fit: 'cover' });
    const res = [];
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (!wc) { res.push(null); continue; }
      const { canvas, ctx } = makeCanvas(TW, TH);
      ctx.drawImage(wc.canvas, 0, 0, TW, TH);
      res.push(snapshot(canvas, ctx, wc.timestamp));
    }
    return res;
  } finally { input.dispose(); }
}

async function keyframeTimes(blob, ts) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    const sink = new EncodedPacketSink(track);
    const out = [];
    for (const t of ts) out.push((await sink.getKeyPacket(t, { metadataOnly: true }))?.timestamp ?? 0);
    return out;
  } finally { input.dispose(); }
}

function grabVideo(v, TW, TH) {
  const { canvas, ctx } = makeCanvas(TW, TH);
  const s = Math.max(TW / v.videoWidth, TH / v.videoHeight);
  const w = v.videoWidth * s, h = v.videoHeight * s;
  ctx.drawImage(v, (TW - w) / 2, (TH - h) / 2, w, h);
  return snapshot(canvas, ctx, v.currentTime);
}

function snapshot(canvas, ctx, landed) {
  return { canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height), barcode: readFrameIndex(ctx, canvas.width, canvas.height), landed };
}

// ---------------------------------------------------------------- comparisons

function compare(A, B, a, b, rotated) {
  const base = { pair: `${a} ↔ ${b}` };
  if (!A?.ok || !B?.ok) return { ...base, skipped: `${!A?.ok ? a : b} failed` };
  let sameFrame = 0, mads = [], diffs = new Set(), timeDiffs = [];
  for (let i = 0; i < N; i++) {
    const x = A.thumbs[i], y = B.thumbs[i];
    if (!x || !y) continue;
    if (!rotated) { if (x.barcode === y.barcode) sameFrame++; else diffs.add(x.barcode - y.barcode); }
    mads.push(mad(x.data, y.data));
    timeDiffs.push(Math.abs(x.landed - y.landed));
  }
  mads.sort((p, q) => p - q);
  return {
    ...base,
    sameFrame: rotated ? null : `${sameFrame}/${N}`,
    frameDiffs: [...diffs].sort((p, q) => p - q).slice(0, 8),
    madMedian: round1(mads[Math.floor(mads.length / 2)]),
    madMax: round1(mads[mads.length - 1]),
    maxLandedDiffMs: Math.round(Math.max(...timeDiffs) * 1000),
  };
}

function mad(p, q) {
  if (p.width !== q.width || p.height !== q.height) return 255;
  let s = 0;
  for (let i = 0; i < p.data.length; i += 4) s += Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]);
  return s / ((p.data.length / 4) * 3);
}

// barcode (source frame index) minus the frame we'd expect at the requested time
function offsetRange(thumbs, ts) {
  const offs = thumbs.map((x, i) => (x ? x.barcode - Math.floor(ts[i] * SRC_FPS + 1e-6) : null)).filter((x) => x != null);
  return [Math.min(...offs), Math.max(...offs)];
}

// ---------------------------------------------------------------- helpers

async function openVideo(blob) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
  document.body.append(v);
  v.src = URL.createObjectURL(blob);
  try { await once(v, 'loadeddata', 8000); } catch (e) { closeVideo(v); throw e; }
  return v;
}
function closeVideo(v) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); v.remove(); }
function seek(v, doSeek) { const p = once(v, 'seeked', 8000); doSeek(); return p; }
function once(target, event, ms) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`${event} timeout`)), ms);
    target.addEventListener(event, () => { clearTimeout(to); resolve(); }, { once: true });
    target.addEventListener('error', () => { clearTimeout(to); reject(new Error(`media error ${target.error?.code}: ${target.error?.message || 'unsupported'}`)); }, { once: true });
  });
}
function makeCanvas(w, h) { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) }; }
function withTimeout(p, ms, msg) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]); }
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
async function post(o) { try { await fetch('/results', { method: 'POST', body: JSON.stringify(o) }); } catch {} }
function detectBrowser() {
  const ua = navigator.userAgent;
  if (/Claude\//.test(ua)) return 'chromium(electron)';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua)) return 'safari';
  return 'unknown';
}

// ---------------------------------------------------------------- rendering

function render(name, info, engines, comparisons, offsets, TW, TH) {
  const h = document.createElement('h2'); h.textContent = name; out.append(h);
  const i = document.createElement('div'); i.className = 'info';
  const m = info.mb;
  i.textContent = m.error ? `Mediabunny: ${m.error}` :
    `${m.format} · ${m.codecString} · ${m.displayW}×${m.displayH} rot ${m.rotation} · first ts ${m.firstTimestamp}s · dur ${m.duration}s · fps ${m.fps.best} (${m.fps.min}–${m.fps.max}) · canDecode ${m.canDecode}` +
    ` | <video>: ${info.video.error ?? `${info.video.w}×${info.video.h}, dur ${info.video.duration}s`}`;
  out.append(i);

  const t1 = document.createElement('table');
  t1.innerHTML = '<tr><th>engine</th><th>status</th><th>ms total</th><th>ms/thumb</th><th>frame offset vs request</th></tr>' +
    Object.entries(engines).map(([k, e]) => `<tr><td>${k}</td><td class="${e.ok ? 'ok' : 'bad'}">${e.ok ? 'ok' : e.error}</td><td>${e.ms ?? ''}</td><td>${e.ok ? Math.round(e.ms / N) : ''}</td><td>${offsets[k] ? offsets[k].join(' … ') : ''}</td></tr>`).join('');
  out.append(t1);

  const t2 = document.createElement('table');
  t2.innerHTML = '<tr><th>pair</th><th>same frame</th><th>frame diffs</th><th>pixel MAD median</th><th>MAD max</th><th>max landed Δ ms</th></tr>' +
    comparisons.map((c) => c.skipped ? `<tr><td>${c.pair}</td><td class="warn" colspan="5">skipped: ${c.skipped}</td></tr>` :
      `<tr><td>${c.pair}</td><td class="${c.sameFrame == null ? '' : c.sameFrame.startsWith(N + '/') ? 'ok' : 'bad'}">${c.sameFrame ?? 'n/a (rotated)'}</td><td>${c.frameDiffs.join(', ')}</td><td class="${c.madMedian < 8 ? 'ok' : 'bad'}">${c.madMedian}</td><td>${c.madMax}</td><td>${c.maxLandedDiffMs}</td></tr>`).join('');
  out.append(t2);

  for (const [k, e] of Object.entries(engines)) {
    if (!e.ok) continue;
    const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = k; out.append(lbl);
    const strip = document.createElement('div'); strip.className = 'strip';
    e.thumbs.slice(0, 12).forEach((x) => { if (x) strip.append(x.canvas); });
    out.append(strip);
  }
}
