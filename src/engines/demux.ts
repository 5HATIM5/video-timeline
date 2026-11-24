import type { EncodedPacketSink, Input, InputVideoTrack } from 'mediabunny';

type Mediabunny = typeof import('./mediabunny.js');
let mediabunny: Promise<Mediabunny> | null = null;

/** Mediabunny is only ever loaded on demand, so it never lands in the main bundle. */
export function loadMediabunny(): Promise<Mediabunny> {
  return (mediabunny ??= import('./mediabunny.js'));
}

export interface DemuxedVideo {
  mb: Mediabunny;
  input: Input;
  track: InputVideoTrack;
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  codec: string | null;
  canDecode: boolean;
  keyframes: KeyframeIndex;
  dispose(): void;
}

/** Open a file/URL with Mediabunny: container metadata + keyframe index, no decoding yet. */
export async function demux(source: Blob | string): Promise<DemuxedVideo> {
  const mb = await loadMediabunny();
  const input = new mb.Input({
    formats: [mb.MP4, mb.QTFF, mb.WEBM, mb.MATROSKA, mb.MPEG_TS],
    source: typeof source === 'string' ? new mb.UrlSource(source) : new mb.BlobSource(source),
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track');
    const [duration, width, height, canDecode, codec] = await Promise.all([
      input.computeDuration(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.canDecode(),
      track.getCodecParameterString(),
    ]);
    let fps: number | null = null;
    try {
      fps = (await track.computeFrameRateMetrics()).bestGuessFrameRate || null;
    } catch {
      /* not critical */
    }
    return {
      mb, input, track, duration, width, height, fps, codec, canDecode,
      keyframes: new KeyframeIndex(new mb.EncodedPacketSink(track)),
      dispose: () => input.dispose(),
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}

/** Keyframe lookups from the container index (metadata only, well under 1 ms each). */
export class KeyframeIndex {
  private memo = new Map<number, number | null>();

  constructor(private readonly sink: EncodedPacketSink) {}

  /** Timestamp of the keyframe at or before `t`, or null if there is none. */
  async keyframeAt(t: number): Promise<number | null> {
    const ms = Math.round(t * 1000);
    if (this.memo.has(ms)) return this.memo.get(ms)!;
    const packet = await this.sink.getKeyPacket(t, { metadataOnly: true });
    const k = packet ? packet.timestamp : null;
    if (this.memo.size > 5000) this.memo.clear();
    this.memo.set(ms, k);
    return k;
  }
}
