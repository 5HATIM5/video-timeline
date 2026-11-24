/** The parts of HTMLVideoElement the coordinator needs (easy to fake in tests). */
export interface Seekable {
  currentTime: number;
  fastSeek?: (time: number) => void;
  addEventListener(type: 'seeked', listener: () => void): void;
  removeEventListener(type: 'seeked', listener: () => void): void;
}

/**
 * Keeps scrubbing responsive on slow seeks.
 *
 * Browsers queue seeks, so firing one per pointermove makes the video fall further and further
 * behind the cursor (p95 seek latency was 100–166 ms on long-GOP or 4K files in our spike).
 * The coordinator keeps at most ONE seek in flight and, when it finishes, jumps straight to the
 * latest requested position, dropping everything in between.
 *
 * `fast: true` uses `fastSeek()` where available (Safari/Firefox), which lands on a nearby
 * keyframe in a few ms, for use while dragging. Call `commit()` on release for an exact seek.
 */
export class SeekCoordinator {
  private inFlight = false;
  private pending: { time: number; fast: boolean } | null = null;
  private last: { time: number; fast: boolean } | null = null;
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly media: Seekable, private readonly timeoutMs = 1500) {
    media.addEventListener('seeked', this.onSeeked);
  }

  /** True while a seek is running (the media may still show the previous frame). */
  get busy(): boolean {
    return this.inFlight;
  }

  /** Where the media is heading: the latest requested time. */
  get target(): number | null {
    return (this.pending ?? this.last)?.time ?? null;
  }

  /** Request a seek. Intermediate requests made while one is in flight are dropped. */
  request(time: number, { fast = false }: { fast?: boolean } = {}): void {
    if (this.inFlight) this.pending = { time, fast };
    else this.start(time, fast);
  }

  /** Exact seek that is guaranteed to run after any in-flight one (use on pointerup). */
  commit(time: number): void {
    // Already exactly there (e.g. a click without drag in a browser without fastSeek).
    if (!this.inFlight && this.last && this.last.time === time && !this.last.fast) return;
    this.request(time, { fast: false });
  }

  dispose(): void {
    this.media.removeEventListener('seeked', this.onSeeked);
    clearTimeout(this.watchdog);
    this.pending = null;
  }

  private start(time: number, fast: boolean): void {
    this.inFlight = true;
    fast = fast && typeof this.media.fastSeek === 'function';
    this.last = { time, fast };
    clearTimeout(this.watchdog);
    // If 'seeked' never arrives (media unloaded, browser quirk), don't block forever.
    this.watchdog = setTimeout(this.onSeeked, this.timeoutMs);
    if (fast) this.media.fastSeek!(time);
    else this.media.currentTime = time;
  }

  private onSeeked = (): void => {
    clearTimeout(this.watchdog);
    this.inFlight = false;
    const next = this.pending;
    this.pending = null;
    if (next) this.start(next.time, next.fast);
  };
}
