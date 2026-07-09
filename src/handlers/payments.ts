import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Plan, Session } from "../types.js";
import { store } from "../store.js";
import { TARIFFS } from "../config.js";
import { nowIso } from "../util.js";

type Ctx = BotContext<Session>;

export function registerPayments(bot: Bot<Ctx>): void {
  // Ответить нужно в течение 10 секунд, иначе платёж отменяется.
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
      console.error("[pre_checkout] failed", e);
    }
  });

  bot.on("message:successful_payment", async (ctx) => {
    const sp: any = ctx.message.successful_payment;
    const payload: string = sp.invoice_payload ?? "";
    const plan: Plan = payload.includes("pro") ? "pro" : "basic";

    const rec = store.ensure({
      id: ctx.from!.id,
      chatId: ctx.chat!.id,
      username: ctx.from!.username,
      firstName: ctx.from!.first_name,
    });
    const prev = rec.subscription;

    // если раньше была другая активная подписка — отменяем её автопродление
    if (prev.chargeId && prev.chargeId !== sp.telegram_payment_charge_id && prev.isRecurring) {
      try {
        await (ctx.api.raw as any).editUserStarSubscription({
          user_id: rec.id,
          telegram_payment_charge_id: prev.chargeId,
          is_canceled: true,
        });
      } catch {
        /* ignore */
      }
    }

    rec.subscription = {
      plan,
      active: true,
      isRecurring: true,
      expiresAt: sp.subscription_expiration_date,
      chargeId: sp.telegram_payment_charge_id,
      startedAt: prev.startedAt ?? nowIso(),
    };
    await store.save(rec);
    await store.addPayment({
      chargeId: sp.telegram_payment_charge_id,
      userId: rec.id,
      stars: typeof sp.total_amount === "number" ? sp.total_amount : TARIFFS[plan].priceStars,
      plan,
      isRecurring: Boolean(sp.is_recurring),
      at: nowIso(),
    });

    // Авто-продление (не первый платёж) — обновляем срок молча, без спама.
    if (sp.is_recurring && !sp.is_first_recurring) return;

    const t = TARIFFS[plan];
    const msg = rec.query
      ? `✅ Подписка <b>${t.label}</b> активна! Каждое утро (по Москве) буду присылать новые подходящие вакансии по запросу «${rec.query.keywords}». Проверка — ${t.ai}.`
      : `✅ Подписка <b>${t.label}</b> активна! Осталось настроить поиск — /search, и я начну присылать вакансии каждый день.`;
    await ctx.reply(msg, { parse_mode: "HTML" });
  });
}
