import type { Slot } from '../core/planner.js';
import { computeTicks } from '../core/ruler.js';
import type { TimeScale } from '../core/scale.js';

export interface Theme {
  rulerBg: string;
  trackBg: string;
  text: string;
  tick: string;
  separator: string;
  font: string;
}

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    rulerBg: v('--video-timeline-ruler-bg', '#1c1e23'),
    trackBg: v('--video-timeline-track-bg', '#24262d'),
    text: v('--video-timeline-text', '#aeb3be'),
    tick: v('--video-timeline-tick', '#444852'),
    separator: v('--video-timeline-separator', 'rgba(0,0,0,.35)'),
    font: v('--video-timeline-font', '500 10px system-ui, sans-serif'),
  };
}

/** Size a canvas's backing store for the device pixel ratio and return a CSS-pixel context. */
export function prepareCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, dpr: number): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawRuler(ctx: CanvasRenderingContext2D, scale: TimeScale, theme: Theme, width: number, height: number): void {
  ctx.fillStyle = theme.rulerBg;
  ctx.fillRect(0, 0, width, height);
  if (!(scale.duration > 0)) return;

  const ticks = computeTicks(scale.visibleStart, scale.visibleEnd, scale.pxPerSec, { hours: scale.duration >= 3600 });
  ctx.fillStyle = theme.tick;
  for (const t of ticks.minor) {
    ctx.fillRect(Math.round(scale.timeToX(t)), height - 4, 1, 4);
  }
  ctx.font = theme.font;
  ctx.textBaseline = 'middle';
  for (const { time, label } of ticks.major) {
    const x = Math.round(scale.timeToX(time));
    ctx.fillStyle = theme.tick;
    ctx.fillRect(x, height - 8, 1, 8);
    ctx.fillStyle = theme.text;
    // Label sits right of its tick; flip to the left at the right edge so it stays visible.
    const w = ctx.measureText(label).width;
    const lx = x + 4 + w <= width - 2 ? x + 4 : x - w - 4;
    if (lx >= 0) ctx.fillText(label, lx, height / 2 - 1);
  }
}

export function drawStrip(
  ctx: CanvasRenderingContext2D,
  scale: TimeScale,
  slots: readonly Slot[],
  frameFor: (slot: Slot) => CanvasImageSource | null,
  theme: Theme,
  width: number,
  height: number,
): void {
  ctx.fillStyle = theme.trackBg;
  ctx.fillRect(0, 0, width, height);
  if (!(scale.duration > 0)) return;

  ctx.imageSmoothingQuality = 'high';
  for (const slot of slots) {
    const x = slot.x - scale.scrollLeft;
    if (x > width || x + slot.width < 0) continue;
    const frame = frameFor(slot);
    if (frame) ctx.drawImage(frame, x, 0, slot.width, height);
  }
  // Thin separators make it read as a filmstrip.
  ctx.fillStyle = theme.separator;
  for (const slot of slots) {
    const x = Math.round(slot.x + slot.width - scale.scrollLeft);
    if (x > 0 && x < width) ctx.fillRect(x, 0, 1, height);
  }
  // Clear anything past the end of the video (last slot may be partial).
  const end = scale.timeToX(scale.duration);
  if (end < width) {
    ctx.fillStyle = theme.trackBg;
    ctx.fillRect(end, 0, width - end, height);
  }
}
