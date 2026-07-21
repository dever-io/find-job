import cron from "node-cron";
import { config } from "./config.js";
import { providerLabel } from "./providers.js";
import { store } from "./store.js";
import { makeBot } from "./bot.js";
import { runAll, runHotAll } from "./jobs/run.js";
import { postDigest } from "./jobs/digest.js";

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

  const hot = cron.schedule(
    config.hotCronExpr,
    () => {
      runHotAll(bot.api).catch((e) => console.error("[cron] hot scan failed", e));
    },
    { timezone: config.cronTz },
  );

  const digest = cron.schedule(
    config.digestCronExpr,
    () => {
      console.log("[cron] weekly digest", new Date().toISOString());
      postDigest(bot.api).catch((e) => console.error("[cron] digest failed", e));
    },
    { timezone: config.cronTz },
  );

  const shutdown = () => {
    daily.stop();
    hot.stop();
    digest.stop();
    bot.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(
    `CareerAgent · дневной крон "${config.cronExpr}", горячий "${config.hotCronExpr}" (${config.cronTz}) · ` +
      `ИИ: ${config.aiKey ? `${providerLabel()} (score=[${config.scoreModels.join(", ")}], letter=${config.letterModel})` : "выключен → эвристика"}`,
  );

  await bot.start({
    onStart: (me) => console.log(`✅ Bot @${me.username} запущен`),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
