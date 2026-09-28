# Testing Guide

## Pre-flight Checks

1. ✅ FFmpeg installed: `ffmpeg -version`
2. ✅ Dependencies installed: `npm install`
3. ✅ No TypeScript errors: Files compile successfully

## Test Scenarios

### Scenario 1: Camera Only Recording
**Expected**:
- Logs show: `Detected: cameras=1 (640x360), screens=0 ()`
- Canvas: `640x360, base=camera, hasCam=true, hasScreen=false`
- No PiP overlay
- Recording duration: 2+ minutes
- MP4 file created successfully

### Scenario 2: Screen Share Only
**Expected**:
- Logs show: `Detected: cameras=0 (), screens=1 (1920x1080)`
- Canvas: `1920x1080, base=screen, hasCam=false, hasScreen=true`
- No PiP overlay
- Recording captures screen content
- MP4 file created successfully

### Scenario 3: Screen Share + Camera (PiP Mode)
**Expected**:
- Logs show: `Detected: cameras=1 (320x180), screens=1 (1920x1080)`
- Canvas: `1920x1080, base=screen, hasCam=true, hasScreen=true`
- **PiP log**: `PiP enabled: camera 320x180 overlaid on screen`
- Camera appears in bottom-right corner with white border
- PiP size: 25% of screen width
- MP4 file created successfully

### Scenario 4: Full Recording Session
**Expected flow**:
```
Status → joining_call
Launching browser...
Recording file opened
WebRTC interceptor injected
Bot admitted into meeting
Status → in_call_not_recording
__restartRecorder__ called
Status → in_call_recording
Captions enabled successfully
Caption subscription active
Bot will stay in meeting for 2 minutes...
[Recording continues for 2+ minutes]
Call ended
Converting WebM to MP4...
Conversion progress: [updates]
MP4 conversion complete
Status → done
```

## What to Watch For

### ✅ Good Signs
- `PiP enabled:` message when screen + camera detected
- `Conversion progress: X%` messages during MP4 conversion
- `MP4 conversion complete` at the end
- Recording file size > 1 MB
- Video duration matches meeting length
- PiP camera visible in video player

### ❌ Red Flags
- `Target page, context or browser has been closed` before 2 minutes
- `TypeError: cls.toLowerCase is not a function` (should be fixed)
- `Recording file is empty — no WebRTC chunks received`
- `ffmpeg not found` or `ENOENT: no such file or directory, stat`
- Recording stops at ~23 seconds (should be fixed)
- PiP not showing when both camera and screen present

## Manual Video Verification

1. Open the MP4 file in VLC or browser
2. Check video is seekable (drag timeline)
3. Verify audio plays correctly
4. If PiP mode, verify camera overlay is visible in bottom-right
5. Check video quality is acceptable

## Debugging Tips

### Issue: No video elements found
- Check Teams meeting is active
- Verify bot was admitted (not stuck in lobby)
- Look for "lobby videos found, waiting for meeting"

### Issue: PiP not showing
- Verify logs show both camera and screen detected
- Check `hasCam=true, hasScreen=true`
- Look for "PiP enabled" message
- Inspect MP4 file manually - white border should be visible

### Issue: Recording stops early
- Check for page closure errors in logs
- Verify caption errors are caught (not crashing)
- Look for "Bot fatal error" messages

### Issue: MP4 conversion fails
- Check FFmpeg is installed: `ffmpeg -version`
- Look for FFmpeg error in logs
- WebM file should exist as fallback

## Log Files Location

- **Recording**: `output/recordings/<bot-id>.mp4`
- **Transcript**: `output/transcripts/<bot-id>.json`
- **Logs**: `output/logs/<bot-id>.log`
- **Debug screenshot**: `output/logs/<bot-id>-debug.png`

## Performance Metrics

- **Join time**: ~30-60 seconds
- **Recording start**: ~3-5 seconds after admission
- **Minimum duration**: 2 minutes
- **MP4 conversion**: ~10-30 seconds for 2-minute video
- **File size**: ~20-50 MB for 2-minute 1080p recording
