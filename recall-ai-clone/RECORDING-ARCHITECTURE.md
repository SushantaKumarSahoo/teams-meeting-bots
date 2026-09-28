# Multi-Stream Recording Architecture

## Overview
This implementation captures **all Teams streams** perfectly using a dual-recorder approach:

1. **Main Recorder** → `{botId}.webm`
   - Participant cameras (gallery view)
   - Mixed audio from all participants
   - VP9/VP8 video + Opus audio

2. **Screen Share Recorder** → `{botId}-screenshare.webm`
   - Desktop/application shares
   - Higher bitrate for clarity
   - VP9/VP8 video only
   - Auto-created only when screen sharing detected

## How It Works

### Track Identification
The system automatically identifies track types:

```javascript
// Screen share detection
- Track label contains: "screen", "window", "monitor", "application"
- Track contentHint: "detail" or "text"

// Camera tracks
- All other video tracks (participant feeds)

// Audio tracks
- Mixed audio from all participants
```

### Recording Flow

1. **RTCPeerConnection Patch** intercepts all WebRTC tracks
2. **Track Collector** stores and logs each track with its metadata
3. **Smart Restart** triggers recorder refresh when:
   - New participants join (new camera tracks)
   - Screen sharing starts/stops
   - Bot is admitted from waiting room (lobby → live tracks)

4. **Dual Encoding**:
   - Main: 2.5 Mbps video + 128 kbps audio
   - Screen: 3 Mbps video (higher for text clarity)

5. **Chunk Delivery** via IPC:
   ```
   MediaRecorder.ondataavailable
     → Blob.arrayBuffer()
     → page.exposeFunction(__recorderChunk__ / __screenShareChunk__)
     → fs.WriteStream
   ```

## Output Files

- `output/recordings/{botId}.webm` - Main recording (always created)
- `output/recordings/{botId}-screenshare.webm` - Screen share (created only if detected)

## Advantages Over Single-Recorder

✅ **Captures ALL streams** - no missed participants or screen shares
✅ **Higher quality** - separate bitrates optimized for each content type
✅ **Recall.ai compatible** - matches their multi-file output pattern
✅ **Automatic detection** - no manual configuration needed
✅ **Efficient** - screen recorder only active when needed

## Debug Logging

Each track is logged with:
- `kind` - audio/video
- `id` - unique identifier
- `label` - track description (includes "screen", "camera", etc.)
- `readyState` - live/ended
- `contentHint` - optimization hint (detail/motion/text)

Example log:
```
Track collected: kind=video id=af9c7943 label=camera:participant1 readyState=live total=3
Track collected: kind=video id=8ced8d0c label=screen:desktop readyState=live total=4
Starting MAIN recorder: camera=af9c7943 audio=141af4de
Starting SCREEN recorder: 8ced8d0c label=screen:desktop
```
ca