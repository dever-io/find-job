import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, TrackId } from "../types.js";
import { store } from "../store.js";
import type { TopicKey } from "../store.js";
import { runAll, runTrack } from "../jobs/run.js";
import { TRACKS, TRACK_IDS } from "../tracks/index.js";
import { statusLabel } from "../format.js";

type Ctx = BotContext<Session>;

const VALID_TOPIC: TopicKey[] = ["A", "B", "inbox", "digest"];

function helpText(): string {
  return [
    "<b>AI Career Agent</b> — личный агент поиска работы.",
    "",
    "Ищет вакансии по двум трекам, оценивает через ИИ и постит в топики этой группы.",
    "",
    "<b>Настройка (один раз):</b>",
    "1. Создай в этой супергруппе топики (Темы): для трека A, трека B, «Отклики», «Аналитика».",
    "2. Зайди в нужный топик и выполни там команду привязки:",
    "   • <code>/bind A</code> — топик трека A",
    "   • <code>/bind B</code> — топик трека B",
    "   • <code>/bind inbox</code> — топик откликов/переписки",
    "   • <code>/bind digest</code> — топик аналитики",
    "",
    "<b>Команды:</b>",
    "/run — искать по обоим трекам сейчас (<code>/run A</code> — только трек A)",
    "/status — привязки топиков и воронка",
    "/help — эта справка",
    "",
    `Трек A: ${TRACKS.A.title}`,
    `Трек B: ${TRACKS.B.title}`,
  ].join("\n");
}

export function registerCommands(bot: Bot<Ctx>): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });
  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  // Привязка топика: выполняется ВНУТРИ нужного топика.
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
    if (chat.type !== "supergroup") {
      await ctx.reply("Привязка работает только в супергруппе с включёнными «Темами». Создай группу, включи темы и добавь меня админом.");
      return;
    }
    const threadId = ctx.message?.message_thread_id;
    if (threadId === undefined) {
      await ctx.reply("Запусти команду ВНУТРИ нужного топика (не в «General») — мне нужен id темы.");
      return;
    }
    await store.bindTopic(key, chat.id, threadId);
    await ctx.reply(`✅ Топик привязан: <b>${key}</b> (group ${chat.id}, thread ${threadId}).`, { parse_mode: "HTML" });
  });

  // Ручной запуск поиска.
  bot.command("run", async (ctx) => {
    const arg = (ctx.match ?? "").trim().toUpperCase();
    if (!store.meta.groupId) {
      await ctx.reply("Сначала привяжи топики: см. /help.");
      return;
    }
    if (arg === "A" || arg === "B") {
      const notBound = store.threadId(arg as TrackId) === undefined;
      if (notBound) {
        await ctx.reply(`Топик трека ${arg} не привязан. Зайди в него и выполни /bind ${arg}.`);
        return;
      }
      await ctx.reply(`🔎 Ищу по треку ${arg}…`);
      const n = await runTrack(ctx.api, arg as TrackId);
      await ctx.reply(`Готово: трек ${arg} — ${n} нов.`);
      return;
    }
    await ctx.reply("🔎 Ищу по обоим трекам…");
    const res = await runAll(ctx.api);
    await ctx.reply(`Готово: ${TRACK_IDS.map((t) => `${t}=${res[t] ?? 0}`).join(", ")}`);
  });

  // Статус: привязки + воронка.
  bot.command("status", async (ctx) => {
    const m = store.meta;
    const lines: string[] = ["<b>📊 Статус</b>", ""];
    lines.push(`Группа: ${m.groupId ?? "— не привязана"}`);
    lines.push(
      "Топики: " +
        VALID_TOPIC.map((k) => `${k}=${m.topics[k] ?? "—"}`).join("  "),
    );

    const all = store.allVacancies();
    const byStatus = new Map<string, number>();
    for (const v of all) byStatus.set(v.status, (byStatus.get(v.status) ?? 0) + 1);
    lines.push("");
    lines.push(`Вакансий в истории: <b>${all.length}</b>`);
    if (byStatus.size) {
      lines.push(
        [...byStatus.entries()].map(([s, n]) => `${statusLabel(s)}: ${n}`).join("\n"),
      );
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.api
    .setMyCommands([
      { command: "run", description: "Искать вакансии сейчас" },
      { command: "status", description: "Статус и воронка" },
      { command: "bind", description: "Привязать текущий топик (A/B/inbox/digest)" },
      { command: "help", description: "Как это работает" },
    ])
    .catch((e) => console.warn("[setMyCommands]", e?.message ?? e));
}
