import { InlineKeyboard, type Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Experience, Schedule, SearchQuery, Session } from "../types.js";
import { store } from "../store.js";
import { areaKeyboard, experienceKeyboard, extraKeyboard, salaryKeyboard, scheduleKeyboard } from "../ui.js";
import { suggestArea } from "../sources/index.js";
import { findMatches } from "../jobs/pipeline.js";
import { escapeHtml, querySummary, vacancyCard } from "../format.js";
import { runPreviewCTA } from "./subscription.js";
import { nowIso } from "../util.js";

type Ctx = BotContext<Session>;

const Q_KEYWORDS =
  "💼 <b>Шаг 1/6.</b> Кем хочешь работать?\nНапиши должность или ключевые слова.\n\n<i>Примеры: «python backend», «SMM менеджер», «водитель категории E», «медсестра»</i>";
const Q_AREA = "📍 <b>Шаг 2/6.</b> Где ищем?";
const Q_SALARY = "💰 <b>Шаг 3/6.</b> Минимальная зарплата?";
const Q_EXP = "🎓 <b>Шаг 4/6.</b> Опыт работы?";
const Q_SCH = "🗓 <b>Шаг 5/6.</b> Формат работы?";
const Q_EXTRA =
  "✨ <b>Шаг 6/6.</b> Особые пожелания для ИИ?\nНапиши свободным текстом, что важно — или пропусти.\n\n<i>Примеры: «стартап без бюрократии», «иностранная компания», «без ночных смен», «есть ДМС»</i>";

const AREA_NAMES: Record<string, string> = { "113": "Вся Россия", "1": "Москва", "2": "Санкт-Петербург" };

async function startWizard(ctx: Ctx): Promise<void> {
  ctx.session.step = "keywords";
  ctx.session.draft = {};
  await ctx.reply(Q_KEYWORDS, { parse_mode: "HTML" });
}

function ensureUser(ctx: Ctx) {
  return store.ensure({
    id: ctx.from!.id,
    chatId: ctx.chat!.id,
    username: ctx.from!.username,
    firstName: ctx.from!.first_name,
  });
}

