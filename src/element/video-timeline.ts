import { ThumbnailCache } from '../core/cache.js';
import { progressivePasses, visibleSlots } from '../core/planner.js';
import { TimeScale } from '../core/scale.js';
import { SeekCoordinator } from '../core/seek.js';
import { Thumbnailer } from '../core/thumbnailer.js';
import { clamp, formatTime, frameCenter } from '../core/time.js';
import type { EngineKind, EnginePreference, FrameRequest } from '../engines/types.js';
import { drawRuler, drawStrip, prepareCanvas, readTheme, type Theme } from './render.js';
import { styles } from './styles.js';

/** Lets this module be imported during SSR (the element is only defined in the browser). */
const Base: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

export interface VideoTimelineEventMap {
  /** Duration is known; `engine` is null when thumbnails are off or unavailable. */
  ready: CustomEvent<{ duration: number; engine: EngineKind | null }>;
  /** The user moved the playhead (click, drag release, keyboard). */
  seek: CustomEvent<{ time: number }>;
  scrubstart: CustomEvent<{ time: number }>;
  scrub: CustomEvent<{ time: number }>;
  scrubend: CustomEvent<{ time: number }>;
  zoomchange: CustomEvent<{ zoom: number }>;
  /** Thumbnails couldn't be generated. The timeline still works without them. */
  thumbnailerror: CustomEvent<{ error: Error }>;
  /** The browser can't play the video (e.g. MKV in Safari). `ready` won't fire for it. */
  mediaerror: CustomEvent<{ error: Error }>;
}

const DEFAULT_STRIP = 56;
const ZOOM_STEP = 1.5;

/**
 * `<video-timeline for="my-video">` — a filmstrip timeline for any `<video>`.
 *
 * Attributes: `for`, `height` (filmstrip px), `engine` (auto|webcodecs|video), `theme` (auto|dark|light),
 * `thumbnails="false"`, `ruler="false"`, `tooltip="false"`, `follow="false"`, `label`.
 */
export class VideoTimelineElement extends Base {
  static get observedAttributes(): string[] {
    return ['for', 'height', 'engine', 'theme', 'thumbnails', 'ruler', 'label'];
  }

  // ------------------------------------------------------------------ state
  private _video: HTMLVideoElement | null = null;
  private videoFromFor = false;
  private bound: HTMLVideoElement | null = null;
  private _source: Blob | string | null = null;
  private sourceFromLoad = false;
  private ownedUrl: string | null = null;

  private readonly scale = new TimeScale();
  private readonly cache = new ThumbnailCache<ImageBitmap>(400);
  private thumbnailer: Thumbnailer | null = null;
  private seeker: SeekCoordinator | null = null;
  private gen = 0;
  private thumbsAbort: AbortController | null = null;
  private thumbsSignature = '';
  private thumbsQueued = false;
  private slotPlan: { pps: number; sizeKey: string; requests: Map<number, FrameRequest> } | null = null;

  // ------------------------------------------------------------------ DOM
  private built = false;
  private viewport!: HTMLDivElement;
  private content!: HTMLDivElement;
  private stage!: HTMLDivElement;
  private rulerCanvas!: HTMLCanvasElement;
  private stripCanvas!: HTMLCanvasElement;
  private track!: HTMLDivElement;
  private playheadEl!: HTMLDivElement;
  private hoverEl!: HTMLDivElement;
  private tooltip!: HTMLDivElement;
  private tooltipCanvas!: HTMLCanvasElement;
  private tooltipTime!: HTMLSpanElement;
  private statusEl!: HTMLDivElement;
  private theme: Theme | null = null;
  private drawQueued = false;
  private resizeObserver: ResizeObserver | null = null;
  private colorQuery: MediaQueryList | null = null;
  private resolveTries = 0;

  // ------------------------------------------------------------------ interaction
  private scrubbing = false;
  private scrubPointer = -1;
  private dragTime = 0;
  private resumeAfterScrub = false;
  private lastPointerX = 0;
  private hoverX: number | null = null;
  private autoScrollRaf = 0;
  private loopRaf = 0;
  private playheadWasVisible = true;
  private lastAria = '';
  private tooltipAt = 0;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private previewAbort: AbortController | null = null;

  // ================================================================== public API

