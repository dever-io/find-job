import { createBot, type BotContext } from "./toolkit.js";
import { config } from "./config.js";
import { store } from "./store.js";
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
  // Владелец = OWNER_ID из env, либо пойманный в рантайме через /setup (store).
  bot.use(async (ctx, next) => {
    const owner = config.ownerId ?? store.meta.ownerId;
    if (owner && ctx.from && ctx.from.id !== owner) return; // молча игнорируем чужих
    await next();
  });

  registerCommands(bot);
  registerActions(bot);

  return bot;
}
