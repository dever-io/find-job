import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, Status, StoredVacancy } from "../types.js";
import { store } from "../store.js";
import { vacancyCard, statusLabel, letterCard } from "../format.js";
import { openKeyboard, letterKeyboard, statusKeyboard } from "../ui.js";
import { generateLetter, type LetterOpts } from "../ai/letter.js";

type Ctx = BotContext<Session>;

/** Хэштег трека вакансии (для шапки карточки/письма). */
function tagOf(rec: StoredVacancy): string | undefined {
  return store.getTrack(rec.track)?.hashtag;
}

/** Перерисовывает карточку вакансии с итоговым статусом и убирает кнопки действий. */
async function settle(ctx: Ctx, id: string, status: Status): Promise<void> {
  const rec = await store.setStatus(id, status);
  if (!rec) {
    await ctx.answerCallbackQuery({ text: "Вакансия не найдена в истории." });
    return;
  }
  const text = vacancyCard(rec.vacancy, rec.verdict, {
    tag: tagOf(rec),
    hot: rec.hot,
    statusLine: statusLabel(status),
  });
  await ctx
    .editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: openKeyboard(rec.vacancy.url),
    })
    .catch(() => {});
}

/** Генерация письма + правка существующего черновика — общий путь для всех кнопок. */
async function makeLetter(ctx: Ctx, id: string, opts: LetterOpts): Promise<void> {
  const rec = store.getVacancy(id);
  if (!rec) {
    await ctx.reply("Вакансия не найдена в истории.");
    return;
  }
  const track = store.getTrack(rec.track);
  if (!track) {
    await ctx.reply("Трек этой вакансии не настроен — не могу составить письмо.");
    return;
  }
  let letter: string;
  try {
    letter = await generateLetter(track, rec.vacancy, opts);
  } catch (e: any) {
    await ctx.reply(`Не удалось сгенерировать письмо: ${e?.message ?? e}`);
    return;
  }
  const body = letterCard(rec.vacancy, letter, tagOf(rec));
  const kb = letterKeyboard(rec.vacancy.id, rec.vacancy.url);
  const chatId = store.meta.chatId;
  if (chatId === undefined) {
    await ctx.reply("Чат не настроен — напиши /start.");
    return;
  }

  // Есть черновик — правим его на месте; иначе постим новый в единый чат.
  if (rec.letterMessageId !== undefined) {
    await ctx.api
      .editMessageText(chatId, rec.letterMessageId, body, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: kb,
      })
      .catch((e) => console.warn("[letter] edit failed:", e?.message ?? e));
    await store.setLetter(id, letter);
    return;
  }

  const sent = await ctx.api
    .sendMessage(chatId, body, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: kb,
    })
    .catch((e) => {
      console.error("[letter] send failed:", e?.message ?? e);
      return undefined;
    });
  await store.setLetter(id, letter, { messageId: sent?.message_id });
}

export function registerActions(bot: Bot<Ctx>): void {
  // ── Кнопки под карточкой вакансии ──
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
    // respond → генерация сопроводительного письма
    await ctx.answerCallbackQuery({ text: "✍️ Генерирую письмо…" });
    await makeLetter(ctx, id, {});
  });

  // ── Кнопки под черновиком письма ──
  bot.callbackQuery(/^l:(send|edit|shorter|formal):(.+)$/, async (ctx) => {
    const [, action, id] = ctx.match as RegExpMatchArray;
    const rec = store.getVacancy(id);
    if (!rec) {
      await ctx.answerCallbackQuery({ text: "Вакансия не найдена." });
      return;
    }

    if (action === "shorter") {
      await ctx.answerCallbackQuery({ text: "✂️ Делаю короче…" });
      await makeLetter(ctx, id, { previous: rec.letter, instruction: "сделай заметно короче, 2–3 абзаца, без воды" });
      return;
    }
    if (action === "formal") {
      await ctx.answerCallbackQuery({ text: "🎩 Делаю официальнее…" });
      await makeLetter(ctx, id, { previous: rec.letter, instruction: "сделай тон более официальным и деловым" });
      return;
    }
    if (action === "edit") {
      ctx.session.awaiting = { kind: "letter_edit", vacancyId: id };
      await ctx.answerCallbackQuery();
      await ctx.reply("✏️ Что поправить в письме? Пришли правку одним сообщением (или «отмена»).");
      return;
    }
    // send → фиксируем письмо, статус «Отклик отправлен»
    if (!rec.letter) {
      await ctx.answerCallbackQuery({ text: "Письмо ещё не готово." });
      return;
    }
    await ctx.answerCallbackQuery({ text: "✅ Помечено «отклик отправлен»" });
    await store.setStatus(id, "Responded");
    const footer = `✅ <b>${statusLabel("Responded")}</b>`;
    await ctx
      .editMessageText(letterCard(rec.vacancy, rec.letter, tagOf(rec), footer), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: openKeyboard(rec.vacancy.url),
      })
      .catch(() => {});
    // Обновляем и саму карточку вакансии: статус + клавиатура продвижения воронки.
    if (rec.cardMessageId !== undefined && store.meta.chatId !== undefined) {
      await ctx.api
        .editMessageText(
          store.meta.chatId,
          rec.cardMessageId,
          vacancyCard(rec.vacancy, rec.verdict, { tag: tagOf(rec), hot: rec.hot, statusLine: statusLabel("Responded") }),
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: statusKeyboard("Responded", rec.vacancy.id, rec.vacancy.url),
          },
        )
        .catch(() => {});
    }
  });

  // ── Продвижение по воронке: Собеседование / Оффер / Отказ ──
  bot.callbackQuery(/^s:(Interview|Offer|Rejected):(.+)$/, async (ctx) => {
    const [, status, id] = ctx.match as RegExpMatchArray;
    const rec = await store.setStatus(id, status as Status);
    if (!rec) {
      await ctx.answerCallbackQuery({ text: "Вакансия не найдена." });
      return;
    }
    await ctx.answerCallbackQuery({ text: statusLabel(status) });
    await ctx
      .editMessageText(
        vacancyCard(rec.vacancy, rec.verdict, { tag: tagOf(rec), hot: rec.hot, statusLine: statusLabel(status) }),
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: statusKeyboard(status as Status, rec.vacancy.id, rec.vacancy.url),
        },
      )
      .catch(() => {});
  });

  // ── Правка письма свободным текстом (нужен выключенный privacy mode) ──
  bot.on("message:text", async (ctx, next) => {
    const awaiting = ctx.session.awaiting;
    if (!awaiting || awaiting.kind !== "letter_edit") return next();
    const text = ctx.message.text.trim();
    ctx.session.awaiting = undefined; // одноразовая правка
    if (/^(отмена|cancel|нет)$/i.test(text)) {
      await ctx.reply("Ок, правку отменил.");
      return;
    }
    const rec = store.getVacancy(awaiting.vacancyId);
    if (!rec) {
      await ctx.reply("Вакансия не найдена в истории.");
      return;
    }
    await ctx.reply("✏️ Переписываю письмо…");
    await makeLetter(ctx, awaiting.vacancyId, { previous: rec.letter, instruction: text });
  });
}
