# Teams Graph API Recording Bot

Official Microsoft Graph API implementation for Teams meeting recording.

## Prerequisites

1. **.NET 8.0 SDK** - Download from https://dotnet.microsoft.com/download
2. **Azure AD App** with permissions (see main README)
3. **ngrok** for public URL (https://ngrok.com/download)

## Setup

### 1. Install .NET 8.0

Check if installed:
```bash
dotnet --version
```

If not installed, download from: https://dotnet.microsoft.com/download

### 2. Configure .env

Copy `.env.sample` to `.env` and fill in:
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- After running ngrok, update `BOT_PUBLIC_URL`

### 3. Restore packages

```bash
cd bot-graph-media
dotnet restore
```

### 4. Run the bot

```bash
dotnet run
```

Server starts on: http://localhost:5000

### 5. Start ngrok (in separate terminal)

```bash
ngrok http 5000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`) and update `.env`:
```
BOT_PUBLIC_URL=https://abc123.ngrok.io
SERVICE_FQDN=abc123.ngrok.io
```

Restart the bot after updating.

## Usage

### Create a bot (join meeting)

```bash
curl -X POST http://localhost:5000/api/v1/bot \
  -H "Content-Type: application/json" \
  -d '{
    "meeting_url": "https://teams.microsoft.com/meet/...",
    "bot_name": "Recording Bot"
  }'
```

Response:
```json
{
  "id": "bot-uuid",
  "status": "created"
}
```

### Check bot status

```bash
curl http://localhost:5000/api/v1/bot/{bot-id}
```

## API Endpoints

- `POST /api/v1/bot` - Create bot and join meeting
- `GET /api/v1/bot/:id` - Get bot status
- `GET /health` - Health check

## Current Status

✅ REST API working
✅ Azure AD authentication
✅ Meeting URL parsing
⚠️  Graph Communications API call - needs completion

## Next Steps

To complete implementation:

1. Add Communications API permissions in Azure
2. Grant admin consent
3. Implement actual call join in `GraphBotService.cs`
4. Add media stream handling
5. Add recording to file

See: https://learn.microsoft.com/en-us/graph/api/application-post-calls
