# Changelog

## 0.1.0 (2026-11-24)

First release.

- `<video-timeline>` web component: thumbnail filmstrip, time ruler, playhead, click-to-seek,
  drag scrubbing, hover preview, zoom (wheel, pinch, keys) and scrolling, auto-follow during playback,
  keyboard control with frame stepping, touch support, light and dark themes, CSS variables and `::part`.
- `load(file)` to play a local file and decode thumbnails straight from it.
- React wrapper: `video-timeline/react`.
- Headless `Thumbnailer` API plus `TimeScale`, `computeTicks`, `SeekCoordinator`, `ThumbnailCache`.
- Keyframe-snapped thumbnails, with the decoder (WebCodecs or `<video>`) chosen per browser from benchmarks.
- Tested end to end in Chromium 156 and Safari 26.5 with H.264 (B-frames, edit lists), HEVC, HEVC 10-bit HDR,
  rotated portrait video, variable frame rate, VP9, AV1, MKV and long-GOP screen recordings.
