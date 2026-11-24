import type { CanvasSink } from 'mediabunny';
import type { DemuxedVideo } from './demux.js';
import type { FrameCallback, FrameEngine, FrameRequest, FrameSize } from './types.js';

/**
 * Decodes with WebCodecs through Mediabunny.
 * Fastest engine in Chromium (4–12 ms per keyframe thumbnail in the spike, every codec).
 * In Safari 26 it was 2.6–4× slower than the <video> engine, so it's not the default there.
 */
export class WebCodecsEngine implements FrameEngine {
  readonly kind = 'webcodecs' as const;
  private sinks = new Map<string, CanvasSink>();

  constructor(private readonly video: DemuxedVideo) {}

  async extract(requests: readonly FrameRequest[], size: FrameSize, signal: AbortSignal, onFrame: FrameCallback): Promise<void> {
    if (requests.length === 0 || signal.aborted) return;
    const sink = this.sinkFor(size);
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(requests.map((r) => Math.max(0, r.time)))) {
      const request = requests[i++]!;
      if (signal.aborted) return; // leaving the loop closes the generator and its decoder
      if (!wrapped) continue;
      const bitmap = await createImageBitmap(wrapped.canvas);
      if (signal.aborted) {
        bitmap.close();
        return;
      }
      onFrame(request, bitmap);
    }
  }

  dispose(): void {
    this.sinks.clear();
  }

  private sinkFor({ width, height }: FrameSize): CanvasSink {
    const key = `${width}x${height}`;
    let sink = this.sinks.get(key);
    if (!sink) {
      // poolSize 2: canvases are recycled; we copy each one to an ImageBitmap before moving on.
      sink = new this.video.mb.CanvasSink(this.video.track, { width, height, fit: 'cover', poolSize: 2 });
      this.sinks.set(key, sink);
    }
    return sink;
  }
}
