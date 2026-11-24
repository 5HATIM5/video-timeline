const DARK = `
  --video-timeline-bg: #16171b;
  --video-timeline-ruler-bg: #1c1e23;
  --video-timeline-track-bg: #24262d;
  --video-timeline-text: #aeb3be;
  --video-timeline-tick: #444852;
  --video-timeline-playhead: #ff3b5c;
  --video-timeline-hover: rgba(255, 255, 255, 0.6);
  --video-timeline-focus: #5b9dff;
  --video-timeline-tooltip-bg: rgba(20, 21, 25, 0.94);
  --video-timeline-tooltip-text: #f1f2f5;
  --video-timeline-separator: rgba(0, 0, 0, 0.35);
  color-scheme: dark;
`;

const LIGHT = `
  --video-timeline-bg: #f3f4f6;
  --video-timeline-ruler-bg: #eaecef;
  --video-timeline-track-bg: #dcdfe5;
  --video-timeline-text: #4b5262;
  --video-timeline-tick: #b2b7c1;
  --video-timeline-playhead: #e11d48;
  --video-timeline-hover: rgba(0, 0, 0, 0.5);
  --video-timeline-focus: #2563eb;
  --video-timeline-tooltip-bg: rgba(255, 255, 255, 0.97);
  --video-timeline-tooltip-text: #1c1f26;
  --video-timeline-separator: rgba(255, 255, 255, 0.45);
  color-scheme: light;
`;

export const styles = /* css */ `
:host {
  ${DARK}
  --video-timeline-strip-height: 56px;
  --video-timeline-ruler-height: 22px;
  --video-timeline-radius: 8px;
  --video-timeline-font: 500 10px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  display: block;
  position: relative;
  min-width: 120px;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
:host([theme="light"]) { ${LIGHT} }
@media (prefers-color-scheme: light) {
  :host(:not([theme])), :host([theme="auto"]) { ${LIGHT} }
}
:host([hidden]) { display: none; }

.root {
  position: relative;
  background: var(--video-timeline-bg);
  border-radius: var(--video-timeline-radius);
  overflow: hidden;
}
.viewport {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--video-timeline-tick) transparent;
  overscroll-behavior-x: contain;
}
.content { position: relative; }
.stage {
  position: sticky;
  left: 0;
  height: calc(var(--video-timeline-ruler-height) + var(--video-timeline-strip-height));
}
canvas { display: block; }
.ruler { height: var(--video-timeline-ruler-height); width: 100%; }
.strip { height: var(--video-timeline-strip-height); width: 100%; }
:host([ruler="false"]) .ruler { display: none; }
:host([ruler="false"]) .stage { height: var(--video-timeline-strip-height); }

.track {
  position: absolute;
  inset: 0;
  cursor: pointer;
  touch-action: pan-y pinch-zoom;
  outline: none;
  border-radius: var(--video-timeline-radius);
}
.track:focus-visible { box-shadow: inset 0 0 0 2px var(--video-timeline-focus); }

.playhead, .hover {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
  will-change: transform;
}
.playhead { width: 2px; margin-left: -1px; background: var(--video-timeline-playhead); }
.playhead::before {
  content: "";
  position: absolute;
  top: 0;
  left: -5px;
  width: 12px;
  height: 12px;
  background: var(--video-timeline-playhead);
  border-radius: 2px 2px 6px 6px;
}
:host([ruler="false"]) .playhead::before { display: none; }
.hover { width: 1px; background: var(--video-timeline-hover); opacity: 0; transition: opacity 0.12s; }
.hover.on { opacity: 1; }

.tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 10;
  padding: 4px;
  border-radius: 8px;
  background: var(--video-timeline-tooltip-bg);
  color: var(--video-timeline-tooltip-text);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(127, 127, 127, 0.18);
  pointer-events: none;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.12s, transform 0.12s;
  font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
}
.tooltip.on { opacity: 1; transform: none; }
.tooltip canvas { border-radius: 5px; margin-bottom: 4px; background: var(--video-timeline-track-bg); }
.tooltip canvas[hidden] { display: none; }
.tooltip .time { display: block; padding: 2px 4px 1px; }
:host([tooltip="false"]) .tooltip { display: none; }

.status {
  position: absolute;
  left: 8px;
  bottom: 6px;
  font: var(--video-timeline-font);
  color: var(--video-timeline-text);
  opacity: 0.8;
  pointer-events: none;
}
`;
