import { type Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session } from "../types.js";
import { store } from "../store.js";
import { config } from "../config.js";
import { escapeHtml } from "../format.js";
import { TEXT_FIELDS, isSecret, displayValue } from "../settings.js";
import { PROVIDERS, providerDef, providerLabel } from "../providers.js";
import { chat, listModels } from "../ai/openrouter.js";

type Ctx = BotContext<Session>;

/** /admin доступен только владельцу (OWNER_ID из env, иначе пойманный в рантайме). */
function isOwner(ctx: Ctx): boolean {
  const owner = config.ownerId ?? store.meta.ownerId;
  return Boolean(owner) && ctx.from?.id === owner;
}
async function denyIfNotOwner(ctx: Ctx): Promise<boolean> {
  if (isOwner(ctx)) return false;
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Только для владельца" }).catch(() => {});
  else await ctx.reply("⛔ Команда доступна только владельцу бота.").catch(() => {});
  return true;
}

// ── Экран /admin ──
function renderAdmin(): { text: string; keyboard: InlineKeyboard } {
  const lines: string[] = [
    "<b>🛠 Админ-настройки</b>",
    "Меняются на лету, сохраняются между перезапусками.",
    "",
    `<b>Провайдер ИИ:</b> ${escapeHtml(providerLabel())}`,
    `<b>API-ключ:</b> <code>${escapeHtml(displayValue("aiKey"))}</code>`,
    `<b>Модель писем:</b> <code>${escapeHtml(displayValue("letterModel"))}</code>`,
    `<b>Модели скоринга:</b> <code>${escapeHtml(displayValue("scoreModels"))}</code>`,
    `<b>SOCKS-прокси ИИ:</b> <code>${escapeHtml(displayValue("aiProxy"))}</code>`,
    `<b>SOCKS-прокси hh.ru:</b> <code>${escapeHtml(displayValue("hhScrapeProxy"))}</code>`,
    `<b>Порог совпадения:</b> <code>${escapeHtml(displayValue("scoreThreshold"))}</code>`,
  ];
  if (config.aiProvider === "custom") {
    lines.push(`<b>Свой base URL:</b> <code>${escapeHtml(displayValue("aiBase") || "— не задан")}</code>`);
  }

  const kb = new InlineKeyboard()
    .text("🔀 Провайдер", "adm:prov").text("🔑 API-ключ", "adm:field:aiKey").row()
    .text("✉️ Модель писем", "adm:lm").text("🎯 Модели скоринга", "adm:sm").row()
    .text("🌐 Прокси ИИ", "adm:field:aiProxy").text("🌐 Прокси hh", "adm:field:hhScrapeProxy").row()
    .text("📊 Порог", "adm:field:scoreThreshold").text("🔌 Проверить ИИ", "adm:test").row();
  return { text: lines.join("\n"), keyboard: kb };
}

async function showAdmin(ctx: Ctx, edit: boolean): Promise<void> {
  const { text, keyboard } = renderAdmin();
  const opts = { parse_mode: "HTML" as const, reply_markup: keyboard, link_preview_options: { is_disabled: true } };
  if (edit) await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
  else await ctx.reply(text, opts);
}

// ── Кэш и состояние пикера моделей (бот однопользовательский) ──
const PAGE = 8;
let modelCache: string[] = [];
let modelCacheAt = 0;
let view: string[] = []; // текущий (отфильтрованный) список для пагинации
let scoreDraft: Set<string> = new Set();

async function loadModels(force = false): Promise<string[]> {
  if (!force && modelCache.length && Date.now() - modelCacheAt < 5 * 60_000) return modelCache;
  modelCache = await listModels();
  modelCacheAt = Date.now();
  return modelCache;
}

const shorten = (s: string): string => (s.length > 42 ? s.slice(0, 40) + "…" : s);

