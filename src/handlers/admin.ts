import { type Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session } from "../types.js";
import { store } from "../store.js";
import { config } from "../config.js";
import { escapeHtml } from "../format.js";
import { ADMIN_FIELDS, adminField, displayValue } from "../settings.js";
import { chat } from "../ai/openrouter.js";

type Ctx = BotContext<Session>;

/** Экран /admin: текущие значения (секреты замаскированы) + кнопки правки. */
function renderAdmin(): { text: string; keyboard: InlineKeyboard } {
  const lines: string[] = ["<b>🛠 Админ-настройки</b>", "", "Меняются на лету, сохраняются между перезапусками.", ""];
  for (const f of ADMIN_FIELDS) {
    lines.push(`<b>${escapeHtml(f.label)}</b>`);
    lines.push(`<code>${escapeHtml(displayValue(f.key))}</code>`);
    lines.push("");
  }

  const kb = new InlineKeyboard();
  ADMIN_FIELDS.forEach((f, i) => {
    kb.text(`✏️ ${f.label.replace(/\s*\(.*\)$/, "")}`, `adm:set:${f.key}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("🔌 Проверить OpenRouter", "adm:test");
  return { text: lines.join("\n"), keyboard: kb };
}

export function registerAdmin(bot: Bot<Ctx>): void {
  bot.command("admin", async (ctx) => {
    const { text, keyboard } = renderAdmin();
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard, link_preview_options: { is_disabled: true } });
  });

  // ── Нажали «✏️ поле» → ждём новое значение ──
  bot.callbackQuery(/^adm:set:(.+)$/, async (ctx) => {
    const key = (ctx.match as RegExpMatchArray)[1];
    const f = adminField(key);
    if (!f) {
      await ctx.answerCallbackQuery({ text: "Неизвестная настройка" });
      return;
    }
    ctx.session.awaiting = { kind: "admin_field", key };
    await ctx.answerCallbackQuery();
    const hint = f.hint ? `\n<i>${escapeHtml(f.hint)}</i>` : "";
    const secretNote = f.secret ? "\n🔒 Сообщение с ключом удалю сразу после сохранения." : "";
    await ctx.reply(`Пришли новое значение для «<b>${escapeHtml(f.label)}</b>».${hint}${secretNote}`, {
      parse_mode: "HTML",
    });
  });

  // ── Проверка доступности OpenRouter (тестовый мини-запрос) ──
  bot.callbackQuery("adm:test", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Проверяю…" });
    const model = config.scoreModels[0] ?? config.letterModel;
    if (!config.openRouterKey) {
      await ctx.reply("❌ OpenRouter API-ключ не задан. Впиши его через ✏️.");
      return;
    }
    try {
      await chat({ model, user: "ping", maxTokens: 5 }, 20000);
      await ctx.reply(`✅ OpenRouter отвечает. Модель <code>${escapeHtml(model)}</code> доступна.`, {
        parse_mode: "HTML",
      });
    } catch (e: any) {
      await ctx.reply(`❌ OpenRouter недоступен:\n<code>${escapeHtml(String(e?.message ?? e).slice(0, 300))}</code>`, {
        parse_mode: "HTML",
      });
    }
  });

  // ── Приём нового значения настройки ──
  bot.on("message:text", async (ctx, next) => {
    const a = ctx.session.awaiting;
    if (a?.kind !== "admin_field") return next();
    const f = adminField(a.key);
    ctx.session.awaiting = undefined;
    if (!f) {
      await ctx.reply("Настройка не найдена.");
      return;
    }
    const value = ctx.message.text.trim();
    await store.setSetting(f.key, value);

    // Секрет — стираем сообщение с ключом из чата, чтобы не висело в истории.
    if (f.secret) {
      await ctx.deleteMessage().catch(() => {});
    }
    await ctx.reply(
      `✅ «${escapeHtml(f.label)}» обновлено: <code>${escapeHtml(displayValue(f.key))}</code>\nПрименено сразу, перезапуск не нужен.`,
      { parse_mode: "HTML" },
    );
  });
}
