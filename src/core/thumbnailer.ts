import { demux, type DemuxedVideo } from '../engines/demux.js';
import type { EngineKind, EnginePreference, FrameCallback, FrameEngine, FrameRequest, FrameSize } from '../engines/types.js';
import { VideoElementEngine } from '../engines/video.js';
import { WebCodecsEngine } from '../engines/webcodecs.js';
import type { Slot } from './planner.js';
import { frameCenter } from './time.js';

export interface ThumbnailerOptions {
  /** Which decoder to use. `auto` (default) picks the fastest one measured for this browser. */
  engine?: EnginePreference;
  /** Where to attach the hidden <video> used by the `video` engine (defaults to document.body). */
  host?: Node | null;
  /** crossOrigin for the hidden <video>, for remote URLs. */
  crossOrigin?: string | null;
}

export interface ThumbnailerInfo {
  duration: number;
  /** Display size (rotation applied). */
  width: number;
  height: number;
  fps: number | null;
  codec: string | null;
  engine: EngineKind;
  /** True when the container's keyframe index could be read (enables keyframe snapping). */
  keyframeIndex: boolean;
}

export interface CapturedFrame {
  /** The time you asked for. */
  requested: number;
  /** The time of the frame you got (a keyframe when snapping). */
  time: number;
  frame: ImageBitmap;
}

/**
 * Headless frame extraction: open a video once, then pull thumbnails out of it.
 *
 *     const t = await Thumbnailer.open(file);
 *     const frames = await t.capture([0, 10, 20], { width: 160, height: 90 });
 *
 * Engine choice comes from the spike benchmark:
 * - Chromium: WebCodecs on keyframes (4–12 ms/thumbnail).
 * - Other browsers: hidden <video> seeking onto keyframes (14–30 ms in Safari),
 *   with WebCodecs for exact frames (Safari's exact <video> seeks are wrong for AV1).
 * - Falls back to the other engine when one can't open the file (e.g. MKV in Safari).
 */
export class Thumbnailer {
  private constructor(
    readonly info: ThumbnailerInfo,
    private readonly engine: FrameEngine,
    private readonly exactEngine: FrameEngine,
    private readonly demuxed: DemuxedVideo | null,
    private readonly ownedUrl: string | null,
  ) {}

