#!/usr/bin/env bash
# Build "real-world shaped" fixtures from the barcode source video.
# Each file reproduces one thing phones, cameras, editors or recorders do that
# synthetic WebCodecs output doesn't: B-frames, HEVC/MOV, 10-bit HDR, rotation,
# variable frame rate, edit lists, WebM/VP9, AV1, Matroska, very long GOPs.
set -euo pipefail
cd "$(dirname "$0")"

SRC=fixtures/fhd-10min-kf2.mp4
OUT=fixtures/real
mkdir -p "$OUT"
FF=(ffmpeg -hide_banner -loglevel error -y)
TONE=(-f lavfi -t 120 -i "sine=frequency=440:sample_rate=48000")

step() { printf '%-28s' "$1"; local t0=$SECONDS; shift; "$@"; echo "ok ($((SECONDS - t0))s)"; }

# Camera/phone-style H.264: High profile, 3 B-frames, 1 s GOP, AAC audio, moov at the END
step h264-bframes.mp4 "${FF[@]}" -t 120 -i "$SRC" "${TONE[@]}" -map 0:v -map 1:a \
  -c:v libx264 -preset fast -profile:v high -bf 3 -g 30 -b:v 8M -c:a aac -b:a 128k -shortest "$OUT/h264-bframes.mp4"

# iPhone-style: HEVC from Apple's hardware encoder, hvc1 tag, QuickTime container, AAC
step iphone-hevc.mov "${FF[@]}" -t 120 -i "$SRC" "${TONE[@]}" -map 0:v -map 1:a \
  -c:v hevc_videotoolbox -tag:v hvc1 -b:v 8M -g 30 -c:a aac -shortest "$OUT/iphone-hevc.mov"

# iPhone HDR default: HEVC Main10, 10-bit, tagged HLG / BT.2020
step iphone-hevc-hdr10bit.mov "${FF[@]}" -t 120 -i "$SRC" \
  -c:v hevc_videotoolbox -profile:v main10 -pix_fmt p010le -tag:v hvc1 -b:v 10M -g 30 \
  -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc -an "$OUT/iphone-hevc-hdr10bit.mov"

# Portrait phone video: frames coded landscape + a 90° display matrix
step portrait-rot90.mp4 "${FF[@]}" -display_rotation 90 -i "$OUT/h264-bframes.mp4" -c copy "$OUT/portrait-rot90.mp4"

# Variable frame rate: irregularly dropped frames, original timestamps kept
step vfr.mp4 "${FF[@]}" -t 120 -i "$SRC" -vf "select='lt(mod(n\,30)\,18)+not(mod(n\,7))'" -fps_mode passthrough \
  -c:v libx264 -preset fast -bf 2 -g 30 -an "$OUT/vfr.mp4"

# Trimmed by an editor with stream copy: starts on a NON-keyframe -> MP4 edit list
step copycut-editlist.mp4 "${FF[@]}" -ss 12.3 -i "$OUT/h264-bframes.mp4" -t 60 -c copy "$OUT/copycut-editlist.mp4"

# Browser MediaRecorder / Android style: WebM, VP9 + Opus
step vp9.webm "${FF[@]}" -t 120 -i "$SRC" "${TONE[@]}" -map 0:v -map 1:a \
  -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -b:v 4M -g 60 -c:a libopus -shortest "$OUT/vp9.webm"

# AV1 in MP4 (newer Android phones, downloads)
step av1.mp4 "${FF[@]}" -t 120 -i "$SRC" -c:v libsvtav1 -preset 10 -g 60 -b:v 3M -an "$OUT/av1.mp4"

# OBS default: Matroska container (Safari's <video> can't play MKV)
step obs.mkv "${FF[@]}" -i "$OUT/h264-bframes.mp4" -c copy "$OUT/obs.mkv"

# Screen recording: 20 s GOP, no B-frames, faststart
step screenrec-gop20s.mp4 "${FF[@]}" -t 120 -i "$SRC" -c:v libx264 -preset fast -bf 0 -g 600 -keyint_min 600 \
  -sc_threshold 0 -movflags +faststart -an "$OUT/screenrec-gop20s.mp4"

echo
echo "file | codec/profile | pix_fmt | B-frames | rotation | start | fps (r / avg) | size"
for f in "$OUT"/*; do
  ffprobe -v error -select_streams v:0 -show_entries \
    stream=codec_name,profile,pix_fmt,has_b_frames,r_frame_rate,avg_frame_rate,start_time:stream_side_data=rotation \
    -of json "$f" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        const st=JSON.parse(s).streams[0]||{}; const rot=(st.side_data_list||[]).find(x=>"rotation" in x)?.rotation ?? 0;
        const f=process.argv[1]; const size=(require("fs").statSync(f).size/1e6).toFixed(1)+" MB";
        console.log([f.split("/").pop(), st.codec_name+"/"+st.profile, st.pix_fmt, st.has_b_frames, rot, st.start_time, st.r_frame_rate+" / "+st.avg_frame_rate, size].join(" | "));
      })' "$f"
done
