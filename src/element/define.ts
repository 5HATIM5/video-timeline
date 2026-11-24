import { VideoTimelineElement } from './video-timeline.js';

export const TAG_NAME = 'video-timeline';

/** Register `<video-timeline>`. Safe to call more than once, and a no-op during SSR. */
export function defineVideoTimeline(): void {
  if (typeof customElements === 'undefined' || customElements.get(TAG_NAME)) return;
  customElements.define(TAG_NAME, VideoTimelineElement);
}

defineVideoTimeline();
