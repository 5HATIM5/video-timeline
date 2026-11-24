// Automated end-to-end check of the real component, for browsers we can't click in (Safari).
// Open /?selftest=1 (optionally &only=label,label). Results are POSTed to the dev server and
// appended to selftest-results.jsonl.
import type { VideoTimelineElement } from 'video-timeline-scrubber';
import { SAMPLES, sampleFile } from './samples.js';

type Internals = {
  cache: { entries: Map<string, { sizeKey: string; ms: number; frame: ImageBitmap }> };
  thumbGeometry(): { sizeKey: string };
  previewGeometry(): { sizeKey: string };
  thumbnailer: { info: { fps: number | null; keyframeIndex: boolean } } | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSelftest(timeline: VideoTimelineElement, video: HTMLVideoElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const only = params.get('only')?.split(',');
  const browser = detectBrowser();
  const status = (s: string) => (document.title = s);
  const internals = timeline as unknown as Internals;
  const track = timeline.shadowRoot!.querySelector('.track') as HTMLElement;
  const viewport = timeline.shadowRoot!.querySelector('.viewport') as HTMLElement;
  await fetch('/__selftest', { method: 'POST', body: JSON.stringify({ type: 'selftest-start', browser }) });

  for (const sample of SAMPLES.filter((s) => !only || only.includes(s.label) || only.includes(s.path))) {
    status(`selftest: ${sample.label}`);
    const r: Record<string, unknown> = { type: 'selftest', browser, sample: sample.path };
    try {
      const file = await sampleFile(sample);
      const t0 = performance.now();
      const ready = Promise.race([once<CustomEvent>(timeline, 'ready', 20000), once<CustomEvent>(timeline, 'mediaerror', 20000)]);
      timeline.load(file);
      const first = await ready;
      if (first.type === 'mediaerror') {
        r.mediaError = (first.detail as { error: Error }).error.message;
        r.mediaErrorMs = Math.round(performance.now() - t0);
        await fetch('/__selftest', { method: 'POST', body: JSON.stringify(r) });
        continue;
      }
      const detail = first.detail as { duration: number; engine: string | null };
      r.readyMs = Math.round(performance.now() - t0);
      r.engine = detail.engine;
      r.duration = round(detail.duration, 3);
      r.videoPlayable = !video.error;

      // Thumbnails for the fitted view
      const stripCount = () => [...internals.cache.entries.values()].filter((e) => e.sizeKey === internals.thumbGeometry().sizeKey).length;
      const t1 = performance.now();
      // Wait for 5 thumbnails, or for every slot when the strip is narrower (phones).
      const slots = Math.ceil(viewport.clientWidth / Math.max(16, (internals as unknown as { thumbGeometry(): { slotW: number } }).thumbGeometry().slotW));
      while (stripCount() < Math.min(5, slots) && performance.now() - t1 < 8000) await sleep(20);
      r.firstThumbsMs = Math.round(performance.now() - t0);
      await sleep(600);
      r.thumbs = stripCount();
      r.thumbCheck = checkFrames(internals, internals.thumbGeometry().sizeKey, sample.path);

      if (!video.error) {
        const d = detail.duration;
        const w = viewport.clientWidth;
        const rect = viewport.getBoundingClientRect();
        const at = (f: number) => rect.left + f * w;

        // Click at 50%
        await pointer(track, 'pointerdown', at(0.5));
        await pointer(track, 'pointerup', at(0.5));
        await settle(video);
        r.clickSeekErr = round(Math.abs(video.currentTime - 0.5 * d), 3);

        // Drag 20% -> 70%
        await pointer(track, 'pointerdown', at(0.2));
        for (const f of [0.3, 0.4, 0.5, 0.6, 0.7]) await pointer(track, 'pointermove', at(f));
        await pointer(track, 'pointerup', at(0.7));
        await settle(video);
        r.dragSeekErr = round(Math.abs(video.currentTime - 0.7 * d), 3);

        // Keyboard frame step
        const before = video.currentTime;
        track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await settle(video);
        const fps = internals.thumbnailer?.info.fps ?? 30;
        r.keyStepFrames = round((video.currentTime - before) * fps, 2);
      }

      // Hover preview at 33%
      const rect = viewport.getBoundingClientRect();
      await pointer(track, 'pointermove', rect.left + viewport.clientWidth * 0.33, 'mouse');
      await sleep(700);
      r.tooltipShown = timeline.shadowRoot!.querySelector('.tooltip')!.classList.contains('on');
      r.previewCheck = checkFrames(internals, internals.previewGeometry().sizeKey, sample.path);
      track.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

      // Zoom in and let the visible range fill
      timeline.setZoom(6);
      await sleep(1500);
      r.zoom = round(timeline.zoom, 2);
      r.zoomThumbCheck = checkFrames(internals, internals.thumbGeometry().sizeKey, sample.path);
      timeline.zoomToFit();
    } catch (e) {
      r.error = String((e as Error)?.message ?? e);
    }
    await fetch('/__selftest', { method: 'POST', body: JSON.stringify(r) });
  }
  await fetch('/__selftest', { method: 'POST', body: JSON.stringify({ type: 'selftest-done', browser, ua: navigator.userAgent }) });
  status('SELFTEST DONE');
}

/** Decode the barcode in every cached frame and compare it with the frame's timestamp. */
function checkFrames(internals: Internals, sizeKey: string, path: string): string {
  // Rotated and edit-list files have barcodes that don't map 1:1 to the file's timeline.
  if (path.includes('portrait') || path.includes('copycut')) return 'skipped';
  const entries = [...internals.cache.entries.values()].filter((e) => e.sizeKey === sizeKey);
  if (entries.length === 0) return '0/0';
  let ok = 0;
  const bad: string[] = [];
  for (const e of entries) {
    const c = document.createElement('canvas');
    c.width = e.frame.width;
    c.height = e.frame.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(e.frame, 0, 0);
    const got = readFrameIndex(ctx, c.width, c.height);
    const expected = Math.floor((e.ms / 1000) * 30 + 0.01);
    // VFR: dropped frames mean the correct frame is the last *kept* one, up to 7 frames earlier.
    const vfrOk = path.includes('vfr') && got <= expected && expected - got <= 7;
    if (got === expected || vfrOk) ok++;
    else bad.push(`${expected}->${got}`);
  }
  return `${ok}/${entries.length}${bad.length ? ` bad: ${bad.slice(0, 4).join(' ')}` : ''}`;
}

// Same barcode reader as spike/pattern.mjs (16 bits across the top 22% of the frame).
function readFrameIndex(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const y = Math.max(1, Math.round(h * 0.22 * 0.5));
  const data = ctx.getImageData(0, y - 1, w, 3).data;
  let value = 0;
  for (let i = 0; i < 16; i++) {
    const cx = Math.round(((i + 0.5) * w) / 16);
    let lum = 0;
    for (let dy = 0; dy < 3; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const p = (dy * w + Math.min(w - 1, Math.max(0, cx + dx))) * 4;
        lum += 0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!;
      }
    value = (value << 1) | (lum / 9 > 128 ? 1 : 0);
  }
  return value;
}

async function pointer(target: HTMLElement, type: string, clientX: number, pointerType = 'mouse') {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    // pointerId 999: no real pointer has it, so a real mouse moving over the page can't join the drag.
    new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX, clientY: rect.top + rect.height / 2, pointerId: 999, pointerType, button: 0, isPrimary: true }),
  );
  await sleep(30);
}

async function settle(video: HTMLVideoElement) {
  await sleep(50);
  const t = performance.now();
  while (video.seeking && performance.now() - t < 5000) await sleep(20);
  await sleep(50);
}

function once<T extends Event>(target: EventTarget, type: string, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    target.addEventListener(type, (e) => { clearTimeout(timer); resolve(e as T); }, { once: true });
  });
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

function detectBrowser() {
  const ua = navigator.userAgent;
  if (/Claude\//.test(ua)) return 'chromium(electron)';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/iPhone|iPad/.test(ua)) return 'ios-safari';
  if (/Safari\//.test(ua)) return 'safari';
  return 'unknown';
}
