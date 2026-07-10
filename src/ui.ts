import { InlineKeyboard } from "grammy";

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
