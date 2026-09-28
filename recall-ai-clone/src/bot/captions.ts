import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { Logger } from '../lib/logger';
import { Notifier } from '../lib/notifier';
import { TranscriptEntry, TranscriptWord, Participant, TranscriptDataEvent } from '../lib/types';

/**
 * Enables Teams live captions and scrapes them via DOM MutationObserver.
 * Emits Recall.ai-compatible transcript.data events in real-time.
 * Saves a final transcript.json that matches Recall.ai's download schema exactly.
 */
export class CaptionsProcedure {
  private page: Page;
  private logger: Logger;
  private notifier: Notifier | null;
  private botId: string;
  private recordingId: string;
  private transcriptId: string;
  private startTime: Date;
  private transcriptPath: string;
  private entries: TranscriptEntry[] = [];
  private participantCounter = 100;
  private participantMap = new Map<string, number>(); // name -> id

  constructor(args: {
    page: Page;
    botId: string;
    recordingId: string;
    transcriptId: string;
    notifier: Notifier | null;
    startTime: Date;
  }) {
    this.page = args.page;
    this.botId = args.botId;
    this.recordingId = args.recordingId;
    this.transcriptId = args.transcriptId;
    this.notifier = args.notifier;
    this.startTime = args.startTime;
    this.logger = new Logger({ botId: args.botId, source: 'captions' });

    const dir = path.resolve('output/transcripts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.transcriptPath = path.join(dir, `${args.botId}.json`);
  }

  /** Open the More menu and click "Turn on live captions" */
  public async enable(): Promise<void> {
    this.logger.info('Enabling live captions...');
    try {
      // Try multiple selectors for the "More actions" button — Teams UI changes often
      const moreSelectors = [
        'button[id="callingButtons-showMoreBtn"]',
        'button[aria-label="More actions"]',
        'button[aria-label="More"]',
        'button[data-tid="callingButtons-showMoreBtn"]',
        'div[aria-label="More actions"]',
      ];

      let clicked = false;
      for (const sel of moreSelectors) {
        try {
          await this.page.waitForSelector(sel, { timeout: 5000 });
          await this.page.click(sel);
          clicked = true;
          this.logger.info(`Clicked More button via: ${sel}`);
          break;
        } catch {}
      }

      if (!clicked) {
        // Last resort: find by visible text
        await this.page.getByRole('button', { name: /more/i }).first().click();
        this.logger.info('Clicked More button via role');
      }

      // Small pause for the menu to open
      await this.page.waitForTimeout(1000);

      // Try multiple selectors for the captions menu item
      const captionSelectors = [
        'div[id="closed-captions-button"]',
        'button[id="closed-captions-button"]',
        '[data-tid="closed-captions-button"]',
        'div[aria-label*="caption" i]',
        'button[aria-label*="caption" i]',
        'li[aria-label*="caption" i]',
      ];

      let captionClicked = false;
      for (const sel of captionSelectors) {
        try {
          await this.page.waitForSelector(sel, { timeout: 5000 });
          await this.page.click(sel);
          captionClicked = true;
          this.logger.info(`Clicked captions button via: ${sel}`);
          break;
        } catch {}
      }

      if (!captionClicked) {
        // Try by visible text
        await this.page.getByRole('menuitem', { name: /caption/i }).first().click();
        this.logger.info('Clicked captions button via role/text');
      }

      // Wait 2 seconds for captions to render after clicking
      await this.page.waitForTimeout(2000);

      // Take a screenshot so we can see what the page looks like after clicking captions
      try {
        const dir = path.resolve('output/logs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await this.page.screenshot({ path: 'output/logs/captions-debug.png', fullPage: false });
        this.logger.info('Screenshot saved to output/logs/captions-debug.png');
        
        // Dump all data-tid attributes visible on the page for diagnosis
        const dataTids = await this.page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-tid]')).map(el => el.getAttribute('data-tid')).filter(Boolean)
        );
        this.logger.info('Visible data-tid values: ' + JSON.stringify(dataTids));
        
        // Also dump elements with "caption" in their class or aria-label
        const captionElements = await this.page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('*')).filter(el => {
            const cls = typeof el.className === 'string' ? el.className : '';
            const label = el.getAttribute('aria-label') || '';
            const tid = el.getAttribute('data-tid') || '';
            return cls.toLowerCase().includes('caption') || 
                   label.toLowerCase().includes('caption') ||
                   tid.toLowerCase().includes('caption');
          });
          return els.map(el => ({
            tag: el.tagName,
            class: typeof el.className === 'string' ? el.className : '',
            'aria-label': el.getAttribute('aria-label'),
            'data-tid': el.getAttribute('data-tid'),
          })).slice(0, 20);
        });
        this.logger.info('Elements with "caption": ' + JSON.stringify(captionElements, null, 2));
      } catch (err) {
        this.logger.warn('Failed to capture debug info', err);
      }

      // Try all known selectors for caption container
      const captionContainerSelectors = [
        'div[data-tid="closed-caption-renderer-wrapper"]',
        '[data-tid="closed-captions-renderer"]',
        'div[data-tid="captions-renderer"]',
        '[data-tid="calling-screen-share-caption-host"]',
        '.closed-captions-container',
        'div[class*="captionHost"]',
        'div[class*="closedCaption"]',
        'div[aria-label*="caption" i]',
      ];

      let foundSelector = null;
      for (const sel of captionContainerSelectors) {
        try {
          await this.page.waitForSelector(sel, { timeout: 3000 });
          this.logger.info(`Caption container found: ${sel}`);
          foundSelector = sel;
          break;
        } catch {}
      }

      if (!foundSelector) {
        this.logger.warn('Caption container not found with known selectors - captions may not work');
        // Don't throw — continue anyway and try to subscribe
      }

      this.logger.info('Live captions enabled');
    } catch (err) {
      this.logger.error('Failed to enable captions', err);
      throw err;
    }
  }

  /** Subscribe to DOM mutations in the caption container and emit events */
  public async subscribe(): Promise<void> {
    this.logger.info('Subscribing to caption events...');

    const onCaption = (name: string, text: string) => {
      if (!text.trim()) return;

      // Only flush on sentence-ending punctuation (same heuristic as Teams)
      if (!/[.!?,]/.test(text)) return;

      const participantId = this._getOrCreateParticipant(name);
      const now = new Date();
      const relativeSeconds = (now.getTime() - this.startTime.getTime()) / 1000;

      const participant: Participant = {
        id: participantId,
        name,
        is_host: null,
        platform: 'desktop',
        extra_data: null,
        email: null,
      };

      const word: TranscriptWord = {
        text,
        start_timestamp: {
          relative: relativeSeconds,
          absolute: now.toISOString(),
        },
        end_timestamp: null,
      };

      // Append to in-memory transcript
      this.entries.push({ participant, words: [word] });

      // Write to file continuously
      this._flushTranscript();

      // Emit Recall.ai-compatible real-time event
      const event: TranscriptDataEvent = {
        event: 'transcript.data',
        data: {
          data: { words: [word], language_code: 'en', participant },
          transcript: { id: this.transcriptId, metadata: {} },
          recording: { id: this.recordingId, metadata: {} },
          bot: { id: this.botId, metadata: {} },
        },
      };

      this.logger.info(`Caption: [${name}] "${text}"`);

      if (this.notifier) {
        this.notifier.send(event).catch(() => {});
      }
    };

    // Expose the callback to the page's JS context
    await this.page.exposeFunction('__onCaption__', onCaption);

    // Inject the MutationObserver into the page
    await this.page.evaluate(() => {
      // Try multiple possible container selectors
      const possibleSelectors = [
        'div[data-tid="closed-caption-renderer-wrapper"]',
        '[data-tid="closed-captions-renderer"]',
        '[data-tid="calling-screen-share-caption-host"]',
        'div[class*="captionHost"]',
        'div[class*="closedCaption"]',
      ];

      let container: Element | null = null;
      for (const sel of possibleSelectors) {
        container = document.querySelector(sel);
        if (container) {
          console.log('[captions] Found container with selector:', sel);
          break;
        }
      }

      if (!container) {
        console.warn('[captions] No caption container found - captions may not work');
        return;
      }

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== 'childList') continue;
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const el = node as HTMLElement;
            
            // Try multiple patterns for author/text elements
            const msgEl = el.querySelector('.fui-ChatMessageCompact') ?? el;
            
            let authorEl = msgEl.querySelector('span[data-tid="author"]');
            let textEl = msgEl.querySelector('span[data-tid="closed-caption-text"]');
            
            // Fallback: look for any spans that might contain name/text
            if (!authorEl || !textEl) {
              const spans = msgEl.querySelectorAll('span');
              if (spans.length >= 2) {
                authorEl = spans[0];
                textEl = spans[1];
              }
            }

            if (!authorEl || !textEl) {
              console.log('[captions] Could not find author/text elements in:', el.outerHTML.slice(0, 200));
              return;
            }

            // Watch for real-time text updates on this caption node
            const textObserver = new MutationObserver(() => {
              const name = authorEl!.textContent?.trim() ?? 'Unknown';
              const text = (textEl as HTMLElement).innerText?.trim() ?? '';
              if (text) {
                console.log('[captions] Captured:', name, text);
                (window as any).__onCaption__(name, text);
              }
            });

            textObserver.observe(textEl, { childList: true, subtree: true, characterData: true });
          });
        }
      });

      observer.observe(container, { childList: true, subtree: true });
      console.log('[captions] MutationObserver attached to container');
    });

    this.logger.info('Caption subscription active');
  }

  /** Write the full transcript to disk in Recall.ai download format */
  private _flushTranscript(): void {
    try {
      fs.writeFileSync(this.transcriptPath, JSON.stringify(this.entries, null, 2));
    } catch (err) {
      this.logger.error('Failed to write transcript', err);
    }
  }

  private _getOrCreateParticipant(name: string): number {
    if (!this.participantMap.has(name)) {
      this.participantMap.set(name, this.participantCounter);
      this.participantCounter += 100;
    }
    return this.participantMap.get(name)!;
  }

  public getTranscript(): TranscriptEntry[] {
    return this.entries;
  }

  public getTranscriptPath(): string {
    return this.transcriptPath;
  }

  /** Final flush with end timestamps filled in */
  public finalize(): void {
    const endTime = new Date();
    const totalSeconds = (endTime.getTime() - this.startTime.getTime()) / 1000;

    this.entries = this.entries.map((entry) => ({
      ...entry,
      words: entry.words.map((w) => ({
        ...w,
        end_timestamp: w.end_timestamp ?? {
          relative: totalSeconds,
          absolute: endTime.toISOString(),
        },
      })),
    }));

    this._flushTranscript();
    this.logger.info(`Transcript finalized. ${this.entries.length} entries saved to ${this.transcriptPath}`);
  }
}