export function registerSearch(bot: Bot<Ctx>): void {
  bot.command("search", async (ctx) => {
    ensureUser(ctx);
    await startWizard(ctx);
  });
  bot.callbackQuery("menu:search", async (ctx) => {
    await ctx.answerCallbackQuery();
    ensureUser(ctx);
    await startWizard(ctx);
  });

  // Шаг 2 — регион
  bot.callbackQuery(/^w:area:(.+)$/, async (ctx) => {
    const val = String((ctx.match as RegExpMatchArray)[1]);
    await ctx.answerCallbackQuery();
    if (val === "custom") {
      ctx.session.step = "area_custom";
      await ctx.editMessageText("🏙 Введи название города:", { parse_mode: "HTML" }).catch(() => {});
      return;
    }
    ctx.session.draft.areaId = val;
    ctx.session.draft.areaName = AREA_NAMES[val] ?? "Россия";
    await ctx.editMessageText(Q_SALARY, { parse_mode: "HTML", reply_markup: salaryKeyboard() }).catch(() => {});
  });

  // Шаг 3 — зарплата
  bot.callbackQuery(/^w:sal:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const n = Number((ctx.match as RegExpMatchArray)[1]);
    ctx.session.draft.salaryFrom = n > 0 ? n : undefined;
    await ctx.editMessageText(Q_EXP, { parse_mode: "HTML", reply_markup: experienceKeyboard() }).catch(() => {});
  });

  // Шаг 4 — опыт
  bot.callbackQuery(/^w:exp:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const v = String((ctx.match as RegExpMatchArray)[1]);
    ctx.session.draft.experience = v === "any" ? undefined : (v as Experience);
    await ctx.editMessageText(Q_SCH, { parse_mode: "HTML", reply_markup: scheduleKeyboard() }).catch(() => {});
  });

  // Шаг 5 — формат
  bot.callbackQuery(/^w:sch:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const v = String((ctx.match as RegExpMatchArray)[1]);
    ctx.session.draft.schedule = v === "any" ? undefined : (v as Schedule);
    ctx.session.step = "extra";
    await ctx.editMessageText(Q_EXTRA, { parse_mode: "HTML", reply_markup: extraKeyboard() }).catch(() => {});
  });

  // Шаг 6 — пропустить пожелания
  bot.callbackQuery("w:extra:skip", async (ctx) => {
    await ctx.answerCallbackQuery();
    await finalize(ctx);
  });

  // Текстовый ввод шагов, требующих текста
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();

    switch (ctx.session.step) {
      case "keywords": {
        if (text.length < 2) {
          await ctx.reply("Слишком коротко. Напиши должность или ключевые слова.");
          return;
        }
        ctx.session.draft.keywords = text.slice(0, 200);
        ctx.session.step = "idle"; // регион выбирается кнопками
        await ctx.reply(Q_AREA, { parse_mode: "HTML", reply_markup: areaKeyboard() });
        return;
      }
      case "area_custom": {
        const found = await suggestArea(text);
        if (found) {
          ctx.session.draft.areaId = found.id;
          ctx.session.draft.areaName = found.name;
        } else {
          ctx.session.draft.areaId = "113";
          ctx.session.draft.areaName = "Вся Россия";
          await ctx.reply(`Не нашёл город «${escapeHtml(text)}», ищу по всей России.`, { parse_mode: "HTML" });
        }
        ctx.session.step = "idle";
        await ctx.reply(Q_SALARY, { parse_mode: "HTML", reply_markup: salaryKeyboard() });
        return;
      }
      case "extra": {
        ctx.session.draft.extra = text.slice(0, 300);
        await finalize(ctx);
        return;
      }
      default:
        return next();
    }
  });
}

async function finalize(ctx: Ctx): Promise<void> {
  const d = ctx.session.draft;
  ctx.session.step = "idle";
  if (!d.keywords || !d.areaId) {
    await ctx.reply("Что-то пошло не так, начни заново: /search");
    return;
  }

  const query: SearchQuery = {
    keywords: d.keywords,
    areaId: d.areaId,
    areaName: d.areaName ?? "Россия",
    salaryFrom: d.salaryFrom,
    experience: d.experience,
    schedule: d.schedule,
    extra: d.extra,
  };

  const rec = ensureUser(ctx);
  rec.query = query;
  await store.save(rec);

  await ctx.reply(querySummary(query), { parse_mode: "HTML" });
  const loading = await ctx.reply("🔎 Ищу и проверяю вакансии через ИИ… это займёт несколько секунд.");

  try {
    const matches = await findMatches(query, "basic", { limit: 5, periodDays: 14 });

    store.markSeen(rec, matches.map((m) => m.vacancy.id));
    rec.lastPreviewAt = nowIso();
    await store.save(rec);

    await ctx.api.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});

    if (!matches.length) {
      await ctx.reply(
        "Пока ничего подходящего не нашёл 😕 Попробуй смягчить фильтры (/search): убрать порог зарплаты или расширить регион до всей России.",
      );
    } else {
      await ctx.reply(`Нашёл <b>${matches.length}</b> подходящих вакансий (превью):`, { parse_mode: "HTML" });
      for (const m of matches) {
        await ctx.reply(vacancyCard(m.vacancy, m.verdict), {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().url("🔗 Открыть вакансию", m.vacancy.url),
          link_preview_options: { is_disabled: true },
        });
      }
    }
  } catch (e) {
    await ctx.api.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => {});
    console.error("[preview] failed", e);
    await ctx.reply("Не получилось выполнить поиск сейчас 😔 Попробуй ещё раз чуть позже.");
  }

  await runPreviewCTA(ctx);
}
