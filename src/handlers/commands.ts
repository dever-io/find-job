import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, Status, TrackId } from "../types.js";
import { store } from "../store.js";
import type { TopicKey } from "../store.js";
import { runAll, runTrack } from "../jobs/run.js";
import { postDigest } from "../jobs/digest.js";
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
    "Просто напиши <code>/setup</code> — я сам создам 4 темы (Track A, Track B, «Отклики», «Аналитика») и привяжу их.",
    "Работает прямо здесь, в личке (нужен включённый Threaded Mode у @BotFather), либо в супергруппе с Темами.",
    "Если предпочитаешь вручную — зайди в тему и выполни <code>/bind A</code> / <code>B</code> / <code>inbox</code> / <code>digest</code>.",
    "",
    "<b>Как отвечать на вакансию:</b>",
    "Под карточкой — кнопки. 👍 <b>Откликнуться</b> генерит сопроводительное письмо в топик «Отклики»; там его можно сделать <i>короче/официальнее</i>, править текстом (пришли сообщение) или зафиксировать кнопкой ✅.",
    "⚠️ Чтобы я видел твои текстовые правки, выключи мне privacy mode у @BotFather (Bot Settings → Group Privacy → Turn off).",
    "",
    "<b>Команды:</b>",
    "/run — искать по обоим трекам сейчас (<code>/run A</code> — только трек A)",
    "/status — привязки топиков и воронка по трекам",
    "/digest — аналитика за неделю в топик «Аналитика»",
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

  // Авто-настройка: бот сам создаёт 4 темы и привязывает их.
  // Работает в личке (Threaded Mode) или в супергруппе с Темами.
  bot.command("setup", async (ctx) => {
    const chat = ctx.chat!;
    if (chat.type !== "private" && chat.type !== "supergroup") {
      await ctx.reply("Запусти /setup в личке со мной (включи Threaded Mode у @BotFather) или в супергруппе с Темами.");
      return;
    }
    // В личке первый /setup ловит владельца.
    if (chat.type === "private" && ctx.from && store.meta.ownerId === undefined) {
      await store.setOwner(ctx.from.id);
    }

    const TOPICS: Array<{ key: TopicKey; name: string }> = [
      { key: "A", name: "Track A · Продакшн" },
      { key: "B", name: "Track B · IT PM" },
      { key: "inbox", name: "Отклики" },
      { key: "digest", name: "Аналитика" },
    ];
    const report: string[] = [];
    for (const t of TOPICS) {
      // Уже привязана — не плодим дубликаты.
      if (store.threadId(t.key) !== undefined) {
        report.push(`• ${t.name} — уже привязана`);
        continue;
      }
      try {
        const topic = await ctx.api.createForumTopic(chat.id, t.name);
        await store.bindTopic(t.key, chat.id, topic.message_thread_id);
        report.push(`• ${t.name} ✅`);
      } catch (e: any) {
        report.push(`• ${t.name} — ошибка: ${e?.description ?? e?.message ?? e}`);
      }
    }
    await ctx.reply(
      ["<b>Настройка тем</b>", ...report, "", "Готово. Дальше — задай OPENROUTER_API_KEY и жми /run."].join("\n"),
      { parse_mode: "HTML" },
    );
  });

  // Привязка топика вручную: выполняется ВНУТРИ нужного топика.
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

  // Ручной дайджест в топик «Аналитика».
  bot.command("digest", async (ctx) => {
    if (!store.meta.groupId) {
      await ctx.reply("Сначала привяжи топики: см. /help.");
      return;
    }
    const ok = await postDigest(ctx.api);
    if (ok && store.threadId("digest") === undefined) {
      await ctx.reply("⚠️ Топик «Аналитика» не привязан (/bind digest) — отправил в General.");
    }
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
    lines.push("");
    lines.push(`Вакансий в истории: <b>${all.length}</b>`);

    // Воронка по трекам.
    const ORDER: Status[] = ["Viewed", "Saved", "Responded", "Interview", "Offer", "Rejected", "Ignored"];
    for (const t of TRACK_IDS) {
      const rows = all.filter((v) => v.track === t);
      if (!rows.length) continue;
      const by = new Map<Status, number>();
      for (const v of rows) by.set(v.status, (by.get(v.status) ?? 0) + 1);
      const parts = ORDER.filter((s) => by.has(s)).map((s) => `${statusLabel(s)}: ${by.get(s)}`);
      lines.push("");
      lines.push(`<b>Трек ${t}</b> (${rows.length})`);
      lines.push(parts.join("\n"));
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.api
    .setMyCommands([
      { command: "setup", description: "Создать и привязать темы автоматически" },
      { command: "run", description: "Искать вакансии сейчас" },
      { command: "status", description: "Статус и воронка" },
      { command: "digest", description: "Собрать аналитику за неделю" },
      { command: "bind", description: "Привязать текущую тему вручную (A/B/inbox/digest)" },
      { command: "help", description: "Как это работает" },
    ])
    .catch((e) => console.warn("[setMyCommands]", e?.message ?? e));
}
