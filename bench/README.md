# Spike: thumbnail extraction engines

Throwaway benchmark answering one question before we build the library:
**which engine should power the filmstrip and scrubbing by default?**

## Engines compared

| id | how it works | where it runs |
|---|---|---|
| `video` | hidden `<video>`, set `currentTime`, wait for `seeked`, `drawImage` | everywhere (universal fallback) |
| `mb-main` | Mediabunny `CanvasSink.canvasesAtTimestamps()` via WebCodecs | main thread |
| `mb-worker` | same as `mb-main`, inside a module Web Worker | worker |
| `video-fastSeek` | hidden `<video>` + `fastSeek()` (snaps to a nearby keyframe) | Safari/Firefox only |
| `mb-keyframe` | Mediabunny reads the keyframe index, then decodes only keyframes | main thread |
| `video-keyframe` | Mediabunny reads the keyframe index, `<video>` seeks exactly onto keyframes | main thread |

Findings and v1 decisions: see [RESULTS.md](RESULTS.md).

Round 2 (real-world-shaped files): `./make-real-fixtures.sh` (needs ffmpeg) builds
`fixtures/real/*`, then open `/real.html` in each browser and run `node bench/summarize-real.mjs`.

Scrub latency is measured separately: `video.currentTime`, `video.fastSeek` (Safari/Firefox only),
and `mb.getCanvas 640` (a 640×360 preview frame, e.g. for hover/scrub previews).

## Frame accuracy is measured, not eyeballed

Every fixture frame carries its own frame index as a 16-bit barcode in the top band
(`pattern.mjs`). The benchmark decodes the barcode from each thumbnail and compares it with
`floor(t * fps)`, so "frame-exact 100/100" means every thumbnail was the right frame.

## Run it

```bash
node bench/server.mjs            # http://127.0.0.1:5174
```

1. Open `/generate.html` in a Chromium browser once. It encodes the H.264 fixtures with
   Mediabunny (no ffmpeg) and saves them to `fixtures/`.
2. Open `/bench.html` in each browser **in a visible, focused tab** (background tabs throttle
   `requestAnimationFrame`, which breaks the UI-stall metric).
   Query params: `fixtures=a.mp4,b.mp4`, `n=12,100`, `engines=video,mb-main,mb-worker`.
3. Results are appended to `results/results.jsonl`.

## Fixtures

| file | resolution | length | keyframe every |
|---|---|---|---|
| `fhd-10min-kf2.mp4` | 1920×1080 @30 | 10 min | 2 s (typical phone/camera) |
| `fhd-10min-kf10.mp4` | 1920×1080 @30 | 10 min | 10 s (worst case: screen recordings, some encoders) |
| `uhd-3min-kf2.mp4` | 3840×2160 @30 | 3 min | 2 s |

## Bundle size (esbuild, minified + gzip -9)

| entry | gzip |
|---|---|
| Mediabunny, thumbnails only (`Input`, `BlobSource`, `CanvasSink`, MP4/MOV/WebM/MKV) | 73 KB |
| Mediabunny, + trim/export (`Conversion`, `Output`, MP4 muxer) | 122 KB |
| Mediabunny, full bundle | 197 KB |
