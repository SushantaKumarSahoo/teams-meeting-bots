# Recording Fixes Summary

## Issues Fixed

### 1. ✅ Camera PiP not showing during screen share
**Root Cause**: PiP camera reference was captured in closure incorrectly
**Fix**: 
- Store `pipCamera` reference outside the `drawMainFrame` closure
- Add proper error handling for PiP drawing
- Add visual enhancements: semi-transparent shadow and thicker border
- Log when PiP is enabled

**Result**: Camera now appears as Picture-in-Picture overlay (bottom-right, 25% width) when screen sharing

### 2. ✅ Browser closing prematurely (23-second recordings)
**Root Cause**: Multiple issues causing crashes
**Fixes**:
- **Caption subscription error**: Fixed `cls.toLowerCase()` TypeError by checking `typeof el.className === 'string'`
- **Better error handling**: Split caption enable/subscribe into separate try-catch blocks
- **Robust timeouts**: Wrapped `page.waitForTimeout()` with error handling that checks if page is closed
- **Better watch loop**: Added timeout and error handling to `_watchForCallEnd()` to prevent crashes

**Result**: Bot now records for full 2-minute duration (or until call ends naturally)

### 3. ✅ WebM playback issues (streaming format)
**Root Cause**: WebM files using MediaRecorder API may not be seekable/compatible
**Fix**: 
- Added FFmpeg post-processing to convert WebM → MP4
- MP4 settings:
  - H.264 video codec (libx264)
  - AAC audio codec
  - CRF 23 quality
  - Fast preset for speed
  - `+faststart` flag for progressive download/streaming
- Original WebM deleted after successful conversion
- Fallback to WebM if conversion fails

**Result**: Recordings are now MP4 files with better compatibility and seekability

### 4. ✅ Audio capture improvement
**Fix**: Changed audio capture to include both camera AND screen video elements
**Result**: Screen share system audio is now captured

### 5. ✅ Video detection improvements
**Enhancements**:
- Improved screen share detection: videos >= 1280x720 automatically treated as screens
- Reduced debounce time from 1.5s to 500ms for faster response to video changes
- Added detailed logging with parent element attributes for debugging
- Better lobby video filtering

**Result**: More accurate detection of screen shares vs cameras

## Installation Steps

1. **Install FFmpeg** (required for MP4 conversion):
   ```bash
   # Windows (Chocolatey)
   choco install ffmpeg

   # Or see INSTALL-FFMPEG.md for other methods
   ```

2. **Install Node dependencies**:
   ```bash
   cd recall-ai-clone
   npm install
   ```

3. **Verify FFmpeg**:
   ```bash
   ffmpeg -version
   ```

4. **Run the bot**:
   ```bash
   npm run dev
   ```

## New Dependencies

Added to `package.json`:
- `fluent-ffmpeg`: ^2.1.3 (MP4 conversion)
- `@types/fluent-ffmpeg`: ^2.1.26 (TypeScript types)

## Output Changes

**Before**: `output/recordings/<bot-id>.webm`
**After**: `output/recordings/<bot-id>.mp4` (WebM automatically deleted)

## Testing Checklist

- [x] Camera-only recording works
- [x] Screen share detection works (1920x1080, 1280x720)
- [x] PiP mode shows camera overlay during screen share
- [x] Recording duration >= 2 minutes
- [x] MP4 conversion completes successfully
- [x] MP4 file is seekable and plays smoothly
- [x] Audio from both camera and screen is captured
- [x] Caption errors don't crash the bot

## Known Limitations

1. **FFmpeg must be installed**: The bot will fail if FFmpeg is not in PATH
2. **Conversion time**: MP4 conversion adds ~10-30 seconds after recording ends
3. **Disk space**: Temporarily uses 2x space during conversion (WebM + MP4)
4. **Captions**: May not work if Teams UI changes selector structure

## Logs to Monitor

Look for these log messages to verify fixes:
- `PiP enabled: camera 320x180 overlaid on screen` ← PiP working
- `Detected: cameras=1 (320x180), screens=1 (1920x1080)` ← Correct detection
- `Converting WebM to MP4...` ← Conversion starting
- `Conversion progress: 50.0%` ← FFmpeg progress
- `MP4 conversion complete` ← Success
- `Bot will stay in meeting for 2 minutes...` ← Full duration

## Troubleshooting

**Issue**: "ffmpeg not found" error
**Solution**: Install FFmpeg and ensure it's in your system PATH

**Issue**: Recording still stops early
**Solution**: Check logs for page closure errors, may be network/Teams issue

**Issue**: PiP not showing
**Solution**: Check logs for "Detected: cameras=X, screens=Y" to verify detection

**Issue**: MP4 file is corrupted
**Solution**: Check if WebM file exists, FFmpeg may have failed (logs will show error)
