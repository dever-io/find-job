import { InlineKeyboard, type Api, type Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Plan, Session } from "../types.js";
import { store } from "../store.js";
import { SUBSCRIPTION_PERIOD, TARIFFS } from "../config.js";
import { escapeHtml } from "../format.js";

type Ctx = BotContext<Session>;

/** Создаёт ссылку-инвойс на подписку выбранного тарифа (Telegram Stars, XTR). */
async function invoiceLink(api: Api, plan: Plan): Promise<string> {
  const t = TARIFFS[plan];
  // subscription_period + XTR → рекуррентная Stars-подписка.
  // raw приведён к any, т.к. параметр subscription_period появился недавно
  // и может отсутствовать в типах установленной версии grammY.
  const link = await (api.raw as any).createInvoiceLink({
    title: `StarJobs — ${t.label}`,
    description: `Ежедневный ИИ-поиск вакансий. ${t.priceStars}⭐ за 30 дней (≈${t.perDay}⭐/день). Проверка: ${t.ai}. Автопродление, отмена в любой момент.`,
    payload: `sub:${plan}`,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: `${t.label} — 30 дней`, amount: t.priceStars }],
    subscription_period: SUBSCRIPTION_PERIOD,
  });
  return link as string;
}

/** Клавиатура с двумя тарифами (URL-кнопки открывают инвойс). */
export async function subscribeKeyboard(api: Api): Promise<InlineKeyboard> {
  const [basic, pro] = await Promise.all([invoiceLink(api, "basic"), invoiceLink(api, "pro")]);
  const b = TARIFFS.basic;
  const p = TARIFFS.pro;
  return new InlineKeyboard()
    .url(`⭐ ${b.label} — ${b.priceStars}⭐/мес`, basic)
    .row()
    .url(`💎 ${p.label} — ${p.priceStars}⭐/мес`, pro)
    .row()
    .text("🛠 Изменить фильтры", "menu:search");
}

function tariffsText(): string {
  const b = TARIFFS.basic;
  const p = TARIFFS.pro;
  return [
    "<b>⭐ Тарифы StarJobs</b>",
    "",
    `⭐ <b>${b.label}</b> · ${b.priceStars}⭐/мес (≈${b.perDay}⭐ в день)`,
    "   Ежедневный поиск + проверка бесплатными ИИ-моделями.",
    "",
    `💎 <b>${p.label}</b> · ${p.priceStars}⭐/мес (≈${p.perDay}⭐ в день)`,
    `   То же + проверка моделью <code>${p.ai}</code> — заметно точнее отбор.`,
    "",
    "Оплата в Telegram Stars, автопродление каждые 30 дней. Отмена — командой /stop или в настройках Telegram.",
  ].join("\n");
}

/** CTA после превью-подбора. */
export async function runPreviewCTA(ctx: Ctx): Promise<void> {
  try {
    const kb = await subscribeKeyboard(ctx.api);
    await ctx.reply(tariffsText(), { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
  } catch (e) {
    console.error("[cta] invoice link failed", e);
    await ctx.reply("Оформить подписку можно командой /plan.");
  }
}

export function registerSubscription(bot: Bot<Ctx>): void {
  const showPlans = async (ctx: Ctx) => {
    try {
      const kb = await subscribeKeyboard(ctx.api);
      await ctx.reply(tariffsText(), { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
    } catch (e) {
      console.error("[plan] invoice link failed", e);
      await ctx.reply(
        "Не получилось создать ссылку на оплату 😔 Проверь, что боту разрешены платежи Telegram Stars (в @BotFather ничего включать не нужно — Stars доступны всем ботам).",
      );
    }
  };

  bot.command("plan", (ctx) => showPlans(ctx));
  bot.callbackQuery("menu:plan", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPlans(ctx);
  });

  bot.command("status", (ctx) => sendStatus(ctx));
  bot.callbackQuery("menu:status", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendStatus(ctx);
  });

  bot.command("stop", (ctx) => cancelSub(ctx));
  bot.callbackQuery("menu:stop", async (ctx) => {
    await ctx.answerCallbackQuery();
    await cancelSub(ctx);
  });
}

async function sendStatus(ctx: Ctx): Promise<void> {
  const rec = store.ensure({
    id: ctx.from!.id,
    chatId: ctx.chat!.id,
    username: ctx.from!.username,
    firstName: ctx.from!.first_name,
  });
  const s = rec.subscription;
  const lines: string[] = ["<b>📊 Твой статус</b>", ""];

  if (rec.query) {
    lines.push(`🔎 Поиск: <b>${escapeHtml(rec.query.keywords)}</b> · ${escapeHtml(rec.query.areaName)}`);
  } else {
    lines.push("🔎 Поиск ещё не настроен — /search");
  }

  const active = s.active && (!s.expiresAt || s.expiresAt * 1000 > Date.now());
  if (active) {
    const t = TARIFFS[s.plan];
    const until = s.expiresAt ? new Date(s.expiresAt * 1000).toLocaleDateString("ru-RU") : "—";
    lines.push("");
    lines.push(`💳 Подписка: <b>${t.label}</b> (${t.priceStars}⭐/мес)`);
    lines.push(`♻️ Автопродление: ${s.isRecurring ? "включено" : "выключено"}`);
    lines.push(`📅 Активна до: ${until}`);
    lines.push(`🤖 Проверка ИИ: ${t.ai}`);
  } else {
    lines.push("");
    lines.push("💳 Подписка не активна. Оформи её в /plan, чтобы получать вакансии каждый день.");
  }

  const kb = new InlineKeyboard().text("🔎 Поиск", "menu:search").text("⭐ Тарифы", "menu:plan");
  if (active && s.isRecurring) kb.row().text("🚫 Отменить автопродление", "menu:stop");

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
}

async function cancelSub(ctx: Ctx): Promise<void> {
  const rec = store.ensure({
    id: ctx.from!.id,
    chatId: ctx.chat!.id,
    username: ctx.from!.username,
    firstName: ctx.from!.first_name,
  });
  const s = rec.subscription;
  if (!s.active || !s.chargeId) {
    await ctx.reply("Активной подписки нет.");
    return;
  }
  try {
    await (ctx.api.raw as any).editUserStarSubscription({
      user_id: rec.id,
      telegram_payment_charge_id: s.chargeId,
      is_canceled: true,
    });
    s.isRecurring = false;
    await store.save(rec);
    const until = s.expiresAt ? new Date(s.expiresAt * 1000).toLocaleDateString("ru-RU") : "конца оплаченного периода";
    await ctx.reply(`Автопродление отменено. Вакансии продолжу присылать до ${until}.`);
  } catch (e) {
    console.error("[stop] failed", e);
    await ctx.reply("Не удалось отменить через бота. Открой профиль бота в Telegram → «Управление подпиской».");
  }
}
