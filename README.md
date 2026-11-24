# video-timeline-scrubber

[![npm](https://img.shields.io/npm/v/video-timeline-scrubber.svg)](https://www.npmjs.com/package/video-timeline-scrubber)
[![gzip size](https://img.shields.io/badge/gzip-12%20KB-blue.svg)](docs/how-it-works.md#bundle-size)
[![license](https://img.shields.io/npm/l/video-timeline-scrubber.svg)](LICENSE)

A free, drop-in **video timeline with a thumbnail filmstrip** for any `<video>`, like the timeline in
a video editor. Works with **React, Next.js, Vue, Nuxt, Angular, Svelte and plain JavaScript**.
Thumbnails are generated in the browser, with no server and no ffmpeg.

![Demo: drop a video, the filmstrip timeline appears; hover for previews, drag to scrub, zoom in](https://raw.githubusercontent.com/5HATIM5/video-timeline/main/docs/demo.gif)

```html
<video id="player" controls src="movie.mp4"></video>
<video-timeline for="player"></video-timeline>
```

- **Fast.** A filmstrip appears about 0.1–0.3 s after a video loads.
- **Upload and go.** `timeline.load(file)` plays a local file and builds its filmstrip.
- **Scrub, hover, zoom.** Drag to scrub, hover for previews, zoom down to single frames, and step
  frame by frame with the arrow keys.
- **Real-world files.** iPhone HEVC and HDR, portrait video, variable frame rate, WebM, AV1, MKV.
- **Small.** 12 KB gzipped; the decoder loads only when it's needed.
- **Accessible and themeable.** A keyboard-friendly slider for screen readers, light and dark
  themes, and CSS variables.

Works in Chrome, Edge, Safari (macOS and iOS) and other Chromium browsers.
[How it works and test results →](docs/how-it-works.md)

## Install

```bash
npm install video-timeline-scrubber
```

## Framework guides

Each guide shows the same app: pick a video file, play it, show the timeline, and react to seeks.
Click your framework:

<details>
<summary><b>Plain HTML (CDN, no build step)</b></summary>

```html
<input type="file" id="file" accept="video/*" />
<video id="player" controls></video>
<video-timeline for="player" id="timeline"></video-timeline>

<script type="module">
  import 'https://esm.sh/video-timeline-scrubber@0.1';

  const timeline = document.getElementById('timeline');
  document.getElementById('file').addEventListener('change', (e) => {
    timeline.load(e.target.files[0]); // sets video.src and builds the filmstrip
  });
  timeline.addEventListener('seek', (e) => console.log('seeked to', e.detail.time));
</script>
```

`<video-timeline>` also works with a video that already has a `src`. Just point `for` at it.

</details>

<details>
<summary><b>Vanilla JavaScript / TypeScript</b></summary>

With any bundler (Vite, webpack, Rollup, Parcel, esbuild):

```ts
import 'video-timeline-scrubber'; // registers <video-timeline>
import type { VideoTimelineElement } from 'video-timeline-scrubber';

const timeline = document.querySelector<VideoTimelineElement>('video-timeline')!;
fileInput.addEventListener('change', () => timeline.load(fileInput.files![0]));
timeline.addEventListener('seek', (e) => {
  console.log((e as CustomEvent<{ time: number }>).detail.time);
});
```

Or create it from code, without writing any HTML:

```ts
import { createTimeline } from 'video-timeline-scrubber';

const timeline = createTimeline({
  video: document.querySelector('video')!,
  container: '#timeline-slot', // optional, defaults to right after the video
  height: 64,
});
```

</details>

<details>
<summary><b>React</b></summary>

```tsx
import { useMemo, useRef, useState } from 'react';
import { VideoTimeline, type VideoTimelineElement } from 'video-timeline-scrubber/react';

export function Editor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<VideoTimelineElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file]);

  return (
    <>
      <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <video ref={videoRef} src={url} controls />
      <VideoTimeline
        ref={timelineRef}
        video={videoRef}
        source={file}            // decode thumbnails from the File directly
        height={64}
        onSeek={(time) => console.log('seeked to', time)}
        onReady={({ duration }) => console.log('duration', duration)}
      />
      <button onClick={() => timelineRef.current?.zoomIn()}>Zoom in</button>
    </>
  );
}
```

- `video` accepts a ref or the element. `source` is optional (it defaults to the video's `src`),
  but passing the `File` avoids re-reading a blob URL.
- The ref is the element itself, so `zoomIn()`, `zoomToFit()`, `seek(t)` and `load(file)` are
  available on it.
- Props: `height`, `engine`, `theme`, `thumbnails`, `ruler`, `tooltip`, `follow`, `label`,
  `className`, `style`, and the callbacks `onReady`, `onSeek`, `onScrubStart`, `onScrub`,
  `onScrubEnd`, `onZoomChange`, `onThumbnailError`, `onMediaError`.
- Works with React 18 and 19, StrictMode included.

</details>

<details>
<summary><b>Next.js</b></summary>

The React wrapper is already marked `'use client'` and is safe to import during server rendering.
Use it from a client component:

```tsx
// app/editor/video-editor.tsx
'use client';

import { useRef } from 'react';
import { VideoTimeline } from 'video-timeline-scrubber/react';

export default function VideoEditor({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <>
      <video ref={videoRef} src={src} controls />
      <VideoTimeline video={videoRef} />
    </>
  );
}
```

Then render `<VideoEditor src="/movie.mp4" />` from any server component or page. You don't need
`next/dynamic` or `ssr: false`.

</details>

<details>
<summary><b>Vue 3</b></summary>

First, tell Vue that `<video-timeline>` is a custom element:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    vue({
      template: { compilerOptions: { isCustomElement: (tag) => tag === 'video-timeline' } },
    }),
  ],
});
```

```vue
<script setup lang="ts">
import { ref } from 'vue';
import 'video-timeline-scrubber';
import type { VideoTimelineElement } from 'video-timeline-scrubber';

const timeline = ref<VideoTimelineElement | null>(null);
const lastSeek = ref(0);

function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) timeline.value?.load(file);
}
function onSeek(e: Event) {
  lastSeek.value = (e as CustomEvent<{ time: number }>).detail.time;
}
</script>

<template>
  <input type="file" accept="video/*" @change="onFile" />
  <video id="player" controls />
  <video-timeline ref="timeline" for="player" height="64" @seek="onSeek" />
  <p>Last seek: {{ lastSeek.toFixed(2) }}s</p>
</template>
```

Using several timelines on one page? Instead of `for` + `id`, pass the element:
`<video ref="videoEl" />` and `<video-timeline :video.prop="videoEl" />`.

</details>

<details>
<summary><b>Nuxt</b></summary>

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  vue: { compilerOptions: { isCustomElement: (tag) => tag === 'video-timeline' } },
});
```

```ts
// plugins/video-timeline.client.ts
import 'video-timeline-scrubber';
export default defineNuxtPlugin(() => {});
```

Then use `<video-timeline>` in any component exactly as in the Vue 3 example above (without
the `import 'video-timeline-scrubber'` line).

</details>

<details>
<summary><b>Angular</b></summary>

Allow custom elements in the component with `CUSTOM_ELEMENTS_SCHEMA`, and import the package once:

```ts
// editor.component.ts
import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, ViewChild } from '@angular/core';
import 'video-timeline-scrubber';
import type { VideoTimelineElement } from 'video-timeline-scrubber';

@Component({
  selector: 'app-editor',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <input type="file" accept="video/*" (change)="onFile($event)" />
    <video #player controls></video>
    <video-timeline #timeline [video]="player" height="64" (seek)="onSeek($event)"></video-timeline>
    <p>Last seek: {{ lastSeek.toFixed(2) }}s</p>
  `,
})
export class EditorComponent {
  @ViewChild('timeline') timeline!: ElementRef<VideoTimelineElement>;
  lastSeek = 0;

  onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.timeline.nativeElement.load(file);
  }
  onSeek(e: Event) {
    this.lastSeek = (e as CustomEvent<{ time: number }>).detail.time;
  }
}
```

With NgModules, add `CUSTOM_ELEMENTS_SCHEMA` to the module's `schemas` instead. The import is
safe with Angular SSR.

</details>

<details>
<summary><b>Svelte / SvelteKit</b></summary>

Svelte supports custom elements natively, so no configuration is needed (Svelte 5 syntax shown):

```svelte
<script lang="ts">
  import 'video-timeline-scrubber';
  import type { VideoTimelineElement } from 'video-timeline-scrubber';

  let timeline = $state<VideoTimelineElement>();
  let lastSeek = $state(0);

  function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) timeline?.load(file);
  }
