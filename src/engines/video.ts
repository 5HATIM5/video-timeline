import type { FrameCallback, FrameEngine, FrameRequest, FrameSize } from './types.js';

/**
 * Decodes with a hidden <video> element: seek, then draw.
 * Works for anything the browser can *play* (e.g. HEVC in Safari) and was the fastest engine in
 * Safari when seeking straight onto keyframes (14–30 ms per thumbnail).
 *
 * Note: never rely on exact (non-keyframe) seeks for thumbnails in Safari: with AV1 it reports the
 * right currentTime but paints frame 0. Keyframe and fastSeek modes were correct on every file.
 */
export class VideoElementEngine implements FrameEngine {
  readonly kind = 'video' as const;
  private queue: Promise<void> = Promise.resolve();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  private constructor(private readonly video: HTMLVideoElement) {}

  static async create(src: string, { host, crossOrigin }: { host?: Node | null; crossOrigin?: string | null } = {}): Promise<VideoElementEngine> {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    if (crossOrigin != null) v.crossOrigin = crossOrigin;
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    // Stay in the document: some browsers don't decode detached media.
    v.style.cssText = 'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0';
    (host ?? document.body).appendChild(v);
    v.src = src;
    // iOS Safari only buffers media data for an unplayed, hidden video after an explicit load():
    // with just `src` it stops at metadata and seeks never complete. (A muted play()+pause()
    // also starts loading, but then drawImage returns a stale frame after seeking.)
    v.load();
    try {
      // Short budget: if a hidden player won't buffer (e.g. WebM on iOS), the WebCodecs
      // fallback is correct too, so don't make the user wait for it.
      await waitFor(v, 'loadeddata', 3000);
    } catch (e) {
      release(v);
      throw e;
    }
    // Prime the decoder with one throwaway seek: on iOS the first seek after load of some files
    // (10-bit HEVC) reported 'seeked' but painted frame 0, which would end up as a thumbnail.
    try {
      const presented = waitForFrame(v, () => v.currentTime, 300);
      const seeked = waitFor(v, 'seeked', 2000);
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
      await seeked;
      await presented;
    } catch {
      /* best effort */
    }
    return new VideoElementEngine(v);
  }

  extract(requests: readonly FrameRequest[], size: FrameSize, signal: AbortSignal, onFrame: FrameCallback): Promise<void> {
    // One hidden video can only seek to one place at a time, so calls are serialised.
    const run = this.queue.then(() => this.run(requests, size, signal, onFrame));
    this.queue = run.catch(() => {});
    return run;
  }

  dispose(): void {
    release(this.video);
  }

  private async run(requests: readonly FrameRequest[], { width, height }: FrameSize, signal: AbortSignal, onFrame: FrameCallback) {
    const v = this.video;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    for (const request of requests) {
      if (signal.aborted) return;
      try {
        const t = Math.max(0, request.time);
        // Registered before seeking so the frame can't be missed. Safari/iOS can fire 'seeked'
        // before the new frame is drawable, and a callback can also arrive for an older frame
        // (e.g. frame 0 right after load), so only the frame at the target time counts.
        const presented = waitForFrame(v, () => (request.mode === 'fast' ? v.currentTime : t), 150);
        const seeked = waitFor(v, 'seeked', 8000);
        if (request.mode === 'fast' && typeof v.fastSeek === 'function') v.fastSeek(t);
        // A hair past the keyframe so timestamp rounding can't land on the previous frame.
        else v.currentTime = request.mode === 'keyframe' ? t + 0.001 : t;
        await seeked;
        await presented;
      } catch {
        continue; // one bad seek shouldn't stop the strip
      }
      if (signal.aborted) return;
      drawCover(this.ctx, v, v.videoWidth, v.videoHeight, width, height);
      onFrame(request, await createImageBitmap(this.canvas));
    }
  }
}

export function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, tw: number, th: number): void {
  if (!sw || !sh) return;
  const s = Math.max(tw / sw, th / sh);
  const w = sw * s;
  const h = sh * s;
  ctx.drawImage(src, (tw - w) / 2, (th - h) / 2, w, h);
}

/**
 * Resolve once the video presents the frame at `expected()` (within 0.1 s), or after `ms`.
 * Without requestVideoFrameCallback support it resolves immediately.
 */
function waitForFrame(v: HTMLVideoElement, expected: () => number, ms: number): Promise<void> {
  if (!('requestVideoFrameCallback' in v)) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const check: VideoFrameRequestCallback = (_now, meta) => {
      if (done) return;
      if (Math.abs(meta.mediaTime - expected()) < 0.1) finish();
      else v.requestVideoFrameCallback(check);
    };
    v.requestVideoFrameCallback(check);
  });
}

function waitFor(target: HTMLMediaElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => () => {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
      fn();
    };
    const ok = done(resolve);
    const fail = done(() => reject(new Error(target.error?.message || `Media error ${target.error?.code ?? ''}`.trim())));
    const timer = setTimeout(done(() => reject(new Error(`Timed out waiting for ${event}`))), ms);
    target.addEventListener(event, ok);
    target.addEventListener('error', fail);
  });
}

function release(v: HTMLVideoElement): void {
  v.removeAttribute('src');
  v.load();
  v.remove();
}
