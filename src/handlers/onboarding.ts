import { type Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, TrackConfig } from "../types.js";
import { store } from "../store.js";
import { escapeHtml } from "../format.js";
import { buildTrackA, buildTrackB } from "../tracks/index.js";
import { deriveResumeTrack, deriveTargetTrack } from "../ai/derive.js";
import { downloadTelegramFile, extractPdfText, looksLikeResume } from "../resume.js";

type Ctx = BotContext<Session>;

function greeting(): string {
  return [
    "<b>👋 AI Career Agent</b>",
    "",
    "Я ищу вакансии под тебя: оцениваю их ИИ по твоему резюме, готовлю сопроводительные письма, веду воронку откликов и присылаю аналитику — всё по темам прямо здесь.",
    "",
    "<b>Шаг 1.</b> Пришли своё резюме — <b>PDF-файлом</b> или просто <b>текстом</b>.",
    "Дальше я предложу искать по резюме и, если захочешь, добавить второе направление.",
  ].join("\n");
}

/** Спросить: только по резюме или добавить второе направление. */
async function askOnlyOrMore(ctx: Ctx, track: TrackConfig): Promise<void> {
  const kb = new InlineKeyboard()
    .text("🔎 Только по резюме", "onb:only")
    .text("➕ Добавить направление", "onb:more");
  await ctx.reply(
    [
      `Основной трек: <b>${escapeHtml(track.title)}</b>  ${escapeHtml(track.hashtag)}`,
      `Поиск: <code>${escapeHtml(track.query.keywords)}</code>`,
      "",
      "Искать только по резюме или добавить ещё направление (например, переход в другую сферу)?",
    ].join("\n"),
    { parse_mode: "HTML", reply_markup: kb },
  );
}

/** Резюме получено → строим основной трек и предлагаем выбор. */
async function handleResume(ctx: Ctx, resume: string): Promise<void> {
  ctx.session.draftResume = resume;
  ctx.session.awaiting = undefined;
  await ctx.reply("📄 Резюме принял. Определяю целевую должность…");
  try {
    const t = await deriveResumeTrack(resume);
    const track = buildTrackA({ title: t.title, keywords: t.keywords, experience: t.experience, tag: t.tag, resume });
    await store.setTrack(track);
    await askOnlyOrMore(ctx, track);
  } catch {
    // Нет ИИ-ключа или сбой — спросим ключевые слова вручную.
    ctx.session.awaiting = { kind: "onb_keywords_a" };
    await ctx.reply(
      "Не смог определить автоматически (нужен OPENROUTER_API_KEY). Напиши поисковый запрос под своё резюме — роль/специализацию, напр. «руководитель проектов продакшн».",
    );
  }
}

/** Финал: запомнить владельца и чат, показать хэштеги подборок. */
async function finalize(ctx: Ctx): Promise<void> {
  const chat = ctx.chat!;
  if (ctx.from && store.meta.ownerId === undefined) await store.setOwner(ctx.from.id);
  await store.setChat(chat.id);
  ctx.session.awaiting = undefined;
  ctx.session.draftResume = undefined;

  const lines = [
    "<b>✅ Готово!</b>",
    "Буду присылать вакансии сюда, помечая подборки хэштегами (жми по хэштегу — увидишь всё по нему):",
    "",
    ...store.tracks().map((t) => `${escapeHtml(t.hashtag)} — ${escapeHtml(t.title)}`),
    "#отклик — сопроводительные письма",
    "#аналитика — еженедельная сводка",
    "",
    "Жми /run — начну искать вакансии. /help — что я умею.",
  ];
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

export function registerOnboarding(bot: Bot<Ctx>): void {
  bot.command("start", async (ctx) => {
    ctx.session.awaiting = { kind: "onb_resume" };
    ctx.session.draftResume = undefined;
    await ctx.reply(greeting(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  // Резюме PDF-файлом.
  bot.on("message:document", async (ctx, next) => {
    if (ctx.session.awaiting?.kind !== "onb_resume") return next();
    const doc = ctx.message.document;
    const isPdf = doc.mime_type === "application/pdf" || /\.pdf$/i.test(doc.file_name ?? "");
    if (!isPdf) {
      await ctx.reply("Нужен PDF или текст резюме. Пришли PDF-файлом или вставь текст сообщением.");
      return;
    }
    await ctx.reply("📄 Читаю PDF…");
    try {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) throw new Error("нет file_path");
      const buf = await downloadTelegramFile(file.file_path);
      const text = await extractPdfText(buf);
      if (!looksLikeResume(text)) {
        await ctx.reply("Не удалось извлечь текст (возможно, это скан-картинка). Пришли резюме текстом.");
        return;
      }
      await handleResume(ctx, text);
    } catch (e: any) {
      await ctx.reply(`Ошибка чтения PDF: ${e?.message ?? e}. Пришли резюме текстом.`);
    }
  });

  // Текстовые шаги онбординга. Остальной текст — дальше по цепочке (напр. правка письма).
  bot.on("message:text", async (ctx, next) => {
    const a = ctx.session.awaiting;
    if (!a) return next();
    const text = ctx.message.text.trim();

    if (a.kind === "onb_resume") {
      if (text.startsWith("/")) return next();
      if (!looksLikeResume(text)) {
        await ctx.reply("Это не похоже на резюме. Пришли PDF-файл или вставь полный текст резюме.");
        return;
      }
      await handleResume(ctx, text);
      return;
    }

    if (a.kind === "onb_keywords_a") {
      const resume = ctx.session.draftResume ?? "";
      const track = buildTrackA({ title: text.slice(0, 60), keywords: text, resume });
      await store.setTrack(track);
      await askOnlyOrMore(ctx, track);
      return;
    }

    if (a.kind === "onb_track_b") {
      ctx.session.awaiting = undefined;
      await ctx.reply("⚙️ Настраиваю второе направление…");
      const resume = ctx.session.draftResume ?? store.getTrack("A")?.resumeProfile ?? "";
      let track: TrackConfig;
      try {
        const t = await deriveTargetTrack(resume, text);
        track = buildTrackB({ title: t.title, keywords: t.keywords, transferPrompt: t.transferPrompt, tag: t.tag, resume });
      } catch {
        track = buildTrackB({
          title: text.slice(0, 60),
          keywords: text,
          transferPrompt: `Кандидат переходит в «${text}». Оценивай через transferable skills из резюме, не приписывая несуществующего опыта.`,
          resume,
        });
      }
      await store.setTrack(track);
      await finalize(ctx);
      return;
    }

    return next();
  });

  // Выбор после резюме.
  bot.callbackQuery("onb:only", async (ctx) => {
    await ctx.answerCallbackQuery();
    await finalize(ctx);
  });
  bot.callbackQuery("onb:more", async (ctx) => {
    ctx.session.awaiting = { kind: "onb_track_b" };
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Опиши второе направление — роль или ключевые слова, напр. «Product Manager в IT» или «аналитик данных». Я подберу поиск и учту перенос твоего опыта.",
    );
  });
}
