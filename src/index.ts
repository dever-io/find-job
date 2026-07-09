import cron from "node-cron";
import { config } from "./config.js";
import { store } from "./store.js";
import { makeBot } from "./bot.js";
import { runDailyForAllUsers } from "./jobs/daily.js";

async function main(): Promise<void> {
  if (!config.botToken) {
    console.error("❌ BOT_TOKEN не задан. Скопируй .env.example → .env и укажи токен от @BotFather.");
    process.exit(1);
  }

  await store.init();
  const bot = makeBot();

  const task = cron.schedule(
    config.cronExpr,
    () => {
      console.log("[cron] tick", new Date().toISOString());
      runDailyForAllUsers(bot.api).catch((e) => console.error("[cron] failed", e));
    },
    { timezone: config.cronTz },
  );

  const shutdown = () => {
    task.stop();
    bot.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(
    `StarJobs · крон "${config.cronExpr}" (${config.cronTz}) · ` +
      `ИИ: ${config.openRouterKey ? `OpenRouter (free=[${config.freeModels.join(", ")}], pro=${config.proModel})` : "выключен → эвристика"}`,
  );

  await bot.start({
    onStart: (me) => console.log(`✅ Bot @${me.username} запущен`),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
