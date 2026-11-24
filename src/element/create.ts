import type { EnginePreference } from '../engines/types.js';
import { defineVideoTimeline, TAG_NAME } from './define.js';
import type { VideoTimelineElement } from './video-timeline.js';

export interface CreateTimelineOptions {
  /** The video to control. */
  video: HTMLVideoElement;
  /** Where to put the timeline: an element or a CSS selector. Defaults to right after the video. */
  container?: HTMLElement | string;
  /** Filmstrip height in px (default 56). */
  height?: number;
  engine?: EnginePreference;
  theme?: 'auto' | 'dark' | 'light';
  thumbnails?: boolean;
  ruler?: boolean;
}

/**
 * Vanilla JS helper:
 *
 *     const timeline = createTimeline({ video: document.querySelector('video') });
 *     timeline.addEventListener('seek', (e) => console.log(e.detail.time));
 */
export function createTimeline(options: CreateTimelineOptions): VideoTimelineElement {
  defineVideoTimeline();
  const el = document.createElement(TAG_NAME) as VideoTimelineElement;
  if (options.height) el.setAttribute('height', String(options.height));
  if (options.engine) el.setAttribute('engine', options.engine);
  if (options.theme) el.setAttribute('theme', options.theme);
  if (options.thumbnails === false) el.setAttribute('thumbnails', 'false');
  if (options.ruler === false) el.setAttribute('ruler', 'false');
  el.video = options.video;

  const container = typeof options.container === 'string' ? document.querySelector<HTMLElement>(options.container) : options.container;
  if (typeof options.container === 'string' && !container) throw new Error(`createTimeline: no element matches "${options.container}"`);
  if (container) container.append(el);
  else options.video.after(el);
  return el;
}
