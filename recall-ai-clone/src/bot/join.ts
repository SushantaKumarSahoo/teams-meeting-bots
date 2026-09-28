import { Page } from 'playwright';
import { Logger } from '../lib/logger';

/**
 * Handles joining a Microsoft Teams meeting via the web browser.
 * Resolves the launch URL, clicks "Continue on this browser",
 * sets the bot name, disables camera/mic, and joins.
 */
export class JoinProcedure {
  private page: Page;
  private logger: Logger;

  constructor(args: { page: Page; botId: string; botName: string }) {
    this.page = args.page;
    this.logger = new Logger({ botId: args.botId, source: 'join' });
  }

  /** Fetch the meeting URL and resolve the deep-link redirect so we land on the web client */
  private async _resolveWebUrl(meetingUrl: string): Promise<string> {
    try {
      const res = await fetch(meetingUrl, { redirect: 'follow' });
      const url = new URL(res.url);
      url.searchParams.set('msLaunch', 'false');
      url.searchParams.set('directDl', 'true');
      url.searchParams.set('suppressPrompt', 'true');
      return url.toString();
    } catch {
      // If fetch fails just use the raw URL
      return meetingUrl;
    }
  }

  public async run(args: { meetingUrl: string; botName: string }): Promise<void> {
    const { meetingUrl, botName } = args;
    this.logger.info('Resolving meeting URL...');

    const webUrl = await this._resolveWebUrl(meetingUrl);
    this.logger.info('Navigating to meeting', { url: webUrl });

    await this.page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Dismiss any native app launch dialogs
    this.page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });

    // Step 1: Click "Continue on this browser" if present
    try {
      await this.page.waitForSelector('button[data-tid="joinOnWeb"]', { timeout: 15000 });
      await this.page.click('button[data-tid="joinOnWeb"]');
      this.logger.info('Clicked "Continue on this browser"');
    } catch {
      this.logger.warn('"Continue on this browser" not found, continuing...');
    }

    // Step 2: Enter bot name
    const nameSelector = 'input[placeholder="Type your name"], input[placeholder="Enter your name"], input[type="text"]';
    await this.page.waitForSelector(nameSelector, { timeout: 30000 });
    await this.page.fill(nameSelector, botName);
    this.logger.info(`Set bot name to: ${botName}`);

    // Step 3: Turn off camera and mic (CRITICAL - prevents bot's own video from being recorded)
    await this.page.waitForTimeout(2000); // Wait for controls to load
    
    // Take a screenshot to help debug
    try {
      await this.page.screenshot({ path: 'output/logs/prejoin-screen.png' });
      this.logger.info('Prejoin screenshot saved for debugging');
    } catch {}
    
    // Turn off camera - find the actual toggle switch, not the options button
    try {
      // The toggle switches are input elements with role="switch" or have specific classes
      const cameraSelectors = [
        // Toggle switch selectors (the actual on/off switches)
        'input[type="checkbox"][class*="camera" i]',
        'input[type="checkbox"][class*="video" i]',
        'div[role="switch"]:near(svg[data-icon-name="Video"])',
        'button[role="switch"]:has(svg[data-icon-name="Video"])',
        // Try finding by position - first toggle switch
        'input[type="checkbox"]',
        'div[class*="toggle-switch" i] >> nth=0',
        // Fallback - look for controls near the video preview
        'label:has-text("Background filters") >> .. >> input[type="checkbox"]',
      ];
      
      let cameraTurnedOff = false;
      for (const sel of cameraSelectors) {
        try {
          const toggle = await this.page.waitForSelector(sel, { timeout: 2000, state: 'visible' });
          if (toggle) {
            const checked = await toggle.evaluate((el: HTMLInputElement) => el.checked);
            const ariaChecked = await toggle.getAttribute('aria-checked');
            
            this.logger.info(`Camera toggle: ${sel}, checked=${checked}, aria-checked=${ariaChecked}`);
            
            // If it's on (checked), click to turn it off
            if (checked || ariaChecked === 'true') {
              await toggle.click();
              await this.page.waitForTimeout(500);
              this.logger.info(`Camera turned OFF`);
            } else {
              this.logger.info(`Camera already OFF`);
            }
            
            cameraTurnedOff = true;
            break;
          }
        } catch (err) {
          // Continue to next selector
        }
      }
      
      if (!cameraTurnedOff) {
        this.logger.warn('Could not find camera toggle switch - may record bot preview');
      }
    } catch (err) {
      this.logger.error('Error turning off camera', err);
    }

    // Turn off mic - find the actual toggle switch
    try {
      const micSelectors = [
        // Toggle switch selectors
        'input[type="checkbox"][class*="mic" i]',
        'input[type="checkbox"][class*="audio" i]',
        'div[role="switch"]:near(svg[data-icon-name="Microphone"])',
        'button[role="switch"]:has(svg[data-icon-name="Microphone"])',
        // Try finding by position - second toggle switch (after camera)
        'input[type="checkbox"] >> nth=1',
        'div[class*="toggle-switch" i] >> nth=1',
      ];
      
      let micTurnedOff = false;
      for (const sel of micSelectors) {
        try {
          const toggle = await this.page.waitForSelector(sel, { timeout: 2000, state: 'visible' });
          if (toggle) {
            const checked = await toggle.evaluate((el: HTMLInputElement) => el.checked);
            const ariaChecked = await toggle.getAttribute('aria-checked');
            
            this.logger.info(`Mic toggle: ${sel}, checked=${checked}, aria-checked=${ariaChecked}`);
            
            // If it's on (checked), click to turn it off
            if (checked || ariaChecked === 'true') {
              await toggle.click();
              await this.page.waitForTimeout(500);
              this.logger.info(`Mic turned OFF`);
            } else {
              this.logger.info(`Mic already OFF`);
            }
            
            micTurnedOff = true;
            break;
          }
        } catch (err) {
          // Continue to next selector
        }
      }
      
      if (!micTurnedOff) {
        this.logger.warn('Could not find mic toggle switch');
      }
    } catch (err) {
      this.logger.error('Error turning off mic', err);
    }

    // Step 4: Click Join
    const joinSelector = 'button[data-tid="prejoin-join-button"], button:has-text("Join now"), button:has-text("Join")';
    await this.page.waitForSelector(joinSelector, { timeout: 30000 });
    await this.page.click(joinSelector);
    this.logger.info('Clicked Join button');
  }

  /** Returns true once the bot is in the waiting room */
  public async waitForWaitingRoom(timeoutMs = 30000): Promise<boolean> {
    try {
      await this.page.waitForSelector(
        'text=Someone will let you in shortly, text=Waiting for someone to let you in',
        { timeout: timeoutMs }
      );
      this.logger.info('Bot is in waiting room');
      return true;
    } catch {
      return false;
    }
  }

  /** Returns true once the bot is admitted into the meeting (Leave button appears) */
  public async waitForAdmission(timeoutMs = 300000): Promise<boolean> {
    try {
      await this.page.waitForSelector(
        'button#hangup-button, button[data-tid="call-hangup"], button[aria-label="Leave"]',
        { timeout: timeoutMs }
      );
      this.logger.info('Bot admitted into meeting');
      return true;
    } catch {
      this.logger.error('Timed out waiting for admission');
      return false;
    }
  }

  /** Returns true if the call has ended (Leave button is gone) */
  public async hasCallEnded(): Promise<boolean> {
    try {
      await this.page.waitForSelector(
        'button#hangup-button, button[data-tid="call-hangup"]',
        { state: 'detached', timeout: 3000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  public async leave(): Promise<void> {
    try {
      await this.page.click('button#hangup-button, button[data-tid="call-hangup"]');
      this.logger.info('Bot left the meeting');
    } catch (e) {
      this.logger.warn('Could not click leave button', e);
    }
  }
}