  static async open(source: Blob | string, options: ThumbnailerOptions = {}): Promise<Thumbnailer> {
    const { engine: preference = 'auto', host, crossOrigin } = options;

    let demuxed: DemuxedVideo | null = null;
    try {
      demuxed = await demux(source);
    } catch {
      // Unknown container, CORS without range support, etc. The <video> engine may still work.
    }
    const canWebCodecs = !!demuxed?.canDecode;
    const order: EngineKind[] =
      preference === 'webcodecs' ? ['webcodecs', 'video']
      : preference === 'video' ? ['video', 'webcodecs']
      : prefersWebCodecs() ? ['webcodecs', 'video'] : ['video', 'webcodecs'];

    let ownedUrl: string | null = null;
    let engine: FrameEngine | null = null;
    let lastError: unknown = null;
    for (const kind of order) {
      try {
        if (kind === 'webcodecs') {
          if (!canWebCodecs) continue;
          engine = new WebCodecsEngine(demuxed!);
        } else {
          const url = typeof source === 'string' ? source : (ownedUrl ??= URL.createObjectURL(source));
          engine = await VideoElementEngine.create(url, { host: host ?? null, crossOrigin: crossOrigin ?? null });
        }
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!engine) {
      demuxed?.dispose();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      throw new Error(`This video can't be decoded in this browser${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
    }

    const exactEngine = engine.kind === 'video' && canWebCodecs ? new WebCodecsEngine(demuxed!) : engine;
    const info: ThumbnailerInfo = {
      duration: demuxed?.duration ?? 0,
      width: demuxed?.width ?? 0,
      height: demuxed?.height ?? 0,
      fps: demuxed?.fps ?? null,
      codec: demuxed?.codec ?? null,
      engine: engine.kind,
      keyframeIndex: !!demuxed,
    };
    return new Thumbnailer(info, engine, exactEngine, demuxed, ownedUrl);
  }

  /** Keyframe at or before `t` (null without a keyframe index). */
  keyframeAt(t: number): Promise<number | null> {
    return this.demuxed ? this.demuxed.keyframes.keyframeAt(t) : Promise.resolve(null);
  }

  /**
   * Decide which frame represents each filmstrip slot.
   * Snap to the keyframe inside the slot when there is one (one decoded frame each);
   * when zoomed in so far that the slot has no keyframe, decode the exact frame at its centre.
   */
  async plan(slots: readonly Pick<Slot, 'start' | 'center'>[]): Promise<FrameRequest[]> {
    const fps = this.info.fps ?? 30;
    return Promise.all(
      slots.map(async ({ start, center }): Promise<FrameRequest> => {
        if (!this.demuxed) return { time: center, mode: 'fast' };
        const k = await this.demuxed.keyframes.keyframeAt(center);
        if (k !== null && k >= 0 && k >= start - 1e-6) return { time: k, mode: 'keyframe' };
        return { time: frameCenter(center, fps), mode: 'exact' };
      }),
    );
  }

  /** Low-level: decode `requests`, calling `onFrame` as each arrives. Requests are de-duplicated and sorted. */
  async extract(requests: readonly FrameRequest[], size: FrameSize, signal: AbortSignal, onFrame: FrameCallback): Promise<void> {
    const unique = [...new Map(requests.map((r) => [`${r.mode}|${Math.round(r.time * 1000)}`, r])).values()].sort((a, b) => a.time - b.time);
    const exact = unique.filter((r) => r.mode === 'exact');
    const rest = unique.filter((r) => r.mode !== 'exact');
    if (this.exactEngine === this.engine) return this.engine.extract(unique, size, signal, onFrame);
    await this.engine.extract(rest, size, signal, onFrame);
    await this.exactEngine.extract(exact, size, signal, onFrame);
  }

  /**
   * Convenience: thumbnails for arbitrary times, in the order requested.
   * With `snap: true` (default) each time is snapped to its keyframe, which is much faster.
   * Entries that snap to the same keyframe share one ImageBitmap, so close each distinct bitmap once.
   */
  async capture(
    times: readonly number[],
    size: FrameSize,
    { snap = true, signal, onFrame }: { snap?: boolean; signal?: AbortSignal; onFrame?: (f: CapturedFrame, index: number) => void } = {},
  ): Promise<(CapturedFrame | null)[]> {
    const fps = this.info.fps ?? 30;
    const requests: FrameRequest[] = await Promise.all(
      times.map(async (t): Promise<FrameRequest> => {
        if (!this.demuxed) return { time: t, mode: snap ? 'fast' : 'exact' };
        if (snap) {
          const k = await this.demuxed.keyframes.keyframeAt(t);
          if (k !== null && k >= 0) return { time: k, mode: 'keyframe' };
        }
        return { time: frameCenter(t, fps), mode: 'exact' };
      }),
    );
    const out: (CapturedFrame | null)[] = times.map(() => null);
    const byKey = new Map<string, number[]>();
    requests.forEach((r, i) => {
      const key = `${r.mode}|${Math.round(r.time * 1000)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), i]);
    });
    await this.extract(requests, size, signal ?? new AbortController().signal, (r, frame) => {
      const indices = byKey.get(`${r.mode}|${Math.round(r.time * 1000)}`) ?? [];
      for (const i of indices) {
        // Times that snap to the same keyframe share one ImageBitmap.
        const f: CapturedFrame = { requested: times[i]!, time: r.time, frame };
        out[i] = f;
        onFrame?.(f, i);
      }
    });
    return out;
  }

  dispose(): void {
    this.engine.dispose();
    if (this.exactEngine !== this.engine) this.exactEngine.dispose();
    this.demuxed?.dispose();
    if (this.ownedUrl) URL.revokeObjectURL(this.ownedUrl);
  }
}

/** WebCodecs decoding was fastest in Chromium and slower than <video> in Safari (spike, Nov 2026). */
export function prefersWebCodecs(): boolean {
  if (typeof VideoDecoder === 'undefined' || typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
  if (uaData?.brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge|Opera/.test(b.brand))) return true;
  const ua = navigator.userAgent;
  return /\b(Chrome|Chromium|Edg)\//.test(ua) && !/\b(CriOS|FxiOS|EdgiOS)\//.test(ua);
}
