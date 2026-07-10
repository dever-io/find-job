import { InlineKeyboard } from "grammy";
import type { Status } from "./types.js";

/**
 * Кнопки под карточкой вакансии.
 * callback_data: `a:<action>:<vacancyId>` — id вакансии может содержать ":"
 * (напр. "hh:12345"), поэтому парсим по первым двум разделителям.
 */
export function actionKeyboard(vacancyId: string, url: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("👍 Откликнуться", `a:respond:${vacancyId}`)
    .text("❌ Не интересно", `a:ignore:${vacancyId}`)
    .row()
    .text("⭐ Сохранить", `a:save:${vacancyId}`)
    .url("📄 Открыть", url);
}

/** Клавиатура после действия — оставляем только ссылку на вакансию. */
export function openKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard().url("📄 Открыть вакансию", url);
}

/**
 * Клавиатура продвижения по воронке. Показывает доступные из текущего статуса
 * переходы; в терминальных статусах — только ссылка на вакансию.
 * callback_data: `s:<status>:<vacancyId>`.
 */
export function statusKeyboard(status: Status, vacancyId: string, url: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  const next: Array<[string, Status]> =
    status === "Responded"
      ? [["🗣 Собеседование", "Interview"], ["🚫 Отказ", "Rejected"]]
      : status === "Interview"
        ? [["🎉 Оффер", "Offer"], ["🚫 Отказ", "Rejected"]]
        : [];
  for (const [label, s] of next) kb.text(label, `s:${s}:${vacancyId}`);
  if (next.length) kb.row();
  kb.url("📄 Открыть вакансию", url);
  return kb;
}

/** Кнопки под черновиком сопроводительного письма (Фаза 3). */
export function letterKeyboard(vacancyId: string, url: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Отправить", `l:send:${vacancyId}`)
    .text("✏️ Редактировать", `l:edit:${vacancyId}`)
    .row()
    .text("✂️ Короче", `l:shorter:${vacancyId}`)
    .text("🎩 Официальнее", `l:formal:${vacancyId}`)
    .row()
    .url("📄 Открыть вакансию", url);
}
