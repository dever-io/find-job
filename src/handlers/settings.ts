import { type Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, TrackConfig } from "../types.js";
import { store } from "../store.js";
import { escapeHtml } from "../format.js";
import { buildTrackB } from "../tracks/index.js";
import { deriveTargetTrack } from "../ai/derive.js";

type Ctx = BotContext<Session>;

/** Резюме из любого трека (нужно для настройки нового направления). */
function anyResume(): string {
  for (const t of store.tracks()) if (t.resumeProfile) return t.resumeProfile;
  return "";
}

/** Текст + клавиатура экрана настроек. */
function renderSettings(): { text: string; keyboard: InlineKeyboard } {
  const tracks = store.tracks();
  const channels = store.channels();
  const lines: string[] = ["<b>⚙️ Настройки</b>", ""];

  lines.push("<b>Треки поиска:</b>");
  if (tracks.length) {
    for (const t of tracks) lines.push(`${escapeHtml(t.hashtag)} — ${escapeHtml(t.title)}`);
  } else {
    lines.push("— пока нет (пришли резюме через /start)");
  }
  lines.push("");
  lines.push("<b>Доп. источники (Telegram-каналы):</b>");
  if (channels.length) {
    for (const c of channels) lines.push(`@${escapeHtml(c)}`);
  } else {
    lines.push("— нет (по умолчанию ищу на hh.ru и «Работа России»)");
  }

  const kb = new InlineKeyboard().text("➕ Трек", "set:addtrack").text("➕ TG-канал", "set:addchan").row();
  for (const t of tracks) kb.text(`➖ ${t.hashtag}`, `set:deltrack:${t.id}`).row();
  for (const c of channels) kb.text(`➖ @${c}`, `set:delchan:${c}`).row();

  return { text: lines.join("\n"), keyboard: kb };
}

/** Достаёт юзернейм канала из @name / t.me/name / https://t.me/name. */
function parseChannel(input: string): string | null {
  const m = input.trim().match(/(?:t\.me\/|@)?([a-zA-Z0-9_]{4,32})\/?$/);
  return m ? m[1] : null;
}

export function registerSettings(bot: Bot<Ctx>): void {
  bot.command("settings", async (ctx) => {
    const { text, keyboard } = renderSettings();
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  });

  // ── Добавить трек ──
  bot.callbackQuery("set:addtrack", async (ctx) => {
    ctx.session.awaiting = { kind: "settings_track" };
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Опиши новое направление — роль или ключевые слова (напр. «моушн-дизайнер» или «руководитель маркетинга»). Я подберу поиск.",
    );
  });

  // ── Добавить канал ──
  bot.callbackQuery("set:addchan", async (ctx) => {
    ctx.session.awaiting = { kind: "settings_channel" };
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Пришли публичный Telegram-канал с вакансиями — @имя или ссылку t.me/имя. Буду искать вакансии и там.",
    );
  });

  // ── Удалить трек / канал ──
  bot.callbackQuery(/^set:deltrack:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    await store.removeTrack(id);
    await ctx.answerCallbackQuery({ text: "Трек удалён" });
    const { text, keyboard } = renderSettings();
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
  });
  bot.callbackQuery(/^set:delchan:(.+)$/, async (ctx) => {
    const name = (ctx.match as RegExpMatchArray)[1];
    await store.removeChannel(name);
    await ctx.answerCallbackQuery({ text: "Канал удалён" });
    const { text, keyboard } = renderSettings();
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
  });

  // ── Ввод текста для настроек ──
  bot.on("message:text", async (ctx, next) => {
    const a = ctx.session.awaiting;
    if (a?.kind !== "settings_track" && a?.kind !== "settings_channel") return next();
    const text = ctx.message.text.trim();
    ctx.session.awaiting = undefined;

    if (a.kind === "settings_channel") {
      const name = parseChannel(text);
      if (!name) {
        await ctx.reply("Не разобрал канал. Пришли в виде @имя или t.me/имя.");
        return;
      }
      await ctx.reply(`Проверяю @${name}…`);
      const { tgChannelSource } = await import("../sources/tg.js");
      const probe = await tgChannelSource(name)
        .search({ keywords: "", areaId: "113", areaName: "РФ" }, { limit: 1 })
        .catch(() => []);
      // даже 0 вакансий по пустому запросу допустимо, но пустой ответ по недоступному каналу — тоже []
      await store.addChannel(name);
      await ctx.reply(
        `✅ Канал @${name} добавлен в источники.` +
          (probe.length ? "" : "\n(сейчас свежих вакансий по нему не вижу — проверю при следующем /run)"),
      );
      return;
    }

    // settings_track
    await ctx.reply("⚙️ Настраиваю новое направление…");
    const resume = anyResume();
    const id = store.nextTrackId();
    let track: TrackConfig;
    try {
      const t = await deriveTargetTrack(resume, text);
      track = buildTrackB({ id, title: t.title, keywords: t.keywords, transferPrompt: t.transferPrompt, tag: t.tag, resume });
    } catch {
      track = buildTrackB({
        id,
        title: text.slice(0, 60),
        keywords: text,
        transferPrompt: `Кандидат ищет по направлению «${text}». Оценивай через transferable skills из резюме, не приписывая несуществующего опыта.`,
        resume,
      });
    }
    await store.setTrack(track);
    await ctx.reply(
      `✅ Трек добавлен: <b>${escapeHtml(track.title)}</b> ${escapeHtml(track.hashtag)}\nПоиск: <code>${escapeHtml(track.query.keywords)}</code>\nЖми /run — поищу и по нему.`,
      { parse_mode: "HTML" },
    );
  });
}
