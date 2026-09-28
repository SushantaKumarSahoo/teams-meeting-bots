import fs from 'fs';
import path from 'path';

type Level = 'info' | 'warn' | 'error';

export class Logger {
  private stream: fs.WriteStream;
  private botId: string;
  private source: string;

  constructor(args: { botId: string; source: string }) {
    this.botId = args.botId;
    this.source = args.source;

    const logDir = path.resolve('output/logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    this.stream = fs.createWriteStream(
      path.join(logDir, `${this.botId}.log`),
      { flags: 'a' }
    );
  }

  private _log(level: Level, message: string, data?: unknown) {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${this.source}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
    this.stream.write(line + '\n');
    console[level](`[${this.botId.slice(0, 8)}] [${this.source}] ${message}`, data ?? '');
  }

  info(message: string, data?: unknown) { this._log('info', message, data); }
  warn(message: string, data?: unknown) { this._log('warn', message, data); }
  error(message: string, data?: unknown) { this._log('error', message, data); }

  close() { this.stream.end(); }
}
