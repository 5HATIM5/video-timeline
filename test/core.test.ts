import { describe, expect, it, vi } from 'vitest';
import { formatTime, frameCenter } from '../src/core/time.js';
import { computeTicks } from '../src/core/ruler.js';
import { TimeScale } from '../src/core/scale.js';
import { progressivePasses, visibleSlots } from '../src/core/planner.js';
import { ThumbnailCache, type Frame } from '../src/core/cache.js';
import { SeekCoordinator, type Seekable } from '../src/core/seek.js';

describe('formatTime', () => {
  it('formats like a video player', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(65, { hours: true })).toBe('0:01:05');
  });
  it('rounds down so labels never run ahead', () => {
    expect(formatTime(59.999)).toBe('0:59');
    expect(formatTime(4.56, { decimals: 1 })).toBe('0:04.5');
    expect(formatTime(0.3, { decimals: 1 })).toBe('0:00.3');
  });
  it('handles odd input', () => {
    expect(formatTime(Number.NaN)).toBe('--:--');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('--:--');
    expect(formatTime(-5)).toBe('-0:05');
  });
  it('frameCenter targets the middle of the containing frame', () => {
    expect(frameCenter(1, 30)).toBeCloseTo(30.5 / 30);
    expect(frameCenter(1.0333, 25)).toBeCloseTo(25.5 / 25);
  });
  it('frameCenter treats float noise below a boundary as the boundary (Safari)', () => {
    expect(frameCenter(83.99999237, 30)).toBeCloseTo(2520.5 / 30);
    expect(frameCenter(83.99, 30)).toBeCloseTo(2519.5 / 30);
  });
});

describe('computeTicks', () => {
  it('chooses a step that keeps labels apart', () => {
    const t = computeTicks(0, 600, 1000 / 600); // 10 min in 1000px
    expect(t.step).toBe(60);
    expect(t.major.map((m) => m.label).slice(0, 3)).toEqual(['0:00', '1:00', '2:00']);
    expect(t.major.at(-1)!.time).toBe(600);
  });
  it('uses decimals for sub-second steps and avoids float noise', () => {
    const t = computeTicks(10, 11, 400);
    expect(t.step).toBe(0.2);
    expect(t.major.map((m) => m.time)).toEqual([10, 10.2, 10.4, 10.6, 10.8, 11]);
    expect(t.major[1]!.label).toBe('0:10.2');
  });
  it('places minor ticks between majors only', () => {
    const t = computeTicks(0, 10, 100);
    expect(t.step).toBe(1);
    expect(t.minor).not.toContain(1);
    expect(t.minor.length).toBeGreaterThan(0);
  });
  it('returns nothing for empty ranges', () => {
    expect(computeTicks(0, 0, 10).major).toEqual([]);
    expect(computeTicks(0, 10, 0).major).toEqual([]);
  });
});

describe('TimeScale', () => {
  const make = () => {
    const s = new TimeScale({ maxPxPerSec: 100 });
    s.update({ duration: 100, viewportWidth: 1000 });
    return s;
  };
  it('fits the whole duration at zoom 1', () => {
    const s = make();
    expect(s.pxPerSec).toBe(10);
    expect(s.contentWidth).toBe(1000);
    expect(s.maxScroll).toBe(0);
    expect(s.xToTime(500)).toBe(50);
    expect(s.timeToX(25)).toBe(250);
  });
  it('zooms around an anchor', () => {
    const s = make();
    const scroll = s.setZoom(4, 250); // time 25 under x=250
    expect(s.pxPerSec).toBe(40);
    expect(scroll).toBe(25 * 40 - 250);
    expect(s.xToTime(250)).toBeCloseTo(25);
  });
  it('clamps zoom and scroll', () => {
    const s = make();
    s.setZoom(1000);
    expect(s.pxPerSec).toBe(100); // maxPxPerSec
    s.setScroll(1e9);
    expect(s.scrollLeft).toBe(s.maxScroll);
    s.setZoom(0.1);
    expect(s.zoom).toBe(1);
    expect(s.scrollLeft).toBe(0);
  });
  it('keeps the zoom factor when the viewport resizes', () => {
    const s = make();
    s.setZoom(2);
    s.update({ viewportWidth: 500 });
    expect(s.zoom).toBe(2);
    expect(s.pxPerSec).toBe(10);
  });
  it('treats non-finite durations as empty', () => {
    const s = new TimeScale();
    s.update({ duration: Number.POSITIVE_INFINITY, viewportWidth: 800 });
    expect(s.pxPerSec).toBe(0);
    expect(s.xToTime(100)).toBe(0);
  });
});

