# Changelog

## 0.1.1 (2026-11-24)

Docs only, no code changes.

- README: demo GIF, collapsible framework guides, shorter overview.
- Design notes, test results and bundle sizes moved to `docs/how-it-works.md`.

## 0.1.0 (2026-11-24)

First release.

- `<video-timeline>` web component: thumbnail filmstrip, time ruler, playhead, click-to-seek,
  drag scrubbing, hover preview, zoom (wheel, pinch, keys) and scrolling, auto-follow during playback,
  keyboard control with frame stepping, touch support, light and dark themes, CSS variables and `::part`.
- `load(file)` to play a local file and decode thumbnails straight from it.
- React wrapper: `video-timeline-scrubber/react`.
- Headless `Thumbnailer` API plus `TimeScale`, `computeTicks`, `SeekCoordinator`, `ThumbnailCache`.
- Keyframe-snapped thumbnails, with the decoder (WebCodecs or `<video>`) chosen per browser from benchmarks.
- Tested end to end in Chromium 156, Safari 26.5 and iOS Safari 26.5 (simulator) with H.264 (B-frames,
  edit lists), HEVC, HEVC 10-bit HDR, rotated portrait video, variable frame rate, VP9, AV1, MKV and
  long-GOP screen recordings.
- iOS: hidden decoding players now buffer (explicit `load()`), so thumbnails start in well under a second
  instead of after a 15 s fallback.
- Safari/iOS: thumbnails wait for the target frame to be presented (`requestVideoFrameCallback`) and the
  decoder is primed once, which prevents stale frames.