  /** The `<video>` this timeline controls. Takes precedence over the `for` attribute. */
  get video(): HTMLVideoElement | null {
    return this._video;
  }
  set video(v: HTMLVideoElement | null) {
    this.videoFromFor = false;
    if (v !== this._video) this.setVideo(v);
  }

  /**
   * What to decode thumbnails from. Defaults to the video's own `currentSrc`.
   * Set a File/Blob when the video plays from a blob URL you created yourself
   * (or use `load(file)`, which does both).
   */
  get source(): Blob | string | null {
    return this._source;
  }
  set source(s: Blob | string | null) {
    if (s === this._source) return;
    this._source = s;
    this.sourceFromLoad = false;
    if (this.bound && this.bound.readyState >= 1) this.onMediaReady();
  }

  /** Play a local file: sets the video's src and decodes thumbnails from the file directly. */
  load(file: Blob): void {
    const v = this._video;
    if (!v) throw new Error('<video-timeline>: no video. Set the `for` attribute or the `video` property first.');
    const previous = this.ownedUrl;
    this.ownedUrl = URL.createObjectURL(file);
    this._source = file;
    this.sourceFromLoad = true;
    v.src = this.ownedUrl;
    if (previous) URL.revokeObjectURL(previous);
  }

  /** Zoom factor relative to "whole video fits" (1). */
  get zoom(): number {
    return this.scale.zoom;
  }
  set zoom(factor: number) {
    this.setZoom(factor);
  }
  get maxZoom(): number {
    return this.scale.maxZoom;
  }

  /** Zoom, keeping the time under `anchorX` (px from the left edge) in place. */
  setZoom(factor: number, anchorX?: number): void {
    if (!this.built) return;
    const before = this.scale.zoom;
    this.scale.setZoom(factor, anchorX ?? this.zoomAnchorX());
    this.applyScroll();
    if (Math.abs(this.scale.zoom - before) > 1e-6) this.emit('zoomchange', { zoom: this.scale.zoom });
  }
  zoomIn(step = ZOOM_STEP): void {
    this.setZoom(this.scale.zoom * step);
  }
  zoomOut(step = ZOOM_STEP): void {
    this.setZoom(this.scale.zoom / step);
  }
  zoomToFit(): void {
    this.setZoom(1);
  }

  get duration(): number {
    return this.scale.duration;
  }
  /** Time under the playhead (follows the drag while scrubbing). */
  get currentTime(): number {
    return this.uiTime();
  }
  /** The decoder in use, or null when there are no thumbnails. (The `engine` attribute is the preference.) */
  get activeEngine(): EngineKind | null {
    return this.thumbnailer?.info.engine ?? null;
  }

  /** Seek the video (exact) and bring that time into view. Doesn't fire `seek`. */
  seek(time: number): void {
    this.seekTo(time, false);
  }

  /** Scroll so `time` is visible (when zoomed in). */
  scrollToTime(time: number): void {
    const w = this.scale.viewportWidth;
    this.scale.setScroll(time * this.scale.pxPerSec - w / 2);
    this.applyScroll();
  }

  // ================================================================== lifecycle

