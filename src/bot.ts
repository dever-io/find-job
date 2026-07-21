import { createBot, type BotContext } from "./toolkit.js";
import { config } from "./config.js";
import { store } from "./store.js";
import type { Session } from "./types.js";
import { registerCommands } from "./handlers/commands.js";
import { registerOnboarding } from "./handlers/onboarding.js";
import { registerActions } from "./handlers/actions.js";
import { registerSettings } from "./handlers/settings.js";
import { registerAdmin } from "./handlers/admin.js";

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
  registerOnboarding(bot); // /start + диалоговый онбординг (до actions: ловит onb_* текст)
  registerActions(bot);
  registerSettings(bot); // /settings: добавление/удаление треков и TG-каналов
  registerAdmin(bot); // /admin: ключи провайдеров и прочие настройки на лету

  return bot;
}
