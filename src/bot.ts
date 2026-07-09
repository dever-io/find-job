import { createBot, type BotContext } from "./toolkit.js";
import { config } from "./config.js";
import type { Session } from "./types.js";
import { registerCommands } from "./handlers/commands.js";
import { registerActions } from "./handlers/actions.js";

export type Ctx = BotContext<Session>;

/**
 * Фабрика бота. Возвращает НОВЫЙ инстанс на каждый вызов (важно для тестов).
 * Личный инструмент: реагируем только на владельца (OWNER_ID), если он задан.
 */
export function makeBot() {
  const bot = createBot<Session>(config.botToken, {
    initial: () => ({}),
  });

  // Owner-guard: команды/кнопки принимаем только от владельца.
  bot.use(async (ctx, next) => {
    if (config.ownerId && ctx.from && ctx.from.id !== config.ownerId) return; // молча игнорируем чужих
    await next();
  });

  registerCommands(bot);
  registerActions(bot);

  return bot;
}
