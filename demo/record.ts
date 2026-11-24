// Recording mode (/?record): a clean, dark page plus a fake cursor, driven step by step from
// devtools (window.rec) to capture the README demo GIF. Screenshots don't include the real cursor.
import type { VideoTimelineElement } from 'video-timeline-scrubber';

const CURSOR = `<svg width="22" height="28" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg">
<path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 16 L18.5 16 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export function setupRecording(timeline: VideoTimelineElement, open: (file: File) => void): void {
  document.body.classList.add('recording');
  timeline.setAttribute('theme', 'dark');
  timeline.setAttribute('height', '64');

  const cursor = document.createElement('div');
  cursor.className = 'rec-cursor';
  cursor.innerHTML = CURSOR;
  const chip = document.createElement('div');
  chip.className = 'rec-chip';
  chip.innerHTML = '<span>🎬</span> fractal-zoom.mp4';
  document.body.append(chip, cursor);

  const track = () => timeline.shadowRoot!.querySelector('.track') as HTMLElement;
  const at = (f: number) => {
    const r = track().getBoundingClientRect();
    return { x: r.left + f * r.width, y: r.top + r.height * 0.72 };
  };
  const moveCursor = (x: number, y: number) => {
    cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
    chip.style.transform = `translate(${x + 14}px, ${y + 16}px)`;
  };
  const fire = (type: string, f: number) => {
    const { x, y } = at(f);
    moveCursor(x, y);
    track().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 999, pointerType: 'mouse', button: 0 }));
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => {
    const v = timeline.video!;
    await sleep(60);
    while (v.seeking) await sleep(20);
    await sleep(80);
  };

  Object.assign(window, {
    rec: {
      cursorAt(xFrac: number, yFrac: number) {
        moveCursor(innerWidth * xFrac, innerHeight * yFrac);
      },
      chip(show: boolean) {
        chip.style.opacity = show ? '1' : '0';
      },
      dragOver(on: boolean) {
        document.getElementById('drop')!.classList.toggle('over', on);
      },
      async drop() {
        const blob = await (await fetch('./demo-sample.mp4')).blob();
        document.getElementById('drop')!.classList.remove('over');
        chip.style.opacity = '0';
        open(new File([blob], 'fractal-zoom.mp4', { type: 'video/mp4' }));
        await new Promise((r) => timeline.addEventListener('ready', r, { once: true }));
      },
      async hover(f: number) {
        fire('pointermove', f);
        await sleep(250);
      },
      async down(f: number) {
        fire('pointerdown', f);
        await settle();
      },
      async move(f: number) {
        fire('pointermove', f);
        await settle();
      },
      async up(f: number) {
        fire('pointerup', f);
        await settle();
      },
      leave() {
        track().dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      },
      async zoomIn() {
        const b = document.getElementById('zoom-in')!.getBoundingClientRect();
        moveCursor(b.left + b.width / 2, b.top + b.height / 2);
        timeline.zoomIn(2);
        await sleep(700);
      },
      /** Card bounds in CSS px, for cropping the screenshots. */
      cardRect() {
        const r = document.getElementById('stage')!.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio };
      },
    },
  });
}
