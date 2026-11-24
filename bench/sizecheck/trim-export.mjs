import { Input, Output, BlobSource, BufferTarget, Conversion, Mp4OutputFormat, MP4, QTFF, WEBM, MATROSKA } from 'mediabunny';
export async function trim(blob, start, end) {
  const input = new Input({ formats: [MP4, QTFF, WEBM, MATROSKA], source: new BlobSource(blob) });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const c = await Conversion.init({ input, output, trim: { start, end } });
  await c.execute();
  return output.target.buffer;
}