  connectedCallback(): void {
    this.build();
    this.upgradeProperty('video');
    this.upgradeProperty('source');
    this.resizeObserver ??= new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.viewport);
    if (typeof matchMedia === 'function') {
      this.colorQuery = matchMedia('(prefers-color-scheme: light)');
      this.colorQuery.addEventListener('change', this.onThemeChange);
    }
    this.applyHeight();
    if (this._video) this.bindVideo();
    else this.resolveVideoFromFor();
    this.layout();
  }

  disconnectedCallback(): void {
    this.resizeObserver?.disconnect();
    this.colorQuery?.removeEventListener('change', this.onThemeChange);
    this.stopAutoScroll();
    this.unbindVideo();
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (oldValue === value || !this.built) return;
    switch (name) {
      case 'for':
        if (!this._video || this.videoFromFor) {
          this.resolveTries = 0;
          this.resolveVideoFromFor();
        }
        break;
      case 'height':
        this.applyHeight();
        this.layout();
        break;
      case 'theme':
        this.onThemeChange();
        break;
      case 'ruler':
        this.invalidate();
        break;
      case 'label':
        this.track.setAttribute('aria-label', value || 'Video timeline');
        break;
      case 'engine':
      case 'thumbnails':
        if (this.bound && this.bound.readyState >= 1) this.onMediaReady();
        break;
    }
  }

  // ================================================================== DOM

  private build(): void {
    if (this.built) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${styles}</style>
<div class="root" part="root">
  <div class="viewport" part="viewport">
    <div class="content">
      <div class="stage">
        <canvas class="ruler" part="ruler"></canvas>
        <canvas class="strip" part="strip"></canvas>
        <div class="hover" part="hover-line"></div>
        <div class="playhead" part="playhead"></div>
        <div class="track" part="track" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>
      </div>
    </div>
  </div>
  <div class="status" part="status"></div>
</div>
<div class="tooltip" part="tooltip" aria-hidden="true"><canvas hidden></canvas><span class="time"></span></div>`;
    const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    this.viewport = $('.viewport');
    this.content = $('.content');
    this.stage = $('.stage');
    this.rulerCanvas = $('.ruler');
    this.stripCanvas = $('.strip');
    this.track = $('.track');
    this.playheadEl = $('.playhead');
    this.hoverEl = $('.hover');
    this.tooltip = $('.tooltip');
    this.tooltipCanvas = $('.tooltip canvas');
    this.tooltipTime = $('.tooltip .time');
    this.statusEl = $('.status');
    this.track.setAttribute('aria-label', this.getAttribute('label') || 'Video timeline');

    this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
    this.track.addEventListener('pointerdown', this.onPointerDown);
    this.track.addEventListener('pointermove', this.onPointerMove);
    this.track.addEventListener('pointerup', this.onPointerUp);
    this.track.addEventListener('pointercancel', this.onPointerUp);
    this.track.addEventListener('lostpointercapture', this.onPointerUp);
    this.track.addEventListener('pointerleave', this.onPointerLeave);
    this.track.addEventListener('keydown', this.onKeyDown);
    this.built = true;
  }

  /** Properties set before the element was upgraded would shadow our accessors. */
  private upgradeProperty(prop: 'video' | 'source'): void {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const value = (this as Record<string, unknown>)[prop];
      delete (this as Record<string, unknown>)[prop];
      (this as Record<string, unknown>)[prop] = value;
    }
  }

  private applyHeight(): void {
    const h = Number(this.getAttribute('height'));
    if (h > 0) this.style.setProperty('--video-timeline-strip-height', `${h}px`);
    else this.style.removeProperty('--video-timeline-strip-height');
  }

  private get stripHeight(): number {
    return this.stripCanvas?.clientHeight || DEFAULT_STRIP;
  }
  private get rulerHeight(): number {
    return this.getAttribute('ruler') === 'false' ? 0 : this.rulerCanvas.clientHeight;
  }
  private get dpr(): number {
    return Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  }

  private layout(): void {
    if (!this.built || !this.isConnected) return;
    const width = this.viewport.clientWidth;
    this.scale.update({ viewportWidth: width, duration: this.mediaDuration() });
    this.stage.style.width = `${width}px`;
    this.content.style.width = `${Math.max(width, this.scale.contentWidth)}px`;
    this.applyScroll();
  }

  /** Push the scale's scroll position to the DOM and redraw. */
  private applyScroll(): void {
    const width = this.scale.viewportWidth;
    this.content.style.width = `${Math.max(width, this.scale.contentWidth)}px`;
    if (Math.abs(this.viewport.scrollLeft - this.scale.scrollLeft) > 0.5) this.viewport.scrollLeft = this.scale.scrollLeft;
    this.scale.setScroll(this.viewport.scrollLeft);
    this.invalidate();
    this.requestThumbs();
    this.updatePlayhead();
    if (this.hoverX !== null) this.setHover(this.hoverX);
  }

  private onScroll = (): void => {
    this.scale.setScroll(this.viewport.scrollLeft);
    this.invalidate();
    this.requestThumbs();
    this.updatePlayhead();
    if (this.hoverX !== null) this.setHover(this.hoverX);
  };

  private onThemeChange = (): void => {
    this.theme = null;
    this.invalidate();
  };

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // ================================================================== video binding

  private setVideo(v: HTMLVideoElement | null): void {
    this.unbindVideo();
    this._video = v;
    if (this.isConnected && v) this.bindVideo();
  }

  private resolveVideoFromFor(): void {
    const id = this.getAttribute('for');
    if (!id || !this.isConnected) return;
    const root = this.getRootNode() as Document | ShadowRoot;
    const found = (root.getElementById?.(id) ?? document.getElementById(id)) as HTMLElement | null;
    if (found instanceof HTMLVideoElement) {
      this.videoFromFor = true;
      if (found !== this._video) this.setVideo(found);
      this.videoFromFor = true;
    } else if (this.resolveTries++ < 120) {
      // The video may be rendered after us (frameworks, streaming HTML). Retry briefly.
      requestAnimationFrame(() => this.resolveVideoFromFor());
    }
  }

  private readonly mediaEvents: [string, () => void][] = [
    ['loadedmetadata', () => this.onMediaReady()],
    ['emptied', () => this.onEmptied()],
    ['durationchange', () => this.layout()],
    ['timeupdate', () => this.onTimeChange()],
    ['seeking', () => this.onTimeChange()],
    ['seeked', () => this.onTimeChange()],
    ['play', () => this.startLoop()],
    ['pause', () => this.stopLoop()],
    ['ended', () => this.stopLoop()],
    ['error', () => this.onMediaError()],
  ];

  private bindVideo(): void {
    const v = this._video;
    if (!v || this.bound === v || !this.built) return;
    this.unbindVideo();
    this.bound = v;
    for (const [type, fn] of this.mediaEvents) v.addEventListener(type, fn);
    this.seeker = new SeekCoordinator(v);
    if (v.readyState >= 1) this.onMediaReady();
    if (!v.paused) this.startLoop();
  }

  private unbindVideo(): void {
    const v = this.bound;
    if (!v) return;
    for (const [type, fn] of this.mediaEvents) v.removeEventListener(type, fn);
    this.seeker?.dispose();
    this.seeker = null;
    this.stopLoop();
    this.bound = null;
    this.teardownMedia();
  }

  private mediaDuration(): number {
    const d = this.bound?.duration;
    if (d !== undefined && Number.isFinite(d) && d > 0) return d;
    // e.g. MediaRecorder WebM reports Infinity; the demuxer knows better.
    return this.thumbnailer?.info.duration ?? 0;
  }

  private get thumbnailsEnabled(): boolean {
    return this.getAttribute('thumbnails') !== 'false';
  }
  private get enginePreference(): EnginePreference {
    const e = this.getAttribute('engine');
    return e === 'webcodecs' || e === 'video' ? e : 'auto';
  }

  private teardownMedia(): void {
    this.gen++;
    this.thumbsAbort?.abort();
    this.thumbsAbort = null;
    this.previewAbort?.abort();
    this.previewAbort = null;
    clearTimeout(this.previewTimer);
    this.thumbsSignature = '';
    this.slotPlan = null;
    this.thumbnailer?.dispose();
    this.thumbnailer = null;
    this.cache.clear();
    this.setStatus('');
  }

  private onEmptied(): void {
    this.teardownMedia();
    this.layout();
  }

  private onMediaError(): void {
    const v = this.bound;
    const err = v?.error;
    if (!v || !err) return;
    // An empty/removed src also fires 'error'; that's "no video", not "can't play this video".
    if (!v.getAttribute('src') && !v.querySelector('source') && !v.srcObject) return;
    this.teardownMedia();
    this.scale.update({ duration: 0 });
    this.layout();
    this.setStatus("This browser can't play this video");
    const reason = err.message || ['', 'aborted', 'network error', 'decode error', 'format not supported'][err.code] || `code ${err.code}`;
    this.emit('mediaerror', { error: new Error(`Video can't be played: ${reason}`) });
  }

  private onMediaReady(): void {
    const v = this.bound;
    if (!v) return;
    this.teardownMedia();
    const gen = this.gen;

    // A file passed to load() only applies while the video still plays it.
    if (this.sourceFromLoad && this.ownedUrl && v.currentSrc && v.currentSrc !== this.ownedUrl) {
      this._source = null;
      this.sourceFromLoad = false;
    }

    this.scale.setZoom(1);
    this.layout();
    this.onTimeChange();

    const source = this._source ?? (v.currentSrc && !v.srcObject ? v.currentSrc : null);
    if (!this.thumbnailsEnabled || !source) {
      if (this.thumbnailsEnabled) this.setStatus('No thumbnails for this source');
      this.emit('ready', { duration: this.scale.duration, engine: null });
      return;
    }

    Thumbnailer.open(source, { engine: this.enginePreference, host: this.shadowRoot, crossOrigin: v.crossOrigin })
      .then((tn) => {
        if (gen !== this.gen) {
          tn.dispose();
          return;
        }
        this.thumbnailer = tn;
        this.layout();
        this.emit('ready', { duration: this.scale.duration, engine: tn.info.engine });
        this.requestThumbs();
      })
      .catch((error: unknown) => {
        if (gen !== this.gen) return;
        this.setStatus('Thumbnails unavailable');
        this.emit('thumbnailerror', { error: toError(error) });
        this.emit('ready', { duration: this.scale.duration, engine: null });
      });
  }

  // ================================================================== thumbnails

  private thumbGeometry() {
    const v = this.bound;
    const info = this.thumbnailer?.info;
    const aw = v?.videoWidth || info?.width || 16;
    const ah = v?.videoHeight || info?.height || 9;
    const stripH = this.stripHeight;
    const slotW = Math.max(16, Math.round((stripH * aw) / ah));
    const dpr = this.dpr;
    const size = { width: Math.round(slotW * dpr), height: Math.round(stripH * dpr) };
    return { slotW, size, sizeKey: `${size.width}x${size.height}`, aspect: aw / ah };
  }

  private requestThumbs(): void {
    if (!this.thumbnailer || this.thumbsQueued) return;
    this.thumbsQueued = true;
    requestAnimationFrame(() => {
      this.thumbsQueued = false;
      void this.runThumbs();
    });
  }

  private async runThumbs(): Promise<void> {
    const tn = this.thumbnailer;
    if (!tn || !this.thumbnailsEnabled) return;
    const { slotW, size, sizeKey } = this.thumbGeometry();
    const slots = visibleSlots(this.scale, slotW, 1);
    if (slots.length === 0) return;
    const signature = `${sizeKey}|${this.scale.pxPerSec.toFixed(5)}|${slots[0]!.index}-${slots[slots.length - 1]!.index}`;
    if (signature === this.thumbsSignature) return;
    this.thumbsSignature = signature;
    this.thumbsAbort?.abort();
    const ctrl = (this.thumbsAbort = new AbortController());
    const gen = this.gen;
    const pps = this.scale.pxPerSec;

    try {
      const requests = await tn.plan(slots);
      if (ctrl.signal.aborted || gen !== this.gen) return;
      if (!this.slotPlan || this.slotPlan.pps !== pps || this.slotPlan.sizeKey !== sizeKey) {
        this.slotPlan = { pps, sizeKey, requests: new Map() };
      }
      slots.forEach((s, i) => this.slotPlan!.requests.set(s.index, requests[i]!));
      this.invalidate();

      const seen = new Set<number>();
      const missing = requests.filter((r) => {
        const ms = Math.round(r.time * 1000);
        if (seen.has(ms) || this.cache.has(sizeKey, r.time)) return false;
        seen.add(ms);
        return true;
      });
      for (const pass of progressivePasses(missing)) {
        await tn.extract(pass, size, ctrl.signal, (request, frame) => {
          if (gen !== this.gen) {
            frame.close();
            return;
          }
          this.cache.set(sizeKey, request.time, frame);
          this.invalidate();
        });
        if (ctrl.signal.aborted) return;
      }
    } catch (error) {
      if (ctrl.signal.aborted || gen !== this.gen) return;
      this.thumbsSignature = ''; // allow a retry on the next scroll/zoom
      this.emit('thumbnailerror', { error: toError(error) });
    }
  }

  // ================================================================== drawing

  private invalidate(): void {
    if (this.drawQueued || !this.built) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.draw();
    });
  }

  private draw(): void {
    const width = this.scale.viewportWidth;
    if (width <= 0) return;
    const theme = (this.theme ??= readTheme(this));
    const dpr = this.dpr;

    const rh = this.rulerHeight;
    if (rh > 0) {
      const ctx = prepareCanvas(this.rulerCanvas, width, rh, dpr);
      if (ctx) drawRuler(ctx, this.scale, theme, width, rh);
    }

    const sh = this.stripHeight;
    const ctx = prepareCanvas(this.stripCanvas, width, sh, dpr);
    if (!ctx) return;
    const { slotW, sizeKey } = this.thumbGeometry();
    const slots = this.thumbnailer ? visibleSlots(this.scale, slotW, 0) : [];
    const plan = this.slotPlan && this.slotPlan.pps === this.scale.pxPerSec && this.slotPlan.sizeKey === sizeKey ? this.slotPlan : null;
    drawStrip(
      ctx,
      this.scale,
      slots,
      (slot) => {
        const request = plan?.requests.get(slot.index);
        // Exact frame if we have it, otherwise the nearest one we do have (looks complete early).
        return (request && this.cache.get(sizeKey, request.time)) || this.cache.nearest(sizeKey, slot.center)?.frame || null;
      },
      theme,
      width,
      sh,
    );
  }

  // ================================================================== playhead

  /** The time the UI should show: the drag/seek target while those are in flight. */
  private uiTime(): number {
    if (this.scrubbing) return this.dragTime;
    if (this.seeker?.busy && this.seeker.target !== null) return this.seeker.target;
    return this.bound?.currentTime ?? 0;
  }

  private onTimeChange(): void {
    this.updatePlayhead();
  }

  private updatePlayhead(): void {
    if (!this.built) return;
    const t = this.uiTime();
    const x = this.scale.timeToX(t);
    const w = this.scale.viewportWidth;
    const visible = this.scale.duration > 0 && x >= -2 && x <= w + 2;
    this.playheadEl.style.display = visible ? '' : 'none';
    this.playheadEl.style.transform = `translateX(${x}px)`;

    const d = this.scale.duration;
    const aria = `${t.toFixed(1)}|${d.toFixed(1)}`;
    if (aria !== this.lastAria) {
      this.lastAria = aria;
      this.track.setAttribute('aria-valuemax', d.toFixed(2));
      this.track.setAttribute('aria-valuenow', t.toFixed(2));
      const hours = d >= 3600;
      this.track.setAttribute('aria-valuetext', `${formatTime(t, { hours })} of ${formatTime(d, { hours })}`);
    }
  }

  private startLoop(): void {
    if (this.loopRaf) return;
    const tick = () => {
      this.loopRaf = requestAnimationFrame(tick);
      this.updatePlayhead();
      this.followPlayhead();
    };
    this.loopRaf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.loopRaf);
    this.loopRaf = 0;
    this.updatePlayhead();
  }

  /** While playing and zoomed in, page-scroll when the playhead runs off the right edge. */
  private followPlayhead(): void {
    if (this.getAttribute('follow') === 'false' || this.scrubbing || this.scale.zoom <= 1 || !this.bound) return;
    const t = this.bound.currentTime;
    const x = this.scale.timeToX(t);
    const w = this.scale.viewportWidth;
    // Only follow if the playhead was on screen: if the user scrolled away, leave them there.
    if (this.playheadWasVisible && (x > w - 4 || x < 0)) {
      this.scale.setScroll(t * this.scale.pxPerSec - w * 0.08);
      this.applyScroll();
    }
    const nx = this.scale.timeToX(t);
    this.playheadWasVisible = nx >= 0 && nx <= w;
  }

  private seekTo(time: number, user: boolean): void {
    if (!this.seeker || !(this.scale.duration > 0)) return;
    const t = clamp(time, 0, this.scale.duration);
    this.seeker.commit(t);
    this.updatePlayhead();
    this.ensureVisible(t);
    if (user) this.emit('seek', { time: t });
  }

  private ensureVisible(t: number): void {
    const x = this.scale.timeToX(t);
    const w = this.scale.viewportWidth;
    if (x >= 0 && x <= w) return;
    this.scale.setScroll(t * this.scale.pxPerSec - (x < 0 ? w * 0.1 : w * 0.9));
    this.applyScroll();
  }

  private zoomAnchorX(): number {
    const x = this.scale.timeToX(this.uiTime());
    return x >= 0 && x <= this.scale.viewportWidth ? x : this.scale.viewportWidth / 2;
  }

  // ================================================================== pointer

  private localX(clientX: number): number {
    return clientX - this.viewport.getBoundingClientRect().left;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const v = this.bound;
    if (!v || !this.seeker || !(this.scale.duration > 0)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.track.focus({ preventScroll: true });
    try {
      this.track.setPointerCapture(e.pointerId);
    } catch {
      // Unknown pointer (synthetic events, some embedded webviews): scrub without capture.
    }
    this.scrubbing = true;
    this.scrubPointer = e.pointerId;
    this.resumeAfterScrub = !v.paused && !v.ended;
    if (this.resumeAfterScrub) v.pause();
    this.lastPointerX = this.localX(e.clientX);
    this.dragTime = this.scale.xToTime(this.lastPointerX);
    this.seeker.request(this.dragTime, { fast: true });
    this.emit('scrubstart', { time: this.dragTime });
    this.hoverEl.classList.remove('on');
    this.showTooltip(this.lastPointerX, this.dragTime);
    this.updatePlayhead();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const x = this.localX(e.clientX);
    if (this.scrubbing && e.pointerId === this.scrubPointer) {
      this.lastPointerX = x;
      this.scrubTo(x);
      this.updateAutoScroll();
    } else if (!this.scrubbing && e.pointerType === 'mouse') {
      this.setHover(x);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.scrubbing || e.pointerId !== this.scrubPointer) return;
    this.scrubbing = false;
    this.scrubPointer = -1;
    this.stopAutoScroll();
    const t = this.dragTime;
    this.seeker?.commit(t);
    if (this.resumeAfterScrub) void this.bound?.play().catch(() => {});
    this.resumeAfterScrub = false;
    this.emit('scrubend', { time: t });
    this.emit('seek', { time: t });
    if (e.type === 'pointerup' && e.pointerType === 'mouse') this.setHover(this.localX(e.clientX));
    else this.setHover(null);
    this.updatePlayhead();
  };

  private onPointerLeave = (): void => {
    if (!this.scrubbing) this.setHover(null);
  };

  private scrubTo(x: number): void {
    const t = this.scale.xToTime(clamp(x, 0, this.scale.viewportWidth));
    if (t === this.dragTime) return;
    this.dragTime = t;
    this.seeker?.request(t, { fast: true });
    this.emit('scrub', { time: t });
    this.showTooltip(clamp(x, 0, this.scale.viewportWidth), t);
    this.updatePlayhead();
  }

  /** Dragging near an edge while zoomed in scrolls the timeline. */
  private updateAutoScroll(): void {
    const speed = this.edgeSpeed();
    if (speed === 0) return this.stopAutoScroll();
    if (this.autoScrollRaf) return;
    const step = () => {
      this.autoScrollRaf = 0;
      const s = this.edgeSpeed();
      if (!this.scrubbing || s === 0) return;
      this.scale.setScroll(this.scale.scrollLeft + s);
      this.applyScroll();
      this.scrubTo(this.lastPointerX);
      this.autoScrollRaf = requestAnimationFrame(step);
    };
    this.autoScrollRaf = requestAnimationFrame(step);
  }

  private edgeSpeed(): number {
    if (this.scale.zoom <= 1) return 0;
    const w = this.scale.viewportWidth;
    const x = this.lastPointerX;
    const edge = Math.min(40, w / 6);
    if (x < edge) return -Math.min(30, (edge - x) * 0.5);
    if (x > w - edge) return Math.min(30, (x - (w - edge)) * 0.5);
    return 0;
  }

  private stopAutoScroll(): void {
    cancelAnimationFrame(this.autoScrollRaf);
    this.autoScrollRaf = 0;
  }

  private setHover(x: number | null): void {
    if (x === null || !(this.scale.duration > 0) || x < 0 || x > this.scale.viewportWidth) {
      this.hoverX = null;
      this.hoverEl.classList.remove('on');
      if (!this.scrubbing) this.tooltip.classList.remove('on');
      return;
    }
    this.hoverX = x;
    this.hoverEl.style.transform = `translateX(${x}px)`;
    this.hoverEl.classList.add('on');
    this.showTooltip(x, this.scale.xToTime(x));
  }

  private showTooltip(x: number, t: number): void {
    if (this.getAttribute('tooltip') === 'false') return;
    this.tooltipAt = t;
    this.tooltipTime.textContent = formatTime(t, { decimals: 2, hours: this.scale.duration >= 3600 });
    this.drawTooltipFrame();
    this.schedulePreview(t);
    this.tooltip.classList.add('on');
    const tw = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${clamp(x - tw / 2, 0, Math.max(0, this.clientWidth - tw))}px`;
  }

  private previewGeometry() {
    const { aspect } = this.thumbGeometry();
    const w = aspect >= 1 ? 160 : Math.round(120 * aspect);
    const h = aspect >= 1 ? Math.round(160 / aspect) : 120;
    const size = { width: Math.round(w * this.dpr), height: Math.round(h * this.dpr) };
    return { w, h, size, sizeKey: `${size.width}x${size.height}` };
  }

  /** Best frame we already have for the tooltip: a preview-size one, or a strip one if that's closer. */
  private drawTooltipFrame(): void {
    const t = this.tooltipAt;
    const preview = this.previewGeometry();
    const fromPreview = this.thumbnailer ? this.cache.nearest(preview.sizeKey, t) : undefined;
    const fromStrip = this.thumbnailer ? this.cache.nearest(this.thumbGeometry().sizeKey, t) : undefined;
    const best =
      fromPreview && (!fromStrip || Math.abs(fromPreview.time - t) <= Math.abs(fromStrip.time - t)) ? fromPreview : fromStrip;
    if (!best) {
      this.tooltipCanvas.hidden = true;
      return;
    }
    const { w, h } = preview;
    const ctx = prepareCanvas(this.tooltipCanvas, w, h, this.dpr);
    this.tooltipCanvas.style.width = `${w}px`;
    this.tooltipCanvas.style.height = `${h}px`;
    ctx?.drawImage(best.frame, 0, 0, w, h);
    this.tooltipCanvas.hidden = false;
  }

  /** Fetch the keyframe for the hovered time at tooltip size (~5–30 ms), debounced. */
  private schedulePreview(t: number): void {
    if (!this.thumbnailer) return;
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.loadPreview(t).catch(() => {}), 30);
  }

  private async loadPreview(t: number): Promise<void> {
    const tn = this.thumbnailer;
    if (!tn) return;
    const gen = this.gen;
    // A slot starting at 0 accepts any keyframe at or before t.
    const [request] = await tn.plan([{ start: 0, center: t }]);
    if (!request || gen !== this.gen) return;
    const { size, sizeKey } = this.previewGeometry();
    if (this.cache.has(sizeKey, request.time)) return this.drawTooltipFrame();
    this.previewAbort?.abort();
    const ctrl = (this.previewAbort = new AbortController());
    await tn.extract([request], size, ctrl.signal, (r, frame) => {
      if (gen !== this.gen) return frame.close();
      this.cache.set(sizeKey, r.time, frame);
      if (this.tooltip.classList.contains('on')) this.drawTooltipFrame();
    });
  }

  // ================================================================== wheel & keyboard

  private onWheel = (e: WheelEvent): void => {
    if (!(this.scale.duration > 0)) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.scale.viewportWidth : 1;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + wheel, and trackpad pinch (which browsers report as ctrl+wheel).
      e.preventDefault();
      const delta = clamp(e.deltaY * unit, -60, 60);
      this.setZoom(this.scale.zoom * Math.exp(-delta * 0.01), this.localX(e.clientX));
    } else if (this.scale.zoom > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Vertical wheel scrolls the timeline sideways when zoomed in.
      e.preventDefault();
      this.scale.setScroll(this.scale.scrollLeft + e.deltaY * unit);
      this.applyScroll();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const v = this.bound;
    if (!v || !(this.scale.duration > 0) || e.altKey) return;
    const fps = this.thumbnailer?.info.fps ?? 30;
    const now = this.uiTime();
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        target = e.shiftKey ? now - 1 : frameCenter(now, fps) - 1 / fps;
        break;
      case 'ArrowRight':
        target = e.shiftKey ? now + 1 : frameCenter(now, fps) + 1 / fps;
        break;
      case 'PageUp':
        target = now + 10;
        break;
      case 'PageDown':
        target = now - 10;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = this.scale.duration;
        break;
      case '+':
      case '=':
        this.zoomIn();
        break;
      case '-':
      case '_':
        this.zoomOut();
        break;
      case '0':
        this.zoomToFit();
        break;
      case ' ':
      case 'k':
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
        break;
      default:
        return;
    }
    e.preventDefault();
    if (target !== null) this.seekTo(target, true);
  };

  // ================================================================== events

  private emit<K extends keyof VideoTimelineEventMap>(type: K, detail: VideoTimelineEventMap[K]['detail']): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

declare global {
  interface HTMLElementTagNameMap {
    'video-timeline': VideoTimelineElement;
  }
}
