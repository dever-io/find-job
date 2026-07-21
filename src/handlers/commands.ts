import type { Bot } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session, Status, TrackId } from "../types.js";
import { store } from "../store.js";
import { runAll, runTrack } from "../jobs/run.js";
import { postDigest } from "../jobs/digest.js";
import { statusLabel } from "../format.js";
import { sourceHealth } from "../sources/index.js";

type Ctx = BotContext<Session>;

function helpText(): string {
  const tracks = store.tracks();
  const trackLines = tracks.length
    ? tracks.map((t) => `${t.hashtag} — ${t.title}`)
    : ["Треки не настроены — напиши /start и пришли резюме."];
  return [
    "<b>AI Career Agent</b> — личный агент поиска работы.",
    "",
    "Ищу вакансии по твоим трекам, оцениваю через ИИ и присылаю сюда карточки. Каждая подборка помечена хэштегом — жми по нему, чтобы увидеть всё по теме.",
    "",
    "<b>Настройка:</b> /start → пришли резюме (PDF или текст) → отвечай на вопросы. Всё.",
    "",
    "<b>Как отвечать на вакансию:</b>",
    "Под карточкой — кнопки. 👍 <b>Откликнуться</b> генерит письмо (#отклик); его можно сделать <i>короче/официальнее</i>, править текстом или зафиксировать ✅.",
    "",
    "<b>Команды:</b>",
    "/start — начать заново / прислать резюме",
    "/run — искать сейчас (<code>/run A</code> — только один трек)",
    "/status — воронка по трекам",
    "/digest — аналитика за неделю (#аналитика)",
    "/help — эта справка",
    "",
    "<b>Твои подборки:</b>",
    ...trackLines,
  ].join("\n");
}

/** Строка о сломанных источниках (пусто, если все живы). */
function sourceWarning(): string {
  const bad = sourceHealth().filter((s) => s.error);
  if (!bad.length) return "";
  return (
    "\n\n⚠️ Источник недоступен: " +
    bad.map((s) => `${s.label} (${s.error?.slice(0, 60)})`).join("; ") +
    "\nВакансии оттуда сейчас не приходят."
  );
}

export function registerCommands(bot: Bot<Ctx>): void {
  // /start живёт в онбординге (handlers/onboarding.ts).
  bot.command("help", async (ctx) => {
    await ctx.reply(helpText(), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  // Ручной запуск поиска.
  bot.command("run", async (ctx) => {
    if (!store.hasTracks()) {
      await ctx.reply("Сначала /start и пришли резюме — я настрою треки.");
      return;
    }
    if (store.meta.chatId === undefined) {
      await ctx.reply("Не знаю, куда постить. Напиши /start ещё раз.");
      return;
    }
    const arg = (ctx.match ?? "").trim().toUpperCase();
    if (arg === "A" || arg === "B") {
      const id = arg as TrackId;
      if (!store.getTrack(id)) {
        await ctx.reply(`Трек ${arg} не настроен.`);
        return;
      }
      await ctx.reply(`🔎 Ищу по треку ${arg}…`);
      const n = await runTrack(ctx.api, id);
      await ctx.reply(`Готово: трек ${arg} — ${n} нов.` + sourceWarning());
      return;
    }
    await ctx.reply("🔎 Ищу по всем трекам…");
    const res = await runAll(ctx.api);
    await ctx.reply(
      "Готово: " + store.tracks().map((t) => `${t.hashtag}=${res[t.id] ?? 0}`).join(", ") + sourceWarning(),
    );
  });

  // Ручной дайджест (#аналитика).
  bot.command("digest", async (ctx) => {
    if (store.meta.chatId === undefined) {
      await ctx.reply("Сначала /start.");
      return;
    }
    await postDigest(ctx.api);
  });

  // Статус: воронка по трекам.
  bot.command("status", async (ctx) => {
    const lines: string[] = ["<b>📊 Статус</b>", ""];
    lines.push(`Чат: ${store.meta.chatId ?? "— не настроен (/start)"}`);
    lines.push(`Треки: ${store.hasTracks() ? store.tracks().map((t) => t.hashtag).join(" ") : "нет (/start)"}`);

    const all = store.allVacancies();
    lines.push("");
    lines.push(`Вакансий в истории: <b>${all.length}</b>`);

    // Здоровье источников по последнему поиску (если он уже был в этом запуске).
    const health = sourceHealth();
    if (health.length) {
      lines.push("");
      lines.push("<b>Источники (последний поиск):</b>");
      for (const s of health) {
        lines.push(s.error ? `❌ ${s.label} — ${s.error.slice(0, 70)}` : `✅ ${s.label} — ${s.count}`);
      }
    }

    const ORDER: Status[] = ["Viewed", "Saved", "Responded", "Interview", "Offer", "Rejected", "Ignored"];
    for (const track of store.tracks()) {
      const rows = all.filter((v) => v.track === track.id);
      if (!rows.length) continue;
      const by = new Map<Status, number>();
      for (const v of rows) by.set(v.status, (by.get(v.status) ?? 0) + 1);
      const parts = ORDER.filter((s) => by.has(s)).map((s) => `${statusLabel(s)}: ${by.get(s)}`);
      lines.push("");
      lines.push(`<b>${track.title}</b> ${track.hashtag} (${rows.length})`);
      lines.push(parts.join("\n"));
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.api
    .setMyCommands([
      { command: "start", description: "Начать / прислать резюме" },
      { command: "run", description: "Искать вакансии сейчас" },
      { command: "status", description: "Статус и воронка" },
      { command: "settings", description: "Треки и источники" },
      // /admin намеренно НЕ в меню — служебная команда владельца (работает по вводу).
      { command: "digest", description: "Собрать аналитику за неделю" },
      { command: "help", description: "Как это работает" },
    ])
    .catch((e) => console.warn("[setMyCommands]", e?.message ?? e));
}
