import { Input, BlobSource, EncodedPacketSink, MP4, QTFF, WEBM, MATROSKA } from 'mediabunny';
export async function keyframes(blob, ts) {
  const input = new Input({ formats: [MP4, QTFF, WEBM, MATROSKA], source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  const sink = new EncodedPacketSink(track);
  const out = [];
  for (const t of ts) out.push((await sink.getKeyPacket(t, { metadataOnly: true }))?.timestamp);
  return { out, d: await input.computeDuration() };
}