function renderModels(target: "letter" | "score", page: number): { text: string; keyboard: InlineKeyboard } {
  const total = view.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = view.slice(p * PAGE, p * PAGE + PAGE);
  const pfx = target === "letter" ? "lm" : "sm";
  const kb = new InlineKeyboard();
  slice.forEach((m, i) => {
    const idx = p * PAGE + i;
    if (target === "score") {
      const on = scoreDraft.has(m);
      kb.text(`${on ? "✅ " : "▫️ "}${shorten(m)}`, `adm:sm:tg:${idx}:${p}`).row();
    } else {
      kb.text(shorten(m), `adm:lm:pk:${idx}`).row();
    }
  });
  const nav: [string, string][] = [];
  if (p > 0) nav.push(["◀️", `adm:${pfx}:pg:${p - 1}`]);
  if (p < pages - 1) nav.push(["▶️", `adm:${pfx}:pg:${p + 1}`]);
  if (nav.length) {
    for (const [t, d] of nav) kb.text(t, d);
    kb.row();
  }
  kb.text("🔍 Фильтр", `adm:${pfx}:find`);
  if (target === "score") kb.text(`💾 Сохранить (${scoreDraft.size})`, "adm:sm:save");
  kb.row().text("⬅️ Назад", "adm:home");

  const head =
    target === "letter"
      ? "Выбери <b>модель для писем</b>"
      : "Отметь <b>модели скоринга</b> (можно несколько), затем «Сохранить»";
  const text = `${head}\nПровайдер: ${escapeHtml(providerLabel())} · всего моделей: ${total} · стр. ${p + 1}/${pages}\n<i>🔍 Фильтр — часть названия.</i>`;
  return { text, keyboard: kb };
}

async function openModelPicker(ctx: Ctx, target: "letter" | "score"): Promise<void> {
  if (!config.aiKey) {
    await ctx.answerCallbackQuery({ text: "Сначала впиши API-ключ" });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Загружаю модели…" });
  try {
    await loadModels();
  } catch (e: any) {
    await ctx.reply(`❌ Не удалось получить список моделей:\n<code>${escapeHtml(String(e?.message ?? e).slice(0, 250))}</code>`, {
      parse_mode: "HTML",
    });
    return;
  }
  view = modelCache;
  if (target === "score") scoreDraft = new Set(config.scoreModels);
  const { text, keyboard } = renderModels(target, 0);
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard }));
}

