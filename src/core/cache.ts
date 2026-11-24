/** Anything we can draw and free. ImageBitmap in the browser. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

interface Entry<F> {
  sizeKey: string;
  ms: number;
  frame: F;
}

/**
 * LRU cache of decoded thumbnails, bucketed by pixel size, with nearest-time lookup.
 * Keyframe-snapped thumbnails share times across zoom levels, so zooming mostly hits the cache.
 */
export class ThumbnailCache<F extends Frame = Frame> {
  /** `${sizeKey}|${ms}` -> entry, in LRU order (oldest first). */
  private entries = new Map<string, Entry<F>>();
  /** sizeKey -> sorted times (ms), for nearest-neighbour lookup. */
  private times = new Map<string, number[]>();

  constructor(private readonly max = 400) {}

  get size(): number {
    return this.entries.size;
  }

  has(sizeKey: string, time: number): boolean {
    return this.entries.has(key(sizeKey, toMs(time)));
  }

  get(sizeKey: string, time: number): F | undefined {
    const k = key(sizeKey, toMs(time));
    const e = this.entries.get(k);
    if (!e) return undefined;
    this.entries.delete(k);
    this.entries.set(k, e);
    return e.frame;
  }

  set(sizeKey: string, time: number, frame: F): void {
    const ms = toMs(time);
    const k = key(sizeKey, ms);
    const old = this.entries.get(k);
    if (old) {
      if (old.frame !== frame) old.frame.close?.();
      this.entries.delete(k);
    } else {
      let list = this.times.get(sizeKey);
      if (!list) this.times.set(sizeKey, (list = []));
      list.splice(lowerBound(list, ms), 0, ms);
    }
    this.entries.set(k, { sizeKey, ms, frame });
    while (this.entries.size > this.max) {
      const oldest = this.entries.values().next().value!;
      this.remove(oldest);
    }
  }

  /** The cached frame closest in time to `time`, if any. */
  nearest(sizeKey: string, time: number): { time: number; frame: F } | undefined {
    const list = this.times.get(sizeKey);
    if (!list || list.length === 0) return undefined;
    const ms = toMs(time);
    const i = lowerBound(list, ms);
    const after = list[i];
    const before = list[i - 1];
    const best = after === undefined ? before! : before === undefined ? after : ms - before <= after - ms ? before : after;
    return { time: best / 1000, frame: this.entries.get(key(sizeKey, best))!.frame };
  }

  /** Drop everything (or one size bucket) and free the frames. */
  clear(sizeKey?: string): void {
    for (const e of [...this.entries.values()]) if (sizeKey === undefined || e.sizeKey === sizeKey) this.remove(e);
  }

  private remove(e: Entry<F>): void {
    e.frame.close?.();
    this.entries.delete(key(e.sizeKey, e.ms));
    const list = this.times.get(e.sizeKey);
    if (list) {
      list.splice(lowerBound(list, e.ms), 1);
      if (list.length === 0) this.times.delete(e.sizeKey);
    }
  }
}

const toMs = (t: number) => Math.round(t * 1000);
const key = (sizeKey: string, ms: number) => `${sizeKey}|${ms}`;

function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
