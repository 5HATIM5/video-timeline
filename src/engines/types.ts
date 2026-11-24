export type EngineKind = 'webcodecs' | 'video';
export type EnginePreference = 'auto' | EngineKind;

/**
 * How a frame should be fetched:
 * - `keyframe`: `time` IS a keyframe timestamp, so only one frame is decoded (fast).
 * - `exact`: decode the exact frame at `time` (decodes from the previous keyframe; slower).
 * - `fast`: no keyframe index is available; let the browser snap (`fastSeek`) if it can.
 */
export type FrameMode = 'keyframe' | 'exact' | 'fast';

export interface FrameRequest {
  time: number;
  mode: FrameMode;
}

/** Output size in device pixels. */
export interface FrameSize {
  width: number;
  height: number;
}

export type FrameCallback = (request: FrameRequest, frame: ImageBitmap) => void;

export interface FrameEngine {
  readonly kind: EngineKind;
  /** Decode frames for `requests` (sorted by time), calling `onFrame` as each one is ready. */
  extract(requests: readonly FrameRequest[], size: FrameSize, signal: AbortSignal, onFrame: FrameCallback): Promise<void>;
  dispose(): void;
}