export function registerAdmin(bot: Bot<Ctx>): void {
  bot.command("admin", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await showAdmin(ctx, false);
  });

  bot.callbackQuery("adm:home", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await showAdmin(ctx, true);
  });

  // ── Провайдер: список ──
  bot.callbackQuery("adm:prov", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const p of PROVIDERS) {
      const mark = p.id === config.aiProvider ? "🟢 " : "";
      kb.text(`${mark}${p.label}`, `adm:prov:${p.id}`).row();
    }
    kb.text("⬅️ Назад", "adm:home");
    await ctx.editMessageText("Выбери провайдера ИИ:", { reply_markup: kb }).catch(() => {});
  });

  // ── Провайдер: выбор ──
  bot.callbackQuery(/^adm:prov:(.+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const id = (ctx.match as RegExpMatchArray)[1];
    const def = providerDef(id);
    if (!def) {
      await ctx.answerCallbackQuery({ text: "Неизвестный провайдер" });
      return;
    }
    await store.setSetting("aiProvider", id);
    if (id !== "custom") await store.setSetting("aiBase", ""); // база из реестра
    modelCache = []; // сбрасываем кэш моделей — у нового провайдера свои
    await ctx.answerCallbackQuery({ text: `Провайдер: ${def.label}` });
    if (id === "custom") {
      ctx.session.awaiting = { kind: "admin_field", key: "aiBase" };
      await ctx.reply("Пришли base URL OpenAI-совместимого API (напр. https://host/v1).");
      return;
    }
    await ctx.reply(
      `✅ Провайдер: <b>${escapeHtml(def.label)}</b>.\nТеперь впиши API-ключ (🔑) для него${def.keyHint ? ` — формат ${escapeHtml(def.keyHint)}` : ""}, затем выбери модели.`,
      { parse_mode: "HTML" },
    );
  });

  // ── Пикеры моделей ──
  bot.callbackQuery("adm:lm", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await openModelPicker(ctx, "letter");
  });
  bot.callbackQuery("adm:sm", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await openModelPicker(ctx, "score");
  });

  bot.callbackQuery(/^adm:(lm|sm):pg:(\d+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const m = ctx.match as RegExpMatchArray;
    const target = m[1] === "lm" ? "letter" : "score";
    await ctx.answerCallbackQuery();
    const { text, keyboard } = renderModels(target, Number(m[2]));
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
  });

  // выбор модели писем
  bot.callbackQuery(/^adm:lm:pk:(\d+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const idx = Number((ctx.match as RegExpMatchArray)[1]);
    const model = view[idx];
    if (!model) {
      await ctx.answerCallbackQuery({ text: "Список устарел, открой заново" });
      return;
    }
    await store.setSetting("letterModel", model);
    await ctx.answerCallbackQuery({ text: "Модель писем сохранена" });
    await showAdmin(ctx, true);
  });

  // тоггл модели скоринга
  bot.callbackQuery(/^adm:sm:tg:(\d+):(\d+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const mm = ctx.match as RegExpMatchArray;
    const idx = Number(mm[1]);
    const model = view[idx];
    if (model) {
      if (scoreDraft.has(model)) scoreDraft.delete(model);
      else scoreDraft.add(model);
    }
    await ctx.answerCallbackQuery();
    const { text, keyboard } = renderModels("score", Number(mm[2]));
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
  });

  // сохранить модели скоринга
  bot.callbackQuery("adm:sm:save", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    if (!scoreDraft.size) {
      await ctx.answerCallbackQuery({ text: "Выбери хотя бы одну модель" });
      return;
    }
    await store.setSetting("scoreModels", [...scoreDraft].join(","));
    await ctx.answerCallbackQuery({ text: `Сохранено моделей: ${scoreDraft.size}` });
    await showAdmin(ctx, true);
  });

  // фильтр списка моделей
  bot.callbackQuery(/^adm:(lm|sm):find$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const target = (ctx.match as RegExpMatchArray)[1] === "lm" ? "letter" : "score";
    ctx.session.awaiting = { kind: "admin_model_filter", target };
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли часть названия модели для фильтра (или «-» — показать все).");
  });

  // ── Свободный ввод текстовых полей (кнопки adm:field:<key>) ──
  bot.callbackQuery(/^adm:field:(.+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const key = (ctx.match as RegExpMatchArray)[1];
    const tf = TEXT_FIELDS.find((f) => f.key === key);
    if (!tf) {
      await ctx.answerCallbackQuery({ text: "Неизвестное поле" });
      return;
    }
    ctx.session.awaiting = { kind: "admin_field", key };
    await ctx.answerCallbackQuery();
    const hint = tf.hint ? `\n<i>${escapeHtml(tf.hint)}</i>` : "";
    const secretNote = isSecret(key) ? "\n🔒 Сообщение с ключом удалю сразу после сохранения." : "";
    await ctx.reply(`Пришли новое значение для «<b>${escapeHtml(tf.label)}</b>».${hint}${secretNote}`, { parse_mode: "HTML" });
  });

  // ── Проверка провайдера ──
  bot.callbackQuery("adm:test", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await ctx.answerCallbackQuery({ text: "Проверяю…" });
    if (!config.aiKey) {
      await ctx.reply("❌ API-ключ не задан. Впиши его через 🔑.");
      return;
    }
    const model = config.scoreModels[0] ?? config.letterModel;
    try {
      await chat({ model, user: "ping", maxTokens: 5 }, 20000);
      await ctx.reply(`✅ ${escapeHtml(providerLabel())} отвечает. Модель <code>${escapeHtml(model)}</code> доступна.`, {
        parse_mode: "HTML",
      });
    } catch (e: any) {
      await ctx.reply(`❌ Провайдер недоступен:\n<code>${escapeHtml(String(e?.message ?? e).slice(0, 300))}</code>`, {
        parse_mode: "HTML",
      });
    }
  });

  // ── Приём текста: значение поля ИЛИ фильтр моделей ──
  bot.on("message:text", async (ctx, next) => {
    const a = ctx.session.awaiting;
    if (a?.kind === "admin_model_filter") {
      const q = ctx.message.text.trim().toLowerCase();
      ctx.session.awaiting = undefined;
      view = q === "-" || !q ? modelCache : modelCache.filter((m) => m.toLowerCase().includes(q));
      if (!view.length) {
        view = modelCache;
        await ctx.reply("Ничего не найдено — показываю все модели.");
      }
      const { text, keyboard } = renderModels(a.target, 0);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }
    if (a?.kind !== "admin_field") return next();
    const key = a.key;
    ctx.session.awaiting = undefined;
    const value = ctx.message.text.trim();
    await store.setSetting(key, value);
    if (isSecret(key)) await ctx.deleteMessage().catch(() => {});
    const label = TEXT_FIELDS.find((f) => f.key === key)?.label ?? key;
    await ctx.reply(
      `✅ «${escapeHtml(label)}» обновлено: <code>${escapeHtml(displayValue(key))}</code>\nПрименено сразу.`,
      { parse_mode: "HTML" },
    );
  });
}
