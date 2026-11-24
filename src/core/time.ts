export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export interface FormatTimeOptions {
  /** Digits after the seconds (0–3). */
  decimals?: 0 | 1 | 2 | 3;
  /** Always show hours, e.g. `0:01:05` instead of `1:05`. */
  hours?: boolean;
}

/**
 * Format seconds like a video player: `1:05`, `1:02:03`, `0:04.5`.
 * Rounds down, so the label never runs ahead of the frame being shown.
 */
export function formatTime(seconds: number, { decimals = 0, hours = false }: FormatTimeOptions = {}): string {
  if (!Number.isFinite(seconds)) return '--:--';
  const scale = 10 ** decimals;
  let units = Math.floor(Math.abs(seconds) * scale + 1e-6);
  const frac = units % scale;
  units = (units - frac) / scale;
  const s = units % 60;
  const m = Math.floor(units / 60) % 60;
  const h = Math.floor(units / 3600);
  let out = hours || h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  if (decimals > 0) out += '.' + String(frac).padStart(decimals, '0');
  return (seconds < 0 && units + frac > 0 ? '-' : '') + out;
}

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));

/**
 * Time of the middle of the frame that contains `t`. Seeking there can't land on a neighbour.
 * Times a hair below a frame boundary count as that boundary: Safari reports e.g. 83.99999237
 * after seeking to 84, which would otherwise be read as the previous frame.
 */
export function frameCenter(t: number, fps: number): number {
  return (Math.floor(t * fps + 1e-3) + 0.5) / fps;
}
