import { formatTime } from './time.js';

export interface Tick {
  time: number;
  label: string;
}
export interface Ticks {
  /** Labelled ticks. */
  major: Tick[];
  /** Unlabelled ticks between the major ones. */
  minor: number[];
  /** Seconds between major ticks. */
  step: number;
}

/** Candidate seconds between labelled ticks, smallest first. */
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800];

/** How each step may be subdivided into minor ticks (preferred first). */
const SUBDIVISIONS: Record<number, number[]> = {
  0.1: [5, 2], 0.2: [4, 2], 0.5: [5], 1: [10, 5, 4, 2], 2: [4, 2], 5: [5], 10: [10, 5, 2],
  15: [3], 30: [6, 3], 60: [6, 4, 2], 120: [4, 2], 300: [5], 600: [10, 5, 2], 900: [3],
  1800: [6, 3], 3600: [4, 2], 7200: [4, 2], 14400: [4, 2], 28800: [4, 2],
};

export interface TickOptions {
  /** Minimum pixels between labelled ticks. */
  minMajorPx?: number;
  /** Minimum pixels between minor ticks. */
  minMinorPx?: number;
  /** Force `h:mm:ss` labels (use when the video is an hour or longer). */
  hours?: boolean;
}

/** Ticks for the visible time range [start, end] at the given zoom. */
export function computeTicks(start: number, end: number, pxPerSec: number, opts: TickOptions = {}): Ticks {
  const { minMajorPx = 80, minMinorPx = 8, hours = false } = opts;
  if (!(pxPerSec > 0) || !(end > start)) return { major: [], minor: [], step: 0 };

  const step = STEPS.find((s) => s * pxPerSec >= minMajorPx) ?? STEPS[STEPS.length - 1]!;
  const n = (SUBDIVISIONS[step] ?? [2]).find((d) => (step / d) * pxPerSec >= minMinorPx) ?? 1;
  const decimals = step < 1 ? 1 : 0;

  const major: Tick[] = [];
  const minor: number[] = [];
  const minorStep = step / n;
  const first = Math.ceil(start / minorStep - 1e-9);
  const last = Math.floor(end / minorStep + 1e-9);
  for (let k = first; k <= last; k++) {
    const time = Math.round(k * minorStep * 1e6) / 1e6; // avoid 0.30000000000000004
    if (k % n === 0) major.push({ time, label: formatTime(time, { decimals, hours }) });
    else minor.push(time);
  }
  return { major, minor, step };
}
