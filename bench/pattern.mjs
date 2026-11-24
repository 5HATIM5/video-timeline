// Test-pattern helpers shared by the fixture generator and the benchmark.
// Every frame carries its own frame index as a 16-bit barcode across the top
// band, so a thumbnail can be decoded back to "which frame did we really get?"
// That turns frame-accuracy into a number instead of eyeballing.

export const BITS = 16;
const BAND = 0.22; // top 22% of the frame is the barcode

export function drawFrame(ctx, W, H, frame, fps) {
  const t = frame / fps;
  // Background that changes over time (so thumbnails differ visibly)
  ctx.fillStyle = `hsl(${(t * 6) % 360} 55% 38%)`;
  ctx.fillRect(0, 0, W, H);

  // Moving ball (real motion, so P/B-frames carry data)
  const r = H * 0.08;
  const x = r + ((t * W * 0.25) % (W - 2 * r));
  const y = H * 0.62 + Math.sin(t * 2) * H * 0.18;
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Barcode band: bit i (MSB first) -> white if set
  const bandH = Math.round(H * BAND);
  const bw = W / BITS;
  for (let i = 0; i < BITS; i++) {
    const on = (frame >> (BITS - 1 - i)) & 1;
    ctx.fillStyle = on ? '#ffffff' : '#000000';
    ctx.fillRect(Math.round(i * bw), 0, Math.ceil(bw), bandH);
  }

  // Human-readable time + frame number
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(H * 0.16)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(formatTime(t, fps), W * 0.04, H * 0.42);
  ctx.font = `${Math.round(H * 0.07)}px system-ui, sans-serif`;
  ctx.fillText(`#${frame}`, W * 0.04, H * 0.9);
}

/** Read the barcode back from a decoded image of any size. */
export function readFrameIndex(ctx, w, h) {
  const y = Math.max(1, Math.round(h * BAND * 0.5));
  const data = ctx.getImageData(0, y - 1, w, 3).data;
  let value = 0;
  for (let i = 0; i < BITS; i++) {
    const cx = Math.round(((i + 0.5) * w) / BITS);
    let lum = 0;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = (dy * w + Math.min(w - 1, Math.max(0, cx + dx))) * 4;
        lum += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
      }
    }
    value = (value << 1) | (lum / 9 > 128 ? 1 : 0);
  }
  return value;
}

export function formatTime(t, fps) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.round((t - Math.floor(t)) * fps);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}
