# Spike results: thumbnail extraction (2026-11-24)

Machine: Apple M4, macOS 26.5. Browsers: Chromium 156 (Electron, Claude app browser pane),
Safari 26.5. **Not tested:** Firefox (not installed), mobile, real camera files.
Raw data: `bench/results/results.jsonl` (not committed). Re-render tables with `node bench/summarize.mjs`.

## Headline

**Snapping filmstrip thumbnails to keyframes is the single biggest win (5–24× faster), and the
fastest decoder for it differs by browser.** Every engine was frame-exact on every thumbnail in
both browsers (barcode check, 100/100).

## Filmstrip: total time for 100 thumbnails (ms/thumb in brackets)

| fixture | browser | `<video>` exact seek | Mediabunny exact | `<video>` → keyframes | Mediabunny keyframes | `fastSeek` |
|---|---|--:|--:|--:|--:|--:|
| 1080p, 10 min, kf 2 s | Chromium | 2,356 (24) | 1,846 (18) | 1,153 (12) | **400 (4)** | n/a |
| 1080p, 10 min, kf 2 s | Safari | 3,982 (40) | 7,026 (70) | **1,409 (14)** | 3,731 (37) | 1,372 (14) |
| 1080p, 10 min, kf 10 s | Chromium | 7,461 (75) | 5,968 (60) | 605 (6) | **453 (5)** | n/a |
| 1080p, 10 min, kf 10 s | Safari | 7,878 (79) | 17,819 (178) | **854 (9)** | 3,700 (37) | 1,326 (13) |
| 4K, 3 min, kf 2 s | Chromium | 7,805 (78) | 5,755 (58) | 2,504 (25) | **759–1,533 (8–15)** | n/a |
| 4K, 3 min, kf 2 s | Safari | 9,299 (93) | 22,205 (222) | **3,859 (39)** | 13,092 (131) | 4,256 (43) |

- For a typical 12-thumbnail strip, the first thumbnail appears in 12–56 ms with the best
  engine, and the whole strip is done in about 50–200 ms (1080p) or 150–530 ms (4K).
- Variance between runs is about ±30%; the ranking never changed.

## Scrub latency (time until the requested frame is ready), avg / p95 ms

| fixture | Chromium `currentTime` | Safari `currentTime` | Safari `fastSeek` (lands on keyframe) |
|---|---|---|---|
| 1080p kf 2 s, random click | 21–25 / 34–36 | 20 / 36 | 4 / 5 |
| 1080p kf 10 s, random click | 69–78 / 120–166 | 84 / 157 | 3 / 5 |
| 4K kf 2 s, random click | 68 / 102–114 | 59 / 98 | 7 / 11 |

## Main-thread stalls

- Chromium: every engine stays around one frame (17–34 ms). WebCodecs work is already off-thread.
  **A worker isn't needed in v1.**
- Safari: Mediabunny decoding stalls the UI for up to 242–338 ms on 4K. Another reason not to
  use it in Safari.

## Bundle cost of Mediabunny (minified + gzip, lazy-loaded)

| what we import | gzip |
|---|--:|
| keyframe index only (`Input`, `BlobSource`, `EncodedPacketSink`) | 57 KB |
| + frame decoding (`CanvasSink`) | 73 KB |
| + trim/export (`Conversion`, MP4 muxer) | 122 KB |

## Round 2: real-world-shaped files (`real.html`, `make-real-fixtures.sh`)

Ten files built with ffmpeg 9.1 from the barcode source, each reproducing something real devices do:

| file | what it reproduces |
|---|---|
| `h264-bframes.mp4` | camera/phone H.264 High, 3 B-frames, 1 s GOP, AAC, moov at end, edit list (2-frame shift) |
| `iphone-hevc.mov` | Apple hardware HEVC (`hevc_videotoolbox`), `hvc1`, QuickTime container |
| `iphone-hevc-hdr10bit.mov` | iPhone HDR default: HEVC Main 10, 10-bit, HLG/BT.2020 tags |
| `portrait-rot90.mp4` | portrait phone video: landscape-coded with a 90° display matrix |
| `vfr.mp4` | variable frame rate (4.3–30 fps, average 19.8), B-frames |
| `copycut-editlist.mp4` | editor stream-copy cut starting 11 frames after a keyframe (edit list, negative first timestamp) |
| `vp9.webm` | MediaRecorder/Android style VP9 + Opus |
| `av1.mp4` | AV1 (SVT-AV1) in MP4 |
| `obs.mkv` | OBS default: Matroska |
| `screenrec-gop20s.mp4` | screen recording with a 20 s GOP |

For every file, 24 thumbnails were taken with each engine and the pairs compared: same frame
(barcode) and same picture (mean absolute pixel difference, MAD, 0–255).

