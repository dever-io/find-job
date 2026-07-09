import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session } from "../types.js";
import { store } from "../store.js";
import { mainMenu } from "../ui.js";
import { TARIFFS } from "../config.js";
import { escapeHtml } from "../format.js";

type Ctx = BotContext<Session>;

function welcomeText(name: string): string {
  const b = TARIFFS.basic;
  const p = TARIFFS.pro;
  return [
    `👋 Привет, ${escapeHtml(name)}!`,
    "",
    "Я — <b>StarJobs</b>, бот-джобскаут. Опиши, кем хочешь работать и на каких условиях, а я каждый день ищу подходящие вакансии по всей России (hh.ru + Работа России) и проверяю каждую через ИИ — чтобы в ленту попадало только релевантное.",
    "",
    "<b>Тарифы:</b>",
    `⭐ <b>${b.label}</b> — ${b.priceStars}⭐/мес (≈${b.perDay}⭐ в день). Проверка бесплатными ИИ-моделями.`,
    `💎 <b>${p.label}</b> — ${p.priceStars}⭐/мес (≈${p.perDay}⭐ в день). Проверка моделью <code>${p.ai}</code> — точнее отбор.`,
    "",
    "Начни с настройки поиска — первый подбор покажу бесплатно 👇",
  ].join("\n");
}

function helpText(): string {
  return [
    "<b>Как это работает</b>",
    "",
    "1️⃣ <b>/search</b> — за пару шагов настраиваешь фильтры: должность, город, зарплата, опыт, формат работы и свободные пожелания для ИИ.",
    "2️⃣ Я сразу показываю бесплатный превью-подбор.",
    "3️⃣ Оформляешь подписку ⭐ — и каждое утро присылаю новые подходящие вакансии, отфильтрованные ИИ.",
    "",
    "<b>Команды</b>",
    "/search — настроить поиск",
    "/status — мой статус и подписка",
    "/plan — тарифы и подписка",
    "/stop — отменить автопродление",
    "",
    "Оплата — через Telegram Stars ⭐. Продлением и списаниями управляет сам Telegram; отменить можно в любой момент в настройках Telegram или командой /stop.",
  ].join("\n");
}

export function registerStart(bot: Bot<Ctx>): void {
  bot.command("start", async (ctx) => {
    store.ensure({
      id: ctx.from!.id,
      chatId: ctx.chat!.id,
      username: ctx.from!.username,
      firstName: ctx.from!.first_name,
    });
    ctx.session.step = "idle";
    ctx.session.draft = {};
    await ctx.reply(welcomeText(ctx.from!.first_name ?? "друг"), {
      parse_mode: "HTML",
      reply_markup: mainMenu(),
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML", reply_markup: mainMenu(), link_preview_options: { is_disabled: true } });
  });

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(helpText(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });
}
