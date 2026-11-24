// Worker side of the "mb-worker" engine: probe + extract thumbnails off the main thread.
import { Input, ALL_FORMATS, BlobSource, CanvasSink } from '/node_modules/mediabunny/dist/bundles/mediabunny.min.mjs';
import { readFrameIndex } from './pattern.mjs';

self.onmessage = async ({ data }) => {
  const { blob, n, TW, TH, FPS } = data;
  try {
    const t0 = performance.now();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    self.postMessage({ type: 'probe', probeMs: performance.now() - t0, duration });

    const sink = new CanvasSink(track, { width: TW, height: TH, fit: 'cover' });
    const read = new OffscreenCanvas(TW, TH);
    const rctx = read.getContext('2d', { willReadFrequently: true });
    const ts = slotTimes(duration, n, FPS);
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(ts)) {
      const t = ts[i];
      let got = -1;
      if (wc) {
        rctx.drawImage(wc.canvas, 0, 0, TW, TH);
        got = readFrameIndex(rctx, TW, TH);
      }
      const bitmap = wc ? await createImageBitmap(read) : null;
      self.postMessage({ type: 'thumb', i, t, got, expected: Math.floor(t * FPS), bitmap }, bitmap ? [bitmap] : []);
      i++;
    }
    input.dispose?.();
    self.postMessage({ type: 'done' });
  } catch (e) {
    self.postMessage({ type: 'error', error: String(e?.stack ?? e) });
  }
};

function slotTimes(duration, n, FPS) {
  return Array.from({ length: n }, (_, i) => ((i + 0.5) * duration) / n + 0.5 / FPS);
}
