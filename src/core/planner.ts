import type { TimeScale } from './scale.js';

/** One thumbnail cell of the filmstrip, in content coordinates. */
export interface Slot {
  index: number;
  /** Left edge in content pixels (not viewport pixels). */
  x: number;
  width: number;
  start: number;
  end: number;
  center: number;
}

/**
 * Thumbnail slots that intersect the viewport, plus `overscan` slots each side.
 * Slots are aligned to content pixels, so a given zoom always produces the same cells.
 */
export function visibleSlots(scale: TimeScale, slotWidth: number, overscan = 1): Slot[] {
  const { pxPerSec, contentWidth, scrollLeft, viewportWidth, duration } = scale;
  if (!(slotWidth > 0) || !(pxPerSec > 0) || !(duration > 0)) return [];
  const count = Math.ceil(contentWidth / slotWidth - 1e-9);
  const first = Math.max(0, Math.floor(scrollLeft / slotWidth) - overscan);
  const last = Math.min(count - 1, Math.floor((scrollLeft + viewportWidth - 1e-6) / slotWidth) + overscan);
  const slots: Slot[] = [];
  for (let i = first; i <= last; i++) {
    const x = i * slotWidth;
    const start = x / pxPerSec;
    const end = Math.min(duration, (x + slotWidth) / pxPerSec);
    slots.push({ index: i, x, width: slotWidth, start, end, center: (start + end) / 2 });
  }
  return slots;
}

/**
 * Coarse-to-fine ordering: every 4th item, then every 2nd, then the rest.
 * Combined with "draw the nearest available thumbnail", the strip looks complete
 * after the first pass and sharpens as the later passes arrive.
 */
export function progressivePasses<T>(items: readonly T[]): T[][] {
  const passes: T[][] = [[], [], []];
  items.forEach((item, i) => passes[i % 4 === 0 ? 0 : i % 2 === 0 ? 1 : 2]!.push(item));
  return passes.filter((p) => p.length > 0);
}
