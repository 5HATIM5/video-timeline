import { Input, BlobSource, CanvasSink, MP4, QTFF, WEBM, MATROSKA } from 'mediabunny';
export async function thumbs(blob, ts) {
  const input = new Input({ formats: [MP4, QTFF, WEBM, MATROSKA], source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  const sink = new CanvasSink(track, { width: 160, height: 90, fit: 'cover' });
  const out = [];
  for await (const c of sink.canvasesAtTimestamps(ts)) out.push(c);
  return out;
}
