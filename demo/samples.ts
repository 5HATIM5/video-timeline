/** Local test files from the spike (served from demo/public/samples, dev only). */
export const SAMPLES: { label: string; path: string; type: string }[] = [
  { label: '1080p · 10 min', path: 'fhd-10min-kf2.mp4', type: 'video/mp4' },
  { label: '4K · 3 min', path: 'uhd-3min-kf2.mp4', type: 'video/mp4' },
  { label: 'iPhone HEVC', path: 'real/iphone-hevc.mov', type: 'video/quicktime' },
  { label: 'HDR 10-bit', path: 'real/iphone-hevc-hdr10bit.mov', type: 'video/quicktime' },
  { label: 'Portrait', path: 'real/portrait-rot90.mp4', type: 'video/mp4' },
  { label: 'Variable fps', path: 'real/vfr.mp4', type: 'video/mp4' },
  { label: 'WebM VP9', path: 'real/vp9.webm', type: 'video/webm' },
  { label: 'AV1', path: 'real/av1.mp4', type: 'video/mp4' },
  { label: 'MKV (OBS)', path: 'real/obs.mkv', type: 'video/x-matroska' },
  { label: 'Screen rec, 20 s GOP', path: 'real/screenrec-gop20s.mp4', type: 'video/mp4' },
];

/** Fetch a sample as a File, exactly like a user upload. */
export async function sampleFile(sample: (typeof SAMPLES)[number]): Promise<File> {
  const res = await fetch(`./samples/${sample.path}`);
  if (!res.ok) throw new Error(`Couldn't load ${sample.path}: HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], sample.path.split('/').pop()!, { type: sample.type });
}
