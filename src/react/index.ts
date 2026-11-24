'use client';
import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import '../element/define.js';
import type { VideoTimelineElement, VideoTimelineEventMap } from '../element/video-timeline.js';
import type { EngineKind, EnginePreference } from '../engines/types.js';

export type { VideoTimelineElement } from '../element/video-timeline.js';

export interface VideoTimelineProps {
  /** The video to control: a ref (recommended) or the element itself. */
  video: RefObject<HTMLVideoElement | null> | HTMLVideoElement | null;
  /** Decode thumbnails from this File/Blob/URL instead of the video's own src. */
  source?: Blob | string | null;
  /** Filmstrip height in px (default 56). */
  height?: number;
  /** Decoder preference (default `auto`). */
  engine?: EnginePreference;
  theme?: 'auto' | 'dark' | 'light';
  thumbnails?: boolean;
  ruler?: boolean;
  tooltip?: boolean;
  /** Page-scroll to keep the playhead visible during playback when zoomed in (default true). */
  follow?: boolean;
  /** Accessible name (default "Video timeline"). */
  label?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  onReady?: (info: { duration: number; engine: EngineKind | null }) => void;
  /** The user moved the playhead (click, drag release, keyboard). */
  onSeek?: (time: number) => void;
  onScrubStart?: (time: number) => void;
  onScrub?: (time: number) => void;
  onScrubEnd?: (time: number) => void;
  onZoomChange?: (zoom: number) => void;
  onThumbnailError?: (error: Error) => void;
  /** The browser can't play the video at all (e.g. MKV in Safari). */
  onMediaError?: (error: Error) => void;
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * React wrapper for `<video-timeline>`.
 *
 *     const videoRef = useRef<HTMLVideoElement>(null);
 *     <video ref={videoRef} src={url} controls />
 *     <VideoTimeline video={videoRef} onSeek={(t) => console.log(t)} />
 *
 * The forwarded ref is the element itself (zoomIn(), load(file), seek(t), …).
 */
export const VideoTimeline = forwardRef<VideoTimelineElement | null, VideoTimelineProps>(function VideoTimeline(props, ref) {
  const { video, source, height, engine, theme, thumbnails, ruler, tooltip, follow, label, id, className, style } = props;
  const elRef = useRef<VideoTimelineElement | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useImperativeHandle(ref, () => elRef.current as VideoTimelineElement, []);

  // Attributes first (before the video is attached), so the first load uses them.
  useIsomorphicLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    setAttr(el, 'height', height ? String(height) : null);
    setAttr(el, 'engine', engine ?? null);
    setAttr(el, 'theme', theme ?? null);
    setAttr(el, 'thumbnails', thumbnails === false ? 'false' : null);
    setAttr(el, 'ruler', ruler === false ? 'false' : null);
    setAttr(el, 'tooltip', tooltip === false ? 'false' : null);
    setAttr(el, 'follow', follow === false ? 'false' : null);
    setAttr(el, 'label', label ?? null);
  }, [height, engine, theme, thumbnails, ruler, tooltip, follow, label]);

  useIsomorphicLayoutEffect(() => {
    if (elRef.current && source !== undefined) elRef.current.source = source;
  }, [source]);

  // Refs don't trigger renders, so re-read the video on every render (the setter ignores no-ops).
  useIsomorphicLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.video = video && 'current' in video ? video.current : video;
  });

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const on = <K extends keyof VideoTimelineEventMap>(type: K, fn: (e: VideoTimelineEventMap[K]) => void) => {
      el.addEventListener(type, fn as EventListener);
      return () => el.removeEventListener(type, fn as EventListener);
    };
    const offs = [
      on('ready', (e) => latest.current.onReady?.(e.detail)),
      on('seek', (e) => latest.current.onSeek?.(e.detail.time)),
      on('scrubstart', (e) => latest.current.onScrubStart?.(e.detail.time)),
      on('scrub', (e) => latest.current.onScrub?.(e.detail.time)),
      on('scrubend', (e) => latest.current.onScrubEnd?.(e.detail.time)),
      on('zoomchange', (e) => latest.current.onZoomChange?.(e.detail.zoom)),
      on('thumbnailerror', (e) => latest.current.onThumbnailError?.(e.detail.error)),
      on('mediaerror', (e) => latest.current.onMediaError?.(e.detail.error)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Only ref/id/class/style go through React; everything else is set explicitly above, because
  // React 19 assigns custom-element props as properties when a property of that name exists.
  return createElement('video-timeline', { ref: elRef, id, className, style });
});

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
