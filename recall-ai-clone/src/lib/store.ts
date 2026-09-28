// In-memory store for bot state — replace with Redis/DB in production
import { BotState } from './types';

const bots = new Map<string, BotState>();

export const store = {
  set(bot: BotState) {
    bots.set(bot.id, bot);
  },

  get(id: string): BotState | undefined {
    return bots.get(id);
  },

  update(id: string, patch: Partial<BotState>): BotState | undefined {
    const bot = bots.get(id);
    if (!bot) return undefined;
    const updated = { ...bot, ...patch };
    bots.set(id, updated);
    return updated;
  },

  list(): BotState[] {
    return Array.from(bots.values());
  },
};
