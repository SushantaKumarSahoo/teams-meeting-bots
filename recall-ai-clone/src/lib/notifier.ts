// Sends Recall.ai-compatible webhook + websocket events to configured URLs
import { Logger } from './logger';

export class Notifier {
  private urls: string[];
  private logger: Logger;

  constructor(args: { botId: string; urls: string[] }) {
    this.urls = args.urls;
    this.logger = new Logger({ botId: args.botId, source: 'notifier' });
  }

  async send(payload: unknown): Promise<void> {
    for (const url of this.urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          this.logger.warn(`Webhook to ${url} returned ${res.status}`);
        } else {
          this.logger.info(`Webhook delivered to ${url}`);
        }
      } catch (err) {
        this.logger.error(`Failed to send webhook to ${url}`, err);
      }
    }
  }
}