</script>

<input type="file" accept="video/*" onchange={onFile} />
<video id="player" controls></video>
<video-timeline
  bind:this={timeline}
  for="player"
  height="64"
  onseek={(e: Event) => (lastSeek = (e as CustomEvent<{ time: number }>).detail.time)}
></video-timeline>
<p>Last seek: {lastSeek.toFixed(2)}s</p>
```

In Svelte 4, use `on:seek={...}` instead of `onseek`. The import is safe with SvelteKit SSR.

</details>

<details>
<summary><b>Anything else</b></summary>

`<video-timeline>` is a standard web component, so it works anywhere custom elements do: Solid,
Lit, Astro, Qwik, Alpine, htmx, or server-rendered HTML. Import `video-timeline-scrubber` once on the
client, then use the tag.

</details>

## API

### Connecting a video

| how | when |
|---|---|
| `<video-timeline for="player">` | the video has an `id` |
| `timeline.video = videoElement` | you have the element (React/Vue/Angular refs) |
| `timeline.load(file)` | the user picked or dropped a file: sets `video.src` and reads thumbnails from the file |
| `timeline.source = fileOrUrl` | you set `video.src` yourself to a blob URL, and want thumbnails read from the original `File` |

### Attributes

| attribute | default | |
|---|---|---|
| `for` | | id of the `<video>` to control |
| `height` | `56` | filmstrip height in px |
| `engine` | `auto` | `auto`, `webcodecs` or `video` (see [how it works](docs/how-it-works.md)) |
| `theme` | `auto` | `auto` (follows the OS), `dark`, `light` |
| `thumbnails` | `true` | `false` shows the ruler and playhead only |
| `ruler` | `true` | `false` hides the time ruler |
| `tooltip` | `true` | `false` hides the hover/scrub preview |
| `follow` | `true` | `false` stops auto-scrolling to the playhead during playback |
| `label` | `Video timeline` | accessible name |

### Properties and methods

| | |
|---|---|
| `video` | the `HTMLVideoElement` (overrides `for`) |
| `source` | `File`, `Blob` or URL to decode thumbnails from (defaults to the video's `currentSrc`) |
| `load(file)` | play a local file and use it for thumbnails |
| `seek(time)` | exact seek, scrolling the time into view |
| `zoom`, `maxZoom` | zoom factor (1 = whole video fits) |
| `zoomIn()`, `zoomOut()`, `zoomToFit()`, `setZoom(factor, anchorX?)` | |
| `scrollToTime(time)` | |
| `duration`, `currentTime` | `currentTime` follows the drag while scrubbing |
| `activeEngine` | `'webcodecs'`, `'video'` or `null` |

### Events

All are `CustomEvent`s that bubble and cross shadow DOM boundaries.

| event | `detail` | |
|---|---|---|
| `ready` | `{ duration, engine }` | duration known; `engine` is `null` without thumbnails |
| `seek` | `{ time }` | the user moved the playhead (click, drag release, keyboard) |
| `scrubstart` / `scrub` / `scrubend` | `{ time }` | while dragging |
| `zoomchange` | `{ zoom }` | |
| `thumbnailerror` | `{ error }` | thumbnails failed; the timeline still works |
| `mediaerror` | `{ error }` | the browser can't play the video at all (e.g. MKV in Safari) |

### Keyboard (when the timeline has focus)

| key | |
|---|---|
| ← / → | previous / next frame |
| Shift + ← / → | 1 second |
| Page Up / Page Down | ±10 seconds |
| Home / End | start / end |
| + / − / 0 | zoom in / out / fit |
| Space or K | play / pause |

Mouse: click to seek, drag to scrub, Ctrl/⌘ + wheel or pinch to zoom, and wheel to scroll when
zoomed in. Touch: horizontal drag scrubs and vertical swipes scroll the page.

### Styling

```css
video-timeline {
  --video-timeline-playhead: #3b82f6;
  --video-timeline-strip-height: 72px;
  --video-timeline-ruler-height: 24px;
  --video-timeline-radius: 12px;
  --video-timeline-bg: #111;
  --video-timeline-ruler-bg: #161616;
  --video-timeline-track-bg: #222;
  --video-timeline-text: #aaa;
  --video-timeline-tick: #444;
  --video-timeline-hover: rgb(255 255 255 / 0.6);
  --video-timeline-focus: #5b9dff;
  --video-timeline-font: 500 10px system-ui;
}
video-timeline::part(playhead) { width: 3px; }
```

Parts: `root`, `viewport`, `ruler`, `strip`, `track`, `playhead`, `hover-line`, `tooltip`, `status`.

### Headless

To build your own UI, use the thumbnail engine directly:

```ts
import { Thumbnailer } from 'video-timeline-scrubber';

