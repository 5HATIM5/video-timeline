# How video-timeline-scrubber works

Background for the curious. You don't need any of this to use the component.

## Design

These choices come from benchmarks on Chromium 156 and Safari 26.5 (Apple M4), on synthetic and
real-world-style files. The benchmark code and full results are in [`bench/`](../bench/RESULTS.md).

1. **Keyframe snapping.** Decoding the exact frame at time *t* means decoding everything from
   the previous keyframe, which takes 60–200 ms on long-GOP or 4K files. A filmstrip thumbnail
   doesn't need to be exact, so each slot shows the keyframe inside it: one decoded frame, 5–24×
   faster. When you zoom in so far that a slot has no keyframe, that slot decodes its exact frame.
2. **The decoder is chosen per browser.** In Chromium, WebCodecs (through
   [Mediabunny](https://mediabunny.dev)) is fastest. In Safari, WebCodecs was 2.6–4× slower than
   seeking a hidden `<video>` onto keyframe timestamps, so the `<video>` engine is used there, and
   WebCodecs only for exact frames. Safari paints the wrong frame after exact `<video>` seeks
   on AV1. If one engine can't open a file, the other takes over.
3. **Scrubbing.** At most one seek runs at a time, intermediate positions are dropped, and
   release always ends on an exact seek. The playhead and tooltip follow the pointer immediately
   while the video catches up.
4. **The `<video>` element is the source of truth** for duration and time.

## Test results

| | status |
|---|---|
| Chromium (Chrome, Edge, Brave, Arc, Opera) | tested: Chromium 156 |
| Safari (macOS) | tested: Safari 26.5 |
| iOS Safari | tested: iOS 26.5 simulator (iPhone 17 Pro), ready in 0.1–0.8 s; not yet on a physical device |
| Firefox | should work (WebCodecs + `fastSeek`); not yet tested |
| Android Chrome | should work (same engine as desktop Chromium); not yet tested |

End-to-end self-test results (10 files, every thumbnail checked against a frame-index barcode
baked into the test video):

| | Chromium 156 | Safari 26.5 | iOS Safari 26.5 (simulator) |
|---|---|---|---|
| engine picked by `auto` | `webcodecs` | `video` | `video` |
| load → first thumbnails | 50–370 ms (20 s GOP: 1–2 s) | 145–300 ms (20 s GOP: about 1.7 s) | 230–1070 ms |
| thumbnails showing the right frame | all | all | all |
| click / drag seek error | 0 | 0 | 0 |
| → key | exactly one frame | exactly one frame | exactly one frame |
| MKV | works | `mediaerror` (Safari can't play MKV) | `mediaerror` |

On iOS, WebM falls back to the WebCodecs engine after about 3 s (iOS won't buffer WebM in a hidden
player). AV1 needs hardware support (iPhone 15 Pro or later; the simulator has none).

## Bundle size

| import | min | gzip |
|---|--:|--:|
| `video-timeline-scrubber` | 36 KB | 12 KB |
| `video-timeline-scrubber/react` (on top) | 1.5 KB | 0.7 KB |
| decoder chunk, lazy-loaded | 310 KB | 84 KB |

## Remote videos (URLs)

Videos on another domain need CORS headers (`Access-Control-Allow-Origin`) and HTTP range
requests to get the fast thumbnail path. Without them, thumbnails fall back to slower `<video>`
seeking where the browser allows it, and to no thumbnails otherwise. Streaming formats (HLS/DASH)
aren't supported yet.