describe('visibleSlots', () => {
  it('covers the viewport plus overscan', () => {
    const s = new TimeScale();
    s.update({ duration: 100, viewportWidth: 1000 });
    const slots = visibleSlots(s, 100, 0);
    expect(slots).toHaveLength(10);
    expect(slots[0]).toMatchObject({ index: 0, start: 0, end: 10, center: 5 });
    expect(slots[9]!.end).toBe(100);
  });
  it('clips the last partial slot to the duration', () => {
    const s = new TimeScale();
    s.update({ duration: 95, viewportWidth: 950 });
    const slots = visibleSlots(s, 100, 0);
    expect(slots.at(-1)).toMatchObject({ start: 90, end: 95, center: 92.5 });
  });
  it('follows scrolling when zoomed in', () => {
    const s = new TimeScale();
    s.update({ duration: 100, viewportWidth: 1000 });
    s.setZoom(10, 0);
    s.setScroll(5000);
    const slots = visibleSlots(s, 100, 1);
    expect(slots[0]!.index).toBe(49);
    expect(slots.at(-1)!.index).toBe(60);
  });
  it('orders work coarse to fine', () => {
    expect(progressivePasses([0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([[0, 4, 8], [2, 6], [1, 3, 5, 7]]);
    expect(progressivePasses([])).toEqual([]);
  });
});

describe('ThumbnailCache', () => {
  const frame = (): Frame & { closed: boolean } => {
    const f = { width: 1, height: 1, closed: false, close: () => { f.closed = true; } };
    return f;
  };
  it('stores and finds the nearest frame', () => {
    const c = new ThumbnailCache();
    c.set('a', 1, frame());
    c.set('a', 5, frame());
    c.set('a', 9, frame());
    expect(c.has('a', 5)).toBe(true);
    expect(c.nearest('a', 6.9)!.time).toBe(5);
    expect(c.nearest('a', 7.1)!.time).toBe(9);
    expect(c.nearest('a', -3)!.time).toBe(1);
    expect(c.nearest('b', 1)).toBeUndefined();
  });
  it('evicts least recently used frames and closes them', () => {
    const c = new ThumbnailCache(2);
    const f1 = frame(), f2 = frame(), f3 = frame();
    c.set('a', 1, f1);
    c.set('a', 2, f2);
    c.get('a', 1); // 1 is now most recent
    c.set('a', 3, f3);
    expect(c.size).toBe(2);
    expect(f2.closed).toBe(true);
    expect(c.has('a', 1)).toBe(true);
    expect(c.nearest('a', 2)!.time).not.toBe(2);
  });
  it('replaces and clears', () => {
    const c = new ThumbnailCache();
    const f1 = frame(), f2 = frame(), f3 = frame();
    c.set('a', 1, f1);
    c.set('a', 1, f2);
    expect(f1.closed).toBe(true);
    expect(c.size).toBe(1);
    c.set('b', 1, f3);
    c.clear('a');
    expect(f2.closed).toBe(true);
    expect(c.size).toBe(1);
    c.clear();
    expect(f3.closed).toBe(true);
    expect(c.size).toBe(0);
  });
});

describe('SeekCoordinator', () => {
  function fakeVideo() {
    let listener: (() => void) | null = null;
    const seeks: string[] = [];
    const v: Seekable & { seeks: string[]; finish(): void } = {
      seeks,
      get currentTime() { return 0; },
      set currentTime(t: number) { seeks.push(`exact ${t}`); },
      fastSeek: (t: number) => { seeks.push(`fast ${t}`); },
      addEventListener: (_: 'seeked', l: () => void) => { listener = l; },
      removeEventListener: () => { listener = null; },
      finish: () => listener?.(),
    };
    return v;
  }

  it('keeps one seek in flight and jumps to the latest request', () => {
    const v = fakeVideo();
    const c = new SeekCoordinator(v);
    c.request(1, { fast: true });
    c.request(2, { fast: true });
    c.request(3, { fast: true });
    expect(v.seeks).toEqual(['fast 1']);
    v.finish();
    expect(v.seeks).toEqual(['fast 1', 'fast 3']);
    v.finish();
    expect(c.busy).toBe(false);
  });
  it('commit always ends with an exact seek', () => {
    const v = fakeVideo();
    const c = new SeekCoordinator(v);
    c.request(1, { fast: true });
    c.commit(1.5);
    v.finish();
    expect(v.seeks).toEqual(['fast 1', 'exact 1.5']);
  });
  it('skips a redundant exact commit after a plain click', () => {
    const v = fakeVideo();
    delete (v as { fastSeek?: unknown }).fastSeek;
    const c = new SeekCoordinator(v);
    c.request(2, { fast: true }); // no fastSeek -> exact
    v.finish();
    c.commit(2);
    expect(v.seeks).toEqual(['exact 2']);
    expect(c.target).toBe(2);
  });
  it('reports the latest target while busy', () => {
    const v = fakeVideo();
    const c = new SeekCoordinator(v);
    c.request(1, { fast: true });
    c.request(7, { fast: true });
    expect(c.busy).toBe(true);
    expect(c.target).toBe(7);
  });
  it('falls back to currentTime without fastSeek', () => {
    const v = fakeVideo();
    delete (v as { fastSeek?: unknown }).fastSeek;
    new SeekCoordinator(v).request(4, { fast: true });
    expect(v.seeks).toEqual(['exact 4']);
  });
  it('recovers if seeked never fires', () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const c = new SeekCoordinator(v, 100);
    c.request(1);
    c.request(2);
    vi.advanceTimersByTime(150);
    expect(v.seeks).toEqual(['exact 1', 'exact 2']);
    c.dispose();
    vi.useRealTimers();
  });
});