**Chromium: every pair agreed on every file** (24/24 same frame, MAD 1.1–1.3). Exact engines
landed on the requested frame (offset 0). Rotation, HDR, edit lists, B-frames and VFR were all
handled identically by `<video>` and Mediabunny.

**Safari 26.5:**

| file | `<video>` exact ↔ Mediabunny exact | `<video>`→keyframe ↔ Mediabunny keyframe |
|---|---|---|
| H.264 B-frames, HEVC, rotation, VFR, edit list, VP9, 20 s GOP | 24/24 same frame (MAD 1.4–1.7) | 24/24 (MAD 1.4–1.9) |
| HEVC 10-bit HDR | 24/24 (MAD 3.4, slight colour difference) | 24/24 (MAD 3.6) |
| **AV1** | **0/24: `drawImage` shows frame 0 after every exact seek**, while `currentTime` reports the right time | 24/24 (MAD 1.7) |
| **MKV** | `<video>` can't open it (media error 4); Mediabunny decodes it fine | Mediabunny only |

Speed per thumbnail (ms), real files:

| | `<video>` exact | Mediabunny exact | `<video>`→keyframe | Mediabunny keyframe | `fastSeek` |
|---|--:|--:|--:|--:|--:|
| Chromium | 17–131 | 13–59 | 8–79 (VP9 slowest) | **4–12** | n/a |
| Safari | 24–83 | 53–175 | **14–30** | 37–49 | 15–63 (exact, no snapping, on WebM) |

Other findings:
- **Duration disagrees on VFR in Chromium:** `<video>` says 119.667 s, Mediabunny and Safari say
  119.967 s. Edit-list and WebM files differ by up to 21 ms.
- The edit-list file has a keyframe at −0.3 s (before the visible start). Both engines handle it
  the same way; clamp seeks to 0.

## Decisions for v1

1. **Filmstrip = keyframe-snapped by default.** Read the keyframe index with Mediabunny
   (metadata only, under 1 ms per lookup), then decode only keyframes. Round 2 showed this is
   also the *most robust* path: it was correct on every file in both browsers, including the AV1
   case where Safari's exact seeks fail.
2. **Two decoders behind one interface, chosen at runtime:**
   - `webcodecs`: Mediabunny `CanvasSink` on keyframes. Default in Chromium (fastest on every codec).
   - `video`: seek a hidden `<video>` to the exact keyframe timestamp. Default in Safari. It
     decodes whatever the browser can *play* (e.g. HEVC in Safari).
   - Automatic fallback to `webcodecs` when `<video>` can't open the file (MKV in Safari), and to
     plain `<video>` seeks when Mediabunny can't parse the container.
   - `auto` picks per browser, with a manual override.
3. **The `<video>` element is the source of truth for duration and current time**, because the
   timeline drives that element. Mediabunny timestamps are used only to *choose* frames; clamp
   to `[0, video.duration]`.
4. **Never use `<video>` exact seeks for thumbnails in Safari.** Use keyframe seeks, or Mediabunny
   for exact frames (AV1 bug above). Still to check: whether Safari's *visible* player shows the
   same wrong frame after exact AV1 seeks; if it does, it's worth filing a WebKit bug and noting
   it in our docs.
5. **Adaptive precision:** when zoomed in far enough that a thumbnail slot is shorter than the
   keyframe interval, snapping would repeat frames, so decode those slots exactly instead
   (visible range only).
6. **Scrubbing rules:** during a drag, show the nearest cached thumbnail immediately; allow only one
   seek in flight and always jump to the latest pointer position (coalescing, because p95 seeks are
   100–166 ms on long-GOP or 4K files); use `fastSeek` while dragging where it exists (3–7 ms in
   Safari); do an exact `currentTime` seek on release.
7. **No worker in v1.** Mediabunny is lazy-loaded with `import()`, never in the core bundle.

## Still open

- **Real-world files: done (round 2).** The `<video>`→keyframe hybrid lands on exactly the frame
  Mediabunny picks for B-frames, edit lists, HEVC, HDR, rotation, VFR, VP9 and AV1.
- **Actual phone and camera files** are still worth a quick check: our files are ffmpeg-encoded
  copies of a synthetic video, and devices add things like Dolby Vision metadata, timecode and
  extra metadata tracks.
- **Firefox** (desktop has WebCodecs and `fastSeek`) and **mobile** (iOS Safari memory, Android
  Chrome) are untested.
- **Safari AV1 exact seek:** check the visible player, not just `drawImage`.
- **Containers Mediabunny can't index:** fall back to `fastSeek` where it exists, otherwise plain
  exact seeks.
