// Importing the package registers <video-timeline>.
export { defineVideoTimeline, TAG_NAME } from './element/define.js';
export { VideoTimelineElement, type VideoTimelineEventMap } from './element/video-timeline.js';
export { createTimeline, type CreateTimelineOptions } from './element/create.js';

// Headless building blocks, for custom UIs.
export { Thumbnailer, prefersWebCodecs, type ThumbnailerInfo, type ThumbnailerOptions, type CapturedFrame } from './core/thumbnailer.js';
export { TimeScale } from './core/scale.js';
export { SeekCoordinator, type Seekable } from './core/seek.js';
export { ThumbnailCache } from './core/cache.js';
export { computeTicks, type Tick, type Ticks, type TickOptions } from './core/ruler.js';
export { visibleSlots, progressivePasses, type Slot } from './core/planner.js';
export { formatTime, frameCenter, type FormatTimeOptions } from './core/time.js';
export type { EngineKind, EnginePreference, FrameMode, FrameRequest, FrameSize } from './engines/types.js';
