import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { store } from '../lib/store';
import { BotOrchestrator } from '../bot/orchestrator';
import {
  CreateBotRequest,
  BotResponse,
  RecordingResponse,
  BotState,
} from '../lib/types';

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 3000;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildBotResponse(bot: BotState): BotResponse {
  const now = new Date().toISOString();
  const recordings: RecordingResponse[] = [];

  if (bot.recording_id) {
    const rec: RecordingResponse = {
      id: bot.recording_id,
      created_at: bot.started_at ?? bot.created_at,
      started_at: bot.started_at,
      completed_at: bot.completed_at,
      status: {
        code: bot.status === 'done' ? 'done' : bot.status === 'fatal' ? 'fatal' : 'in_progress',
        sub_code: bot.sub_code,
        updated_at: now,
      },
      media_shortcuts: {},
    };

    // Video download URL (served from our local file server)
    if (bot.recording_file && fs.existsSync(bot.recording_file)) {
      rec.media_shortcuts.video_mixed = {
        id: uuidv4(),
        status: { code: 'done', sub_code: null, updated_at: now },
        data: {
          download_url: `${BASE_URL}/api/v1/download/recording/${bot.id}`,
        },
        format: 'mp4',
      };
    }

    // Transcript download URL
    if (bot.transcript_id && bot.transcript_file && fs.existsSync(bot.transcript_file)) {
      rec.media_shortcuts.transcript = {
        id: bot.transcript_id,
        status: { code: 'done', sub_code: null, updated_at: now },
        data: {
          download_url: `${BASE_URL}/api/v1/download/transcript/${bot.id}`,
        },
        provider: { meeting_captions: {} },
      };
    }

    recordings.push(rec);
  }

  return {
    id: bot.id,
    meeting_url: bot.meeting_url,
    bot_name: bot.bot_name,
    status: {
      code: bot.status,
      sub_code: bot.sub_code,
      updated_at: now,
    },
    created_at: bot.created_at,
    recordings,
    metadata: bot.metadata,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/bot  — Create & launch a bot
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/v1/bot', (req: Request, res: Response) => {
  const body = req.body as CreateBotRequest;

  if (!body.meeting_url) {
    return res.status(400).json({ error: 'meeting_url is required' });
  }

  const botId = uuidv4();
  const now = new Date().toISOString();

  const bot: BotState = {
    id: botId,
    meeting_url: body.meeting_url,
    bot_name: body.bot_name ?? 'Notetaker',
    status: 'joining_call',
    sub_code: null,
    created_at: now,
    started_at: null,
    completed_at: null,
    recording_id: null,
    transcript_id: null,
    recording_file: null,
    transcript_file: null,
    webhook_urls: body.webhook_url ? [body.webhook_url] : [],
    metadata: body.metadata ?? {},
  };

  store.set(bot);

  // Launch bot in the background — do not await
  const orchestrator = new BotOrchestrator(botId);
  orchestrator.launch().catch((err) => {
    console.error(`[${botId}] Unhandled orchestrator error:`, err);
  });

  // Return immediately — same as Recall.ai
  res.status(201).json(buildBotResponse(bot));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/bot/:id  — Get bot status + recording links
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/bot/:id', (req: Request, res: Response) => {
  const bot = store.get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json(buildBotResponse(bot));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/bot  — List all bots
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/bot', (_req: Request, res: Response) => {
  const bots = store.list().map(buildBotResponse);
  res.json({ results: bots, count: bots.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/download/recording/:id  — Stream the MP4
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/download/recording/:id', (req: Request, res: Response) => {
  const bot = store.get(req.params.id);
  if (!bot?.recording_file || !fs.existsSync(bot.recording_file)) {
    return res.status(404).json({ error: 'Recording not available yet' });
  }

  const filePath = path.resolve(bot.recording_file);
  const stat = fs.statSync(filePath);

  // Output is WebM (VP8/VP9 + Opus) — direct from WebRTC MediaRecorder
  const isWebm = filePath.endsWith('.webm');
  res.setHeader('Content-Type', isWebm ? 'video/webm' : 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="recording-${bot.id}.${isWebm ? 'webm' : 'mp4'}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/download/transcript/:id  — Return JSON transcript
// (matches Recall.ai transcript download schema exactly)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/download/transcript/:id', (req: Request, res: Response) => {
  const bot = store.get(req.params.id);
  if (!bot?.transcript_file || !fs.existsSync(bot.transcript_file)) {
    return res.status(404).json({ error: 'Transcript not available yet' });
  }

  const raw = fs.readFileSync(bot.transcript_file, 'utf-8');
  res.setHeader('Content-Type', 'application/json');
  res.send(raw);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/bot/:id  — Remove a bot record
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/api/v1/bot/:id', (req: Request, res: Response) => {
  const bot = store.get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  // In a real system you'd also kill the container here
  res.status(204).send();
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🤖 Recall.ai Clone API running at ${BASE_URL}`);
  console.log('─────────────────────────────────────────');
  console.log(`  POST   ${BASE_URL}/api/v1/bot         ← create bot`);
  console.log(`  GET    ${BASE_URL}/api/v1/bot/:id     ← get bot status`);
  console.log(`  GET    ${BASE_URL}/api/v1/bot         ← list all bots`);
  console.log(`  GET    ${BASE_URL}/api/v1/download/recording/:id`);
  console.log(`  GET    ${BASE_URL}/api/v1/download/transcript/:id`);
  console.log('─────────────────────────────────────────\n');
});
