import { clamp } from './time.js';

/**
 * Maps time <-> pixels for a horizontally scrollable timeline.
 * `zoom` is relative to "fit" (1 = whole video fits the viewport).
 * x coordinates are viewport-relative (0 = left edge of what's visible).
 */
export class TimeScale {
  duration = 0;
  viewportWidth = 0;
  pxPerSec = 0;
  scrollLeft = 0;
  /** Upper bound on zoom, in pixels per second. */
  maxPxPerSec: number;
  private zoomFactor = 1;

  constructor({ maxPxPerSec = 600 }: { maxPxPerSec?: number } = {}) {
    this.maxPxPerSec = maxPxPerSec;
  }

  get fitPxPerSec(): number {
    return this.duration > 0 && this.viewportWidth > 0 ? this.viewportWidth / this.duration : 0;
  }
  get zoom(): number {
    return this.zoomFactor;
  }
  get maxZoom(): number {
    const fit = this.fitPxPerSec;
    return fit > 0 ? Math.max(1, this.maxPxPerSec / fit) : 1;
  }
  get contentWidth(): number {
    return this.duration * this.pxPerSec;
  }
  get maxScroll(): number {
    return Math.max(0, this.contentWidth - this.viewportWidth);
  }
  get visibleStart(): number {
    return this.xToTime(0);
  }
  get visibleEnd(): number {
    return this.xToTime(this.viewportWidth);
  }

  /** Update duration and/or viewport width, keeping the current zoom factor. */
  update({ duration, viewportWidth }: { duration?: number; viewportWidth?: number }): void {
    if (duration !== undefined) this.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    if (viewportWidth !== undefined) this.viewportWidth = Math.max(0, viewportWidth);
    this.zoomFactor = clamp(this.zoomFactor, 1, this.maxZoom);
    this.pxPerSec = this.fitPxPerSec * this.zoomFactor;
    this.scrollLeft = clamp(this.scrollLeft, 0, this.maxScroll);
  }

  /**
   * Zoom so the time under `anchorX` stays under `anchorX`.
   * Returns the new scrollLeft (apply it to the scroll container).
   */
  setZoom(factor: number, anchorX = this.viewportWidth / 2): number {
    const anchorTime = this.pxPerSec > 0 ? (anchorX + this.scrollLeft) / this.pxPerSec : 0;
    this.zoomFactor = clamp(factor, 1, this.maxZoom);
    this.pxPerSec = this.fitPxPerSec * this.zoomFactor;
    this.scrollLeft = clamp(anchorTime * this.pxPerSec - anchorX, 0, this.maxScroll);
    return this.scrollLeft;
  }

  setScroll(x: number): void {
    this.scrollLeft = clamp(x, 0, this.maxScroll);
  }

  timeToX(t: number): number {
    return t * this.pxPerSec - this.scrollLeft;
  }

  xToTime(x: number): number {
    return this.pxPerSec > 0 ? clamp((x + this.scrollLeft) / this.pxPerSec, 0, this.duration) : 0;
  }
}
