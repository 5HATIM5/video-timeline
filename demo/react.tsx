import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatTime } from 'video-timeline-scrubber';
import { VideoTimeline, type VideoTimelineElement } from 'video-timeline-scrubber/react';
import { SAMPLES, sampleFile } from './samples.js';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<VideoTimelineElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [height, setHeight] = useState(56);
  const [lastSeek, setLastSeek] = useState<number | null>(null);
  const [info, setInfo] = useState('No video loaded.');

  // Plain React: the app owns the object URL, and passes the File as `source` for decoding.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  return (
    <main>
      <header>
        <h1>video-timeline-scrubber / react</h1>
        <p>{'<VideoTimeline video={videoRef} source={file} />'}</p>
        <a href="./index.html">← Web component version</a>
      </header>

      <section className={`card${file ? ' has-video' : ''}`}>
        <div className="player">
          <video ref={videoRef} src={url} controls playsInline />
          <div className="drop">
            <strong>Pick a video</strong>
            <label>
              Choose a file
              <input type="file" accept="video/*,.mkv,.mov" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        <VideoTimeline
          ref={timelineRef}
          video={videoRef}
          source={file}
          height={height}
          onReady={({ duration, engine }) => setInfo(`${file?.name} · ${formatTime(duration)} · engine: ${engine ?? 'none'}`)}
          onSeek={setLastSeek}
        />

        <div className="toolbar">
          <button onClick={() => timelineRef.current?.zoomOut()}>−</button>
          <button onClick={() => timelineRef.current?.zoomToFit()}>Fit</button>
          <button onClick={() => timelineRef.current?.zoomIn()}>+</button>
          <span className="spacer" />
          <label>
            Height{' '}
            <select value={height} onChange={(e) => setHeight(Number(e.target.value))}>
              {[40, 56, 72, 96].map((h) => <option key={h}>{h}</option>)}
            </select>
          </label>
        </div>
        <div className="meta">
          {info}
          {lastSeek !== null && ` · last seek ${formatTime(lastSeek, { decimals: 2 })}`}
        </div>
      </section>

      <div className="samples">
        Test files:
        {SAMPLES.map((s) => (
          <button key={s.path} data-path={s.path} onClick={async () => setFile(await sampleFile(s))}>
            {s.label}
          </button>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
