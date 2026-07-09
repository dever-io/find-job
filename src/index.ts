import cron from "node-cron";
import { config } from "./config.js";
import { store } from "./store.js";
import { makeBot } from "./bot.js";
import { runAll } from "./jobs/run.js";

async function main(): Promise<void> {
  if (!config.botToken) {
    console.error("❌ BOT_TOKEN не задан. Скопируй .env.example → .env и укажи токен от @BotFather.");
    process.exit(1);
  }
  if (!config.ownerId) {
    console.warn("⚠️  OWNER_ID не задан — бот будет отвечать всем. Укажи свой Telegram id в OWNER_ID.");
  }

  await store.init();
  const bot = makeBot();

  const daily = cron.schedule(
    config.cronExpr,
    () => {
      console.log("[cron] daily tick", new Date().toISOString());
      runAll(bot.api).catch((e) => console.error("[cron] daily failed", e));
    },
    { timezone: config.cronTz },
  );

  const shutdown = () => {
    daily.stop();
    bot.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(
    `CareerAgent · крон "${config.cronExpr}" (${config.cronTz}) · ` +
      `ИИ: ${config.openRouterKey ? `OpenRouter (score=[${config.scoreModels.join(", ")}], letter=${config.letterModel})` : "выключен → эвристика"}`,
  );

  await bot.start({
    onStart: (me) => console.log(`✅ Bot @${me.username} запущен`),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
