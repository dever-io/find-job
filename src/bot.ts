import { createBot, type BotContext } from "./toolkit.js";
import { config } from "./config.js";
import type { Session } from "./types.js";
import { registerStart } from "./handlers/start.js";
import { registerSubscription } from "./handlers/subscription.js";
import { registerPayments } from "./handlers/payments.js";
import { registerSearch } from "./handlers/search.js";

export type Ctx = BotContext<Session>;

/**
 * Фабрика бота. Возвращает НОВЫЙ инстанс на каждый вызов (важно для тестов).
 * Порядок регистрации: команды и callback-и — до общего message:text-роутера
 * визарда (registerSearch регистрирует его последним).
 */
export function makeBot() {
  const bot = createBot<Session>(config.botToken, {
    initial: () => ({ step: "idle", draft: {} }),
  });

  registerStart(bot);
  registerSubscription(bot);
  registerPayments(bot);
  registerSearch(bot);

  bot.api
    .setMyCommands([
      { command: "search", description: "Настроить поиск вакансий" },
      { command: "status", description: "Мой статус и подписка" },
      { command: "plan", description: "Тарифы и подписка" },
      { command: "stop", description: "Отменить автопродление" },
      { command: "help", description: "Как это работает" },
    ])
    .catch((e) => console.warn("[setMyCommands]", e?.message ?? e));

  return bot;
}
