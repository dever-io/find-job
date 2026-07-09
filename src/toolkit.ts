import { Bot, Context, session, type SessionFlavor, type StorageAdapter } from "grammy";

/**
 * Мини-«тулкит» в духе agntdev bot-starter: createBot() оборачивает grammY
 * сессией и error-boundary. Возвращает обычный grammY-бот.
 */
export type BotContext<S> = Context & SessionFlavor<S>;

export interface CreateBotOptions<S> {
  initial: () => S;
  storage?: StorageAdapter<S>;
  onError?: (err: unknown) => void;
}

export function createBot<S>(token: string, opts: CreateBotOptions<S>): Bot<BotContext<S>> {
  const bot = new Bot<BotContext<S>>(token);
  bot.use(session({ initial: opts.initial, storage: opts.storage }));
  bot.catch((err) => {
    if (opts.onError) opts.onError(err);
    else console.error("[bot error]", err);
  });
  return bot;
}
