// ============================================================
// Recall.ai-compatible type definitions
// All shapes match the real Recall.ai API & webhook payloads
// ============================================================

export type BotStatus =
  | 'joining_call'
  | 'in_waiting_room'
  | 'in_call_not_recording'
  | 'in_call_recording'
  | 'call_ended'
  | 'done'
  | 'fatal';

export interface Participant {
  id: number;
  name: string | null;
  is_host: boolean | null;
  platform: string | null;   // "desktop" | "mobile" | "web"
  extra_data: Record<string, unknown> | null;
  email: string | null;
}

export interface Timestamp {
  relative: number;          // seconds since recording started
  absolute: string;          // ISO-8601
}

// One finalized transcript utterance (matches Recall.ai download schema)
export interface TranscriptWord {
  text: string;
  start_timestamp: Timestamp;
  end_timestamp: Timestamp | null;
}

export interface TranscriptEntry {
  participant: Participant;
  words: TranscriptWord[];
}

// ---- Webhook / realtime event payloads ----

export interface BotStatusChangeEvent {
  event: `bot.${BotStatus}`;
  data: {
    data: {
      code: BotStatus;
      sub_code: string | null;
      updated_at: string;
    };
    bot: { id: string; metadata: Record<string, unknown> };
  };
}

export interface TranscriptDataEvent {
  event: 'transcript.data' | 'transcript.partial_data';
  data: {
    data: {
      words: TranscriptWord[];
      language_code: string;
      participant: Participant;
    };
    transcript: { id: string; metadata: Record<string, unknown> };
    recording: { id: string; metadata: Record<string, unknown> };
    bot: { id: string; metadata: Record<string, unknown> };
  };
}

export interface ParticipantEvent {
  event: `participant_events.${string}`;
  data: {
    data: {
      participant: Participant;
      timestamp: Timestamp;
      data: unknown | null;
    };
    bot: { id: string; metadata: Record<string, unknown> };
  };
}

// ---- Bot state (internal) ----

export interface BotState {
  id: string;
  meeting_url: string;
  bot_name: string;
  status: BotStatus;
  sub_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  recording_file: string | null;    // local path
  transcript_file: string | null;   // local path
  webhook_urls: string[];
  metadata: Record<string, unknown>;
}

// ---- API request/response ----

export interface CreateBotRequest {
  meeting_url: string;
  bot_name?: string;
  webhook_url?: string;
  metadata?: Record<string, unknown>;
}

// Matches Recall.ai GET /api/v1/bot/:id response
export interface BotResponse {
  id: string;
  meeting_url: string;
  bot_name: string;
  status: { code: BotStatus; sub_code: string | null; updated_at: string };
  created_at: string;
  recordings: RecordingResponse[];
  metadata: Record<string, unknown>;
}

export interface RecordingResponse {
  id: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  status: { code: string; sub_code: string | null; updated_at: string };
  media_shortcuts: {
    video_mixed?: {
      id: string;
      status: { code: string; sub_code: string | null; updated_at: string };
      data: { download_url: string } | null;
      format: 'mp4';
    };
    transcript?: {
      id: string;
      status: { code: string; sub_code: string | null; updated_at: string };
      data: { download_url: string } | null;
      provider: { meeting_captions: Record<string, never> };
    };
  };
}
