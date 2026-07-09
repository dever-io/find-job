import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, Status } from "../types.js";
import { store } from "../store.js";
import { vacancyCard, statusLabel } from "../format.js";
import { openKeyboard } from "../ui.js";

type Ctx = BotContext<Session>;

/** Перерисовывает карточку с итоговым статусом и убирает кнопки действий. */
async function settle(ctx: Ctx, id: string, status: Status): Promise<void> {
  const rec = await store.setStatus(id, status);
  if (!rec) {
    await ctx.answerCallbackQuery({ text: "Вакансия не найдена в истории." });
    return;
  }
  const text = vacancyCard(rec.vacancy, rec.verdict, {
    track: rec.track,
    hot: rec.hot,
    statusLine: statusLabel(status),
  });
  await ctx.editMessageText(text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: openKeyboard(rec.vacancy.url),
  }).catch(() => {});
}

export function registerActions(bot: Bot<Ctx>): void {
  bot.callbackQuery(/^a:(respond|ignore|save):(.+)$/, async (ctx) => {
    const [, action, id] = ctx.match as RegExpMatchArray;

    if (action === "save") {
      await ctx.answerCallbackQuery({ text: "⭐ Сохранено" });
      await settle(ctx, id, "Saved");
      return;
    }
    if (action === "ignore") {
      await ctx.answerCallbackQuery({ text: "❌ Скрыто" });
      await settle(ctx, id, "Ignored");
      return;
    }
    // respond — генерация сопроводительного письма появится в Фазе 3.
    await ctx.answerCallbackQuery({
      text: "Генерация письма — в следующей фазе. Пока открой вакансию кнопкой 📄.",
      show_alert: true,
    });
  });
}
