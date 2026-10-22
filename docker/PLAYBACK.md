# Movie playback optimization

The movie browser now stops and unloads a recording when navigating or closing
the player. It requests video only after Play is pressed. Preview failures and
a 15-second preview timeout leave navigation available.

Local previews run outside the HTTP event loop. FFprobe has a 10-second timeout;
each thumbnail extraction has a 15-second timeout. Thumbnails are published
atomically, so readers cannot receive a partially written JPEG.

After Motion reports `movie_end`, the background worker moves a completed MP4's
index to the beginning (`faststart`) before preparing its preview. This copies
compressed packets without changing video quality. Already optimized files are
skipped. A failed remux leaves the recording intact; a recording that changes
during the operation is also left intact. This requires temporary disk space
roughly equal to the recording size. Non-MP4 files are unchanged.

Playback supports HTTP Range and HEAD without hashing the entire recording.
The main JavaScript URL uses a content hash to invalidate browser caches even
when the motionEye version number stays the same.

## Existing recordings

The four local sample recordings were converted to H.264, CRF 20, yuv420p and
faststart for browser compatibility. Re-encoding is lossy; originals remain in
`videos/`, and the converted copies are in `videos/optimized/`. In the local
Docker data volume, originals are backed up under
`/var/lib/motioneye/originals-before-playback-optimization/`, outside Camera1's
recording directory. The converted files retain the original names and dates.

To reproduce a conversion into a separate file:

```sh
ffmpeg -nostdin -i input.mp4 -map 0:v:0 -map '0:a?' \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -fps_mode passthrough -enc_time_base demux \
  -c:a aac -b:a 128k -movflags +faststart output.mp4
```

New recordings keep the codec selected in the camera's Movies settings. The
background optimization does not automatically transcode H.265 into H.264.

## Apply code changes locally

```sh
docker compose -f compose.dev.yaml up -d --build motioneye
```

The local Docker deployment and a Home Assistant add-on are separate installs.
The Home Assistant installation needs this updated code deployed separately.
