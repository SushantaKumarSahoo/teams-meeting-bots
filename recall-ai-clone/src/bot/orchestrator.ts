import { Browser, chromium, Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../lib/logger';
import { Notifier } from '../lib/notifier';
import { store } from '../lib/store';
import { JoinProcedure } from './join';
import { CaptionsProcedure } from './captions';
import { RecordingProcedure } from './recording';
import { BotStatus, BotStatusChangeEvent } from '../lib/types';

export class BotOrchestrator {
  private botId: string;
  private logger: Logger;
  private notifier: Notifier;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(botId: string) {
    this.botId = botId;
    this.logger = new Logger({ botId, source: 'orchestrator' });
    const bot = store.get(botId);
    this.notifier = new Notifier({ botId, urls: bot?.webhook_urls ?? [] });
  }

  // ── Status helpers ──────────────────────────────────────────────────────────

  private async _setStatus(code: BotStatus, sub_code: string | null = null): Promise<void> {
    const updated_at = new Date().toISOString();
    store.update(this.botId, { status: code, sub_code });
    this.logger.info(`Status → ${code}${sub_code ? ` (${sub_code})` : ''}`);

    const event: BotStatusChangeEvent = {
      event: `bot.${code}`,
      data: {
        data: { code, sub_code, updated_at },
        bot: { id: this.botId, metadata: store.get(this.botId)?.metadata ?? {} },
      },
    };
    await this.notifier.send(event);
  }

  // ── Browser ─────────────────────────────────────────────────────────────────

  private async _launchBrowser(): Promise<void> {
    this.logger.info('Launching browser...');

    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Allow autoplay and media capture without user gesture
        '--autoplay-policy=no-user-gesture-required',
        // Fake media so Teams doesn't block the bot's camera/mic negotiation
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--window-size=1280,720',
      ],
    });

    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      // Grant mic + camera so the WebRTC negotiation completes (we fake the devices above)
      permissions: ['camera', 'microphone'],
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    this.page = await context.newPage();

    // Block Teams' native app deep-link dialogs
    await context.route('msteams://**', (route) => route.abort());

    // Forward browser console to Node stdout for debugging
    this.page.on('console', (msg) => {
      if (msg.text().startsWith('[recorder]')) {
        this.logger.info('PAGE: ' + msg.text());
      }
    });

    // Hide the webdriver flag
    await this.page.addInitScript(() => {
      Object.defineProperty((window as any).navigator, 'webdriver', { get: () => undefined });
    });
  }

  // ── Main lifecycle ───────────────────────────────────────────────────────────

  public async launch(): Promise<void> {
    const bot = store.get(this.botId);
    if (!bot) throw new Error(`Bot ${this.botId} not found`);

    const recordingId = uuidv4();
    const transcriptId = uuidv4();
    store.update(this.botId, { recording_id: recordingId, transcript_id: transcriptId });

    let recording: RecordingProcedure | null = null;
    let captions: CaptionsProcedure | null = null;

    try {
      await this._setStatus('joining_call');
      await this._launchBrowser();

      // ── Step 1: Prepare recording + inject interceptor BEFORE navigation ──
      recording = new RecordingProcedure({ botId: this.botId, page: this.page! });
      await recording.prepare();
      await recording.injectInterceptor();

      // ── Step 2: Navigate and join ─────────────────────────────────────────
      const join = new JoinProcedure({ page: this.page!, botId: this.botId, botName: bot.bot_name });
      await join.run({ meetingUrl: bot.meeting_url, botName: bot.bot_name });

      // Check waiting room
      const inWaiting = await join.waitForWaitingRoom(20000);
      if (inWaiting) await this._setStatus('in_waiting_room');

      // Wait up to 5 min to be admitted
      const admitted = await join.waitForAdmission(300000);
      if (!admitted) {
        await this._setStatus('fatal', 'admission_timeout');
        await this._cleanup();
        return;
      }

      await this._setStatus('in_call_not_recording');

      // ── Step 3: Mark recording start time + force recorder restart ────────
      // Tracks collected in the lobby may be muted/inactive. After admission
      // Teams negotiates fresh live tracks — trigger a recorder restart now.
      const startTime = new Date();
      store.update(this.botId, { started_at: startTime.toISOString() });

      // Give Teams 3 seconds to complete the post-admission renegotiation
      await this.page!.waitForTimeout(3000);
      await this.page!.evaluate(() => {
        if ((window as any).__restartRecorder__) {
          (window as any).__restartRecorder__();
        }
      });

      await this._setStatus('in_call_recording');

      // ── Step 4: Enable captions / transcript ─────────────────────────────
      captions = new CaptionsProcedure({
        page: this.page!,
        botId: this.botId,
        recordingId,
        transcriptId,
        notifier: this.notifier,
        startTime,
      });

      let captionsEnabled = false;
      try {
        await captions.enable();
        captionsEnabled = true;
        this.logger.info('Captions enabled successfully');
      } catch (err) {
        this.logger.warn('Failed to enable captions (continuing with recording only)', err);
      }

      if (captionsEnabled) {
        try {
          // Add a timeout to caption subscription to prevent hanging
          await Promise.race([
            captions.subscribe(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Caption subscription timeout')), 10000))
          ]);
          this.logger.info('Caption subscription active');
        } catch (err) {
          this.logger.warn('Failed to subscribe to captions (continuing with recording only)', err);
        }
      }

      // ── Step 5: Wait for call to end ──────────────────────────────────────
      this.logger.info('Bot is now recording. Will continue until call ends or manual stop...');
      
      if (this.page && !this.page.isClosed()) {
        await this._watchForCallEnd(join);
      }

      await this._setStatus('call_ended');

      // ── Step 7: Finalize outputs ──────────────────────────────────────────
      let recordingFile: string | null = null;
      if (recording) {
        try {
          recordingFile = await recording.stop();
          store.update(this.botId, { recording_file: recordingFile });
        } catch (err) {
          this.logger.error('Recording stop failed', err);
        }
      }

      if (captions) {
        captions.finalize();
        store.update(this.botId, {
          transcript_file: captions.getTranscriptPath(),
          completed_at: new Date().toISOString(),
        });
      }

      await this._setStatus('done');
    } catch (err) {
      this.logger.error('Bot fatal error', err);
      await this._setStatus('fatal', 'unhandled_exception').catch(() => {});
    } finally {
      // ── Cleanup: Always finalize recording/captions even on force-stop ───
      if (recording) {
        try {
          const recordingFile = await recording.stop();
          store.update(this.botId, { recording_file: recordingFile });
          this.logger.info('Recording finalized in cleanup');
        } catch (err) {
          this.logger.warn('Failed to finalize recording in cleanup', err);
        }
      }
      
      if (captions) {
        try {
          captions.finalize();
          this.logger.info('Captions finalized in cleanup');
        } catch (err) {
          this.logger.warn('Failed to finalize captions in cleanup', err);
        }
      }

      await this._cleanup();
    }
  }

  /** Poll every 5s — detect call end and auto-rejoin on drops */
  private async _watchForCallEnd(join: JoinProcedure): Promise<void> {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        if (!this.page || this.page.isClosed()) {
          clearInterval(interval);
          resolve();
          return;
        }

        try {
          // Take periodic screenshot for debugging
          await this.page.screenshot({ 
            path: `output/logs/${this.botId}-debug.png`,
            timeout: 5000 
          }).catch(() => {});

          // Check for rejoin button
          const rejoinBtn = this.page.getByRole('button', { name: /Rejoin call/i });
          const isRejoinVisible = await rejoinBtn.isVisible({ timeout: 500 }).catch(() => false);
          
          if (isRejoinVisible) {
            this.logger.warn('Call dropped — attempting rejoin');
            await rejoinBtn.click({ timeout: 5000 }).catch(() => {});
            return;
          }

          // Check if call has ended
          const callEnded = await join.hasCallEnded().catch(() => false);
          if (callEnded) {
            this.logger.info('Call ended');
            clearInterval(interval);
            resolve();
          }
        } catch (err) {
          // Ignore errors during watch - page might be transitioning
          this.logger.warn(`Watch error (non-fatal): ${String(err).slice(0, 100)}`);
        }
      }, 5000);
    });
  }

  private async _cleanup(): Promise<void> {
    try { if (this.browser) await this.browser.close(); } catch {}
    this.logger.info('Browser closed');
    this.logger.close();
  }
}