const t = await Thumbnailer.open(file);               // picks the best engine for this browser
const frames = await t.capture([0, 5, 10, 15], { width: 320, height: 180 });
for (const f of frames) if (f) ctx.drawImage(f.frame, x, 0); // f.time is the keyframe shown
t.dispose();
```

`TimeScale`, `computeTicks`, `SeekCoordinator`, `ThumbnailCache`, `visibleSlots` and `formatTime`
are exported too.

## Browser support

Chrome, Edge and other Chromium browsers, Safari 26 (macOS) and iOS Safari 26 are tested end to end.
Firefox and Android Chrome should work but aren't verified yet. Safari can't play MKV, so the
timeline fires a `mediaerror` there. Remote videos on another domain need CORS headers.
Details: [docs/how-it-works.md](docs/how-it-works.md).

## Development

```bash
npm install
npm run dev        # demo at http://localhost:5180 (vanilla) and /react.html
npm test           # unit tests
npm run typecheck
npm run build
npm run size
```

The demo's test buttons and `/?selftest=1` end-to-end check use the benchmark videos; see
[`bench/README.md`](bench/README.md) to generate them. `/?record` is the scripted mode used to
record the demo GIF.

## Roadmap

- **v0.2, trim:** in/out handles, looping playback of the selection, and export of the trimmed
  file in the browser (fast keyframe cut or exact re-encode).
- **Later:** audio waveform track, chapter markers, sprite-sheet/VTT input for streaming video, an
  IndexedDB thumbnail cache, and multi-clip editing (split, reorder, tracks, undo).

## License

[MIT](LICENSE) © Hatim Shabbir
