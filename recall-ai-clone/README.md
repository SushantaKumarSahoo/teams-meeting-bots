# Recall.ai Clone

Self-hosted meeting bot — recording + real-time transcript — with an API that matches Recall.ai exactly.

## What it does

| Feature | Details |
|---|---|
| **Recording** | Captures the meeting as a single mixed MP4 via FFmpeg + Xvfb |
| **Transcript** | Reads Teams live captions via DOM MutationObserver, saved as JSON |
| **Real-time webhooks** | Sends `bot.joining_call`, `bot.in_waiting_room`, `bot.in_call_recording`, `transcript.data`, `bot.done` events to your URL |
| **REST API** | Identical to Recall.ai — same routes, same response shapes |

---

## Prerequisites

### System Requirements

1. **Node.js 18+** - Download from https://nodejs.org/
2. **FFmpeg** - Required for MP4 video conversion
   - See [INSTALL-FFMPEG.md](./INSTALL-FFMPEG.md) for installation instructions
   - Verify with: `ffmpeg -version`
3. **Docker** (optional) - For containerized deployment

### Installation

```bash
# Install dependencies
npm install

# Verify FFmpeg is available
ffmpeg -version
```

---

## Quick start (Docker)

```bash
# 1. Build & run
docker compose up --build

# 2. Send a bot to a meeting
curl -X POST http://localhost:3000/api/v1/bot \
  -H "Content-Type: application/json" \
  -d '{
    "meeting_url": "https://teams.microsoft.com/meet/...",
    "bot_name": "Notetaker",
    "webhook_url": "https://your-server.com/webhook"
  }'

# Response — same shape as Recall.ai:
# { "id": "uuid", "status": { "code": "joining_call" }, "recordings": [], ... }

# 3. Poll bot status
curl http://localhost:3000/api/v1/bot/<id>

# 4. After the call — download recording
curl http://localhost:3000/api/v1/download/recording/<id> -o meeting.mp4

# 5. Download transcript (Recall.ai format)
curl http://localhost:3000/api/v1/download/transcript/<id>
```

---

## Transcript format

Matches Recall.ai's download schema exactly:

```json
[
  {
    "participant": { "id": 100, "name": "Alice", "is_host": null, "platform": "desktop", "extra_data": null, "email": null },
    "words": [
      {
        "text": "Hello everyone.",
        "start_timestamp": { "relative": 12.4, "absolute": "2026-09-26T10:00:12.400Z" },
        "end_timestamp":   { "relative": 14.1, "absolute": "2026-09-26T10:00:14.100Z" }
      }
    ]
  }
]
```

## Webhook events (real-time)

Your `webhook_url` receives POST requests as the bot progresses:

```
bot.joining_call → bot.in_waiting_room → bot.in_call_recording → transcript.data (per utterance) → bot.done
```

## Files produced per bot (in `output/`)

```
output/recordings/<bot-id>.mp4        ← full meeting video
output/transcripts/<bot-id>.json      ← full transcript in Recall.ai format
output/logs/<bot-id>.log              ← bot activity log
output/logs/<bot-id>-debug.png        ← last screenshot (for debugging)
```
