import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, Status, TrackId } from "../types.js";
import { store } from "../store.js";
import type { TopicKey } from "../store.js";
import { runAll, runTrack } from "../jobs/run.js";
import { postDigest } from "../jobs/digest.js";
import { ensureTopics } from "../topics.js";
import { statusLabel } from "../format.js";

type Ctx = BotContext<Session>;

const VALID_TOPIC: TopicKey[] = ["A", "B", "inbox", "digest"];

function helpText(): string {
  const tracks = store.tracks();
  const trackLines = tracks.length
    ? tracks.map((t) => `${t.id}: ${t.title}`)
    : ["Треки не настроены — напиши /start и пришли резюме."];
  return [
    "<b>AI Career Agent</b> — личный агент поиска работы.",
    "",
    "Ищу вакансии по твоим трекам, оцениваю через ИИ и постю карточки по темам.",
    "",
    "<b>Настройка:</b> напиши /start и пришли резюме (PDF или текст) — я сам создам темы и настрою поиск.",
    "",
    "<b>Как отвечать на вакансию:</b>",
    "Под карточкой — кнопки. 👍 <b>Откликнуться</b> генерит письмо в тему «Отклики»; там его можно сделать <i>короче/официальнее</i>, править текстом или зафиксировать ✅.",
    "",
    "<b>Команды:</b>",
    "/start — начать заново / прислать резюме",
    "/run — искать сейчас (<code>/run A</code> — только один трек)",
    "/status — темы и воронка по трекам",
    "/digest — аналитика за неделю",
    "/setup — пересоздать темы",
    "/help — эта справка",
    "",
    "<b>Треки:</b>",
    ...trackLines,
  ].join("\n");
}

export function registerCommands(bot: Bot<Ctx>): void {
  // /start живёт в онбординге (handlers/onboarding.ts).
  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  // Пересоздать/дополнить темы для настроенных треков (+ «Отклики», «Аналитика»).
  bot.command("setup", async (ctx) => {
    const chat = ctx.chat!;
    if (chat.type !== "private" && chat.type !== "supergroup") {
      await ctx.reply("Запусти /setup в личке со мной (включи Threaded Mode у @BotFather) или в супергруппе с Темами.");
      return;
    }
    if (!store.hasTracks()) {
      await ctx.reply("Сначала /start и пришли резюме — я настрою треки, затем /setup создаст темы.");
      return;
    }
    if (chat.type === "private" && ctx.from && store.meta.ownerId === undefined) {
      await store.setOwner(ctx.from.id);
    }
    const report = await ensureTopics(ctx.api, chat.id);
    await ctx.reply(["<b>Настройка тем</b>", ...report].join("\n"), { parse_mode: "HTML" });
  });

  // Привязка темы вручную (fallback): выполняется ВНУТРИ нужной темы.
  bot.command("bind", async (ctx) => {
    const arg = (ctx.match ?? "").trim().toLowerCase();
    const key = VALID_TOPIC.find((k) => k.toLowerCase() === arg);
    if (!key) {
      await ctx.reply("Укажи, что привязываем: <code>/bind A</code>, <code>/bind B</code>, <code>/bind inbox</code> или <code>/bind digest</code>.", {
        parse_mode: "HTML",
      });
      return;
    }
    const chat = ctx.chat!;
    if (chat.type !== "supergroup" && chat.type !== "private") {
      await ctx.reply("Привязка работает в личке (Threaded Mode) или в супергруппе с Темами.");
      return;
    }
    const threadId = ctx.message?.message_thread_id;
    if (threadId === undefined) {
      await ctx.reply("Запусти команду ВНУТРИ нужной темы — мне нужен её id.");
      return;
    }
    await store.bindTopic(key, chat.id, threadId);
    await ctx.reply(`✅ Тема привязана: <b>${key}</b> (chat ${chat.id}, thread ${threadId}).`, { parse_mode: "HTML" });
  });

  // Ручной запуск поиска.
  bot.command("run", async (ctx) => {
    if (!store.hasTracks()) {
      await ctx.reply("Сначала /start и пришли резюме — я настрою треки.");
      return;
    }
    const arg = (ctx.match ?? "").trim().toUpperCase();
    if (arg === "A" || arg === "B") {
      const id = arg as TrackId;
      if (!store.getTrack(id)) {
        await ctx.reply(`Трек ${arg} не настроен.`);
        return;
      }
      if (store.threadId(id) === undefined) {
        await ctx.reply(`Тема трека ${arg} не создана. Напиши /setup.`);
        return;
      }
      await ctx.reply(`🔎 Ищу по треку ${arg}…`);
      const n = await runTrack(ctx.api, id);
      await ctx.reply(`Готово: трек ${arg} — ${n} нов.`);
      return;
    }
    await ctx.reply("🔎 Ищу по всем трекам…");
    const res = await runAll(ctx.api);
    await ctx.reply("Готово: " + store.tracks().map((t) => `${t.id}=${res[t.id] ?? 0}`).join(", "));
  });

  // Ручной дайджест в тему «Аналитика».
  bot.command("digest", async (ctx) => {
    if (!store.meta.groupId) {
      await ctx.reply("Сначала /start и /setup.");
      return;
    }
    const ok = await postDigest(ctx.api);
    if (ok && store.threadId("digest") === undefined) {
      await ctx.reply("⚠️ Тема «Аналитика» не создана (/setup) — отправил в общий чат.");
    }
  });

  // Статус: темы + воронка по трекам.
  bot.command("status", async (ctx) => {
    const m = store.meta;
    const lines: string[] = ["<b>📊 Статус</b>", ""];
    lines.push(`Чат: ${m.groupId ?? "— не привязан"}`);
    lines.push("Темы: " + VALID_TOPIC.map((k) => `${k}=${m.topics[k] ?? "—"}`).join("  "));

    const all = store.allVacancies();
    lines.push("");
    lines.push(`Вакансий в истории: <b>${all.length}</b>`);

    const ORDER: Status[] = ["Viewed", "Saved", "Responded", "Interview", "Offer", "Rejected", "Ignored"];
    for (const track of store.tracks()) {
      const rows = all.filter((v) => v.track === track.id);
      if (!rows.length) continue;
      const by = new Map<Status, number>();
      for (const v of rows) by.set(v.status, (by.get(v.status) ?? 0) + 1);
      const parts = ORDER.filter((s) => by.has(s)).map((s) => `${statusLabel(s)}: ${by.get(s)}`);
      lines.push("");
      lines.push(`<b>${track.title}</b> (${rows.length})`);
      lines.push(parts.join("\n"));
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.api
    .setMyCommands([
      { command: "start", description: "Начать / прислать резюме" },
      { command: "run", description: "Искать вакансии сейчас" },
      { command: "status", description: "Статус и воронка" },
      { command: "digest", description: "Собрать аналитику за неделю" },
      { command: "setup", description: "Пересоздать темы" },
      { command: "help", description: "Как это работает" },
    ])
    .catch((e) => console.warn("[setMyCommands]", e?.message ?? e));
}
