import 'video-timeline-scrubber';
import { formatTime, type VideoTimelineElement } from 'video-timeline-scrubber';
import { SAMPLES, sampleFile } from './samples.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('player');
const timeline = $<VideoTimelineElement>('timeline');
const stage = $('stage');
const meta = $('meta');
const logEl = $('log');
Object.assign(window, { timeline, video }); // handy in devtools

let fileName = '';

function open(file: File) {
  fileName = file.name;
  stage.classList.add('has-video');
  meta.textContent = `Loading ${file.name}…`;
  timeline.load(file); // sets video.src and decodes thumbnails from the file
}

function log(text: string) {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 60) logEl.lastElementChild!.remove();
}

// File picker + drag and drop
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) open(f);
});
const drop = $('drop');
const player = drop.parentElement!;
player.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
player.addEventListener('dragleave', () => drop.classList.remove('over'));
player.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) open(f);
});

// Test files
const samples = $('samples');
for (const s of SAMPLES) {
  const b = document.createElement('button');
  b.textContent = s.label;
  b.dataset.path = s.path;
  b.onclick = async () => {
    try {
      open(await sampleFile(s));
    } catch (e) {
      log(String(e));
    }
  };
  samples.append(b);
}

// Toolbar
$('zoom-in').onclick = () => timeline.zoomIn();
$('zoom-out').onclick = () => timeline.zoomOut();
$('zoom-fit').onclick = () => timeline.zoomToFit();
$<HTMLSelectElement>('engine').onchange = (e) => timeline.setAttribute('engine', (e.target as HTMLSelectElement).value);
$<HTMLSelectElement>('theme').onchange = (e) => timeline.setAttribute('theme', (e.target as HTMLSelectElement).value);
$<HTMLSelectElement>('height').onchange = (e) => timeline.setAttribute('height', (e.target as HTMLSelectElement).value);

// Events
let readyAt = 0;
video.addEventListener('loadstart', () => (readyAt = performance.now()));
timeline.addEventListener('ready', (e) => {
  const { duration, engine } = (e as CustomEvent).detail;
  const ms = Math.round(performance.now() - readyAt);
  meta.textContent = `${fileName} · ${formatTime(duration)} · ${video.videoWidth}×${video.videoHeight} · engine: ${engine ?? 'none'} · ready in ${ms} ms`;
  log(`ready  duration=${duration.toFixed(2)}s engine=${engine}`);
});
timeline.addEventListener('seek', (e) => log(`seek   ${formatTime((e as CustomEvent).detail.time, { decimals: 2 })}`));
timeline.addEventListener('scrubstart', (e) => log(`scrubstart ${formatTime((e as CustomEvent).detail.time, { decimals: 2 })}`));
timeline.addEventListener('scrubend', (e) => log(`scrubend   ${formatTime((e as CustomEvent).detail.time, { decimals: 2 })}`));
timeline.addEventListener('zoomchange', (e) => {
  const z = (e as CustomEvent).detail.zoom as number;
  $('zoom').textContent = `${z.toFixed(1)}×`;
});
timeline.addEventListener('thumbnailerror', (e) => log(`thumbnail error: ${(e as CustomEvent).detail.error.message}`));
video.addEventListener('error', () => log(`video error: ${video.error?.message || video.error?.code} (the browser can't play this file)`));

if (new URLSearchParams(location.search).has('selftest')) {
  stage.classList.add('has-video');
  void import('./selftest.js').then((m) => m.runSelftest(timeline, video));
}
