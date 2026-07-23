import { type Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../toolkit.js";
import type { Session } from "../types.js";
import { store } from "../store.js";
import { config } from "../config.js";
import { escapeHtml } from "../format.js";
import { TEXT_FIELDS, KEY_LABEL, isSecret, displayValue } from "../settings.js";
import { PROVIDERS, providerDef, providerLabelOf, endpointFor, roleHasOwn, keyFor, chatUrlFor, type Role } from "../providers.js";
import { chat, listModels } from "../ai/openrouter.js";

type Ctx = BotContext<Session>;
type Scope = "main" | "score" | "letter";

/** Поля config для каждого «места» настройки провайдера. */
const SCOPE_FIELDS: Record<Scope, { provider: string; base: string; key: string }> = {
  main: { provider: "aiProvider", base: "aiBase", key: "aiKey" },
  score: { provider: "scoreProvider", base: "scoreBase", key: "scoreKey" },
  letter: { provider: "letterProvider", base: "letterBase", key: "letterKey" },
};
const TASK_TITLE: Record<"score" | "letter", string> = { score: "📊 Скоринг вакансий", letter: "✉️ Сопроводительные письма" };

// ── Owner-guard ──
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

// ── Главный экран ──
function taskLine(role: "score" | "letter"): string {
  const ep = endpointFor(role);
  const prov = roleHasOwn(role) ? providerLabelOf(ep.providerId) : `как общий (${providerLabelOf(ep.providerId)})`;
  const models = role === "score" ? displayValue("scoreModels") : displayValue("letterModel");
  return `${TASK_TITLE[role]}\n   провайдер: ${escapeHtml(prov)}\n   ${role === "score" ? "модели" : "модель"}: <code>${escapeHtml(models)}</code>`;
}

function renderAdmin(): { text: string; keyboard: InlineKeyboard } {
  const lines = [
    "<b>🛠 Настройки ИИ</b>",
    "Меняются на лету, сохраняются между перезапусками.",
    "",
    `<b>Общий провайдер:</b> ${escapeHtml(providerLabelOf(config.aiProvider))} · ключ <code>${escapeHtml(displayValue("aiKey"))}</code>`,
    config.aiProvider === "custom" ? `<b>Общий base URL:</b> <code>${escapeHtml(displayValue("aiBase") || "— не задан")}</code>` : "",
    "",
    taskLine("score"),
    "",
    taskLine("letter"),
  ].filter(Boolean);

  const kb = new InlineKeyboard()
    .text("🔀 Общий провайдер", "adm:pv:main").text("🔑 Общий ключ", "adm:key:main").row()
    .text("📊 Настроить скоринг", "adm:task:score").text("✉️ Настроить письма", "adm:task:letter").row()
    .text("🌐 Прокси ИИ", "adm:field:aiProxy").text("🌐 Прокси hh", "adm:field:hhScrapeProxy").row()
    .text("📊 Порог", "adm:field:scoreThreshold").text("🔌 Проверить всё", "adm:test:all").row();
  return { text: lines.join("\n"), keyboard: kb };
}

// ── Экран задачи (score/letter) ──
function renderTask(role: "score" | "letter"): { text: string; keyboard: InlineKeyboard } {
  const own = roleHasOwn(role);
  const ep = endpointFor(role);
  const f = SCOPE_FIELDS[role];
  const provLine = own ? providerLabelOf(ep.providerId) : `↩️ как общий (${providerLabelOf(ep.providerId)})`;
  const keyLine = own ? displayValue(f.key) : "как общий";
  const models = role === "score" ? displayValue("scoreModels") : displayValue("letterModel");
  const lines = [
    `<b>${TASK_TITLE[role]}</b>`,
    "",
    `<b>Провайдер:</b> ${escapeHtml(provLine)}`,
    `<b>Ключ:</b> <code>${escapeHtml(keyLine)}</code>`,
    `<b>${role === "score" ? "Модели" : "Модель"}:</b> <code>${escapeHtml(models)}</code>`,
    own && config.aiProvider !== ep.providerId && providerDef(ep.providerId)?.id === "custom"
      ? `<b>base URL:</b> <code>${escapeHtml(displayValue(f.base))}</code>`
      : "",
  ].filter(Boolean);

  const kb = new InlineKeyboard()
    .text("🔀 Провайдер задачи", `adm:pv:${role}`).text("🔑 Ключ задачи", `adm:key:${role}`).row()
    .text(role === "score" ? "🎯 Выбрать модели" : "✉️ Выбрать модель", role === "score" ? "adm:sm" : "adm:lm").row();
  if (own) kb.text("↩️ Использовать общий", `adm:inherit:${role}`).row();
  kb.text("🔌 Проверить", `adm:test:${role}`).text("⬅️ Назад", "adm:home");
  return { text: lines.join("\n"), keyboard: kb };
}

async function show(ctx: Ctx, screen: { text: string; keyboard: InlineKeyboard }, edit: boolean): Promise<void> {
  const opts = { parse_mode: "HTML" as const, reply_markup: screen.keyboard, link_preview_options: { is_disabled: true } };
  if (edit) await ctx.editMessageText(screen.text, opts).catch(() => ctx.reply(screen.text, opts));
  else await ctx.reply(screen.text, opts);
}

// ── Пикер моделей (роль-зависимый) ──
const PAGE = 8;
let modelCache: string[] = [];
let modelRole: Role | null = null;
let view: string[] = [];
let scoreDraft: Set<string> = new Set();

async function loadModels(role: Role): Promise<string[]> {
  if (modelCache.length && modelRole === role) return modelCache;
  modelCache = await listModels(role);
  modelRole = role;
  return modelCache;
}
const shorten = (s: string): string => (s.length > 42 ? s.slice(0, 40) + "…" : s);

function renderModels(role: "letter" | "score", page: number): { text: string; keyboard: InlineKeyboard } {
  const total = view.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = view.slice(p * PAGE, p * PAGE + PAGE);
  const pfx = role === "letter" ? "lm" : "sm";
  const kb = new InlineKeyboard();
  slice.forEach((m, i) => {
    const idx = p * PAGE + i;
    if (role === "score") kb.text(`${scoreDraft.has(m) ? "✅ " : "▫️ "}${shorten(m)}`, `adm:sm:tg:${idx}:${p}`).row();
    else kb.text(shorten(m), `adm:lm:pk:${idx}`).row();
  });
  const nav: [string, string][] = [];
  if (p > 0) nav.push(["◀️", `adm:${pfx}:pg:${p - 1}`]);
  if (p < pages - 1) nav.push(["▶️", `adm:${pfx}:pg:${p + 1}`]);
  for (const [t, d] of nav) kb.text(t, d);
  if (nav.length) kb.row();
  kb.text("🔍 Фильтр", `adm:${pfx}:find`);
  if (role === "score") kb.text(`💾 Сохранить (${scoreDraft.size})`, "adm:sm:save");
  kb.row().text("⬅️ Назад", `adm:task:${role}`);
  const head = role === "letter" ? "Выбери <b>модель для писем</b>" : "Отметь <b>модели скоринга</b>, затем «Сохранить»";
  const prov = providerLabelOf(endpointFor(role).providerId);
  return {
    text: `${head}\nПровайдер: ${escapeHtml(prov)} · моделей: ${total} · стр. ${p + 1}/${pages}\n<i>🔍 Фильтр — часть названия.</i>`,
    keyboard: kb,
  };
}

async function openModelPicker(ctx: Ctx, role: "letter" | "score"): Promise<void> {
  if (!keyFor(role)) {
    await ctx.answerCallbackQuery({ text: "Сначала задай ключ (общий или задачи)" });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Загружаю модели…" });
  try {
    await loadModels(role);
  } catch (e: any) {
    await ctx.reply(`❌ Не удалось получить список моделей:\n<code>${escapeHtml(String(e?.message ?? e).slice(0, 250))}</code>`, { parse_mode: "HTML" });
    return;
  }
  view = modelCache;
  if (role === "score") scoreDraft = new Set(config.scoreModels);
  await show(ctx, renderModels(role, 0), true);
}

export function registerAdmin(bot: Bot<Ctx>): void {
  bot.command("admin", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await show(ctx, renderAdmin(), false);
  });
  bot.callbackQuery("adm:home", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await show(ctx, renderAdmin(), true);
  });
  bot.callbackQuery(/^adm:task:(score|letter)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await show(ctx, renderTask((ctx.match as RegExpMatchArray)[1] as "score" | "letter"), true);
  });

  // ── Провайдер: список для scope ──
  bot.callbackQuery(/^adm:pv:(main|score|letter)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const scope = (ctx.match as RegExpMatchArray)[1] as Scope;
    await ctx.answerCallbackQuery();
    const cur = (config as any)[SCOPE_FIELDS[scope].provider] as string;
    const kb = new InlineKeyboard();
    if (scope !== "main") kb.text("↩️ Как общий", `adm:pv:${scope}:__inherit`).row();
    for (const p of PROVIDERS) kb.text(`${p.id === cur ? "🟢 " : ""}${p.label}`, `adm:pv:${scope}:${p.id}`).row();
    kb.text("⬅️ Назад", scope === "main" ? "adm:home" : `adm:task:${scope}`);
    await ctx.editMessageText(`Провайдер для: <b>${scope === "main" ? "общий" : TASK_TITLE[scope as "score" | "letter"]}</b>`, {
      parse_mode: "HTML",
      reply_markup: kb,
    }).catch(() => {});
  });

  // ── Провайдер: выбор ──
  bot.callbackQuery(/^adm:pv:(main|score|letter):(.+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const mm = ctx.match as RegExpMatchArray;
    const scope = mm[1] as Scope;
    const id = mm[2];
    const f = SCOPE_FIELDS[scope];

    if (id === "__inherit" && scope !== "main") {
      await store.setSetting(f.provider, "");
      await store.setSetting(f.base, "");
      await store.setSetting(f.key, "");
      await ctx.answerCallbackQuery({ text: "Задача использует общий провайдер" });
      await show(ctx, renderTask(scope as "score" | "letter"), true);
      return;
    }
    const def = providerDef(id);
    if (!def) {
      await ctx.answerCallbackQuery({ text: "Неизвестный провайдер" });
      return;
    }
    await store.setSetting(f.provider, id);
    if (id !== "custom") await store.setSetting(f.base, "");
    modelCache = []; // у нового провайдера свой список
    await ctx.answerCallbackQuery({ text: `Провайдер: ${def.label}` });
    if (id === "custom") {
      ctx.session.awaiting = { kind: "admin_field", key: f.base };
      await ctx.reply("Пришли base URL OpenAI-совместимого API (напр. https://host/v1).");
      return;
    }
    // Сразу ждём ключ — чтобы следующее сообщение с ключом не потерялось.
    ctx.session.awaiting = { kind: "admin_field", key: f.key };
    await ctx.reply(
      `✅ Провайдер: <b>${escapeHtml(def.label)}</b>.\n🔑 Пришли API-ключ${def.keyHint ? ` (формат ${escapeHtml(def.keyHint)})` : ""}.\n🔒 Сообщение с ключом удалю сразу.`,
      { parse_mode: "HTML" },
    );
  });

  // ── Ключ для scope ──
  bot.callbackQuery(/^adm:key:(main|score|letter)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const scope = (ctx.match as RegExpMatchArray)[1] as Scope;
    ctx.session.awaiting = { kind: "admin_field", key: SCOPE_FIELDS[scope].key };
    await ctx.answerCallbackQuery();
    await ctx.reply("🔑 Пришли API-ключ.\n🔒 Сообщение удалю сразу после сохранения.");
  });

  // ── Вернуть задачу на общий провайдер ──
  bot.callbackQuery(/^adm:inherit:(score|letter)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const role = (ctx.match as RegExpMatchArray)[1] as "score" | "letter";
    const f = SCOPE_FIELDS[role];
    await store.setSetting(f.provider, "");
    await store.setSetting(f.base, "");
    await store.setSetting(f.key, "");
    await ctx.answerCallbackQuery({ text: "Теперь как общий" });
    await show(ctx, renderTask(role), true);
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
    await ctx.answerCallbackQuery();
    await show(ctx, renderModels(m[1] === "lm" ? "letter" : "score", Number(m[2])), true);
  });
  bot.callbackQuery(/^adm:lm:pk:(\d+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const model = view[Number((ctx.match as RegExpMatchArray)[1])];
    if (!model) {
      await ctx.answerCallbackQuery({ text: "Список устарел, открой заново" });
      return;
    }
    await store.setSetting("letterModel", model);
    await ctx.answerCallbackQuery({ text: "Модель писем сохранена" });
    await show(ctx, renderTask("letter"), true);
  });
  bot.callbackQuery(/^adm:sm:tg:(\d+):(\d+)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const mm = ctx.match as RegExpMatchArray;
    const model = view[Number(mm[1])];
    if (model) scoreDraft.has(model) ? scoreDraft.delete(model) : scoreDraft.add(model);
    await ctx.answerCallbackQuery();
    await show(ctx, renderModels("score", Number(mm[2])), true);
  });
  bot.callbackQuery("adm:sm:save", async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    if (!scoreDraft.size) {
      await ctx.answerCallbackQuery({ text: "Выбери хотя бы одну модель" });
      return;
    }
    await store.setSetting("scoreModels", [...scoreDraft].join(","));
    await ctx.answerCallbackQuery({ text: `Сохранено: ${scoreDraft.size}` });
    await show(ctx, renderTask("score"), true);
  });
  bot.callbackQuery(/^adm:(lm|sm):find$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    const target = (ctx.match as RegExpMatchArray)[1] === "lm" ? "letter" : "score";
    ctx.session.awaiting = { kind: "admin_model_filter", target };
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли часть названия модели для фильтра (или «-» — показать все).");
  });

  // ── Текстовые поля (прокси/порог) ──
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
    await ctx.reply(`Пришли новое значение для «<b>${escapeHtml(tf.label)}</b>».${tf.hint ? `\n<i>${escapeHtml(tf.hint)}</i>` : ""}`, {
      parse_mode: "HTML",
    });
  });

  // ── Проверка провайдера(ов) ──
  async function testRole(ctx: Ctx, role: "score" | "letter"): Promise<void> {
    if (!keyFor(role)) {
      await ctx.reply(`❌ ${TASK_TITLE[role]}: ключ не задан.`);
      return;
    }
    const model = role === "score" ? config.scoreModels[0] : config.letterModel;
    const prov = providerLabelOf(endpointFor(role).providerId);
    try {
      await chat({ model, role, user: "ping", maxTokens: 5 }, 20000);
      await ctx.reply(`✅ ${TASK_TITLE[role]}: ${escapeHtml(prov)} · <code>${escapeHtml(model)}</code> — ок.`, { parse_mode: "HTML" });
    } catch (e: any) {
      await ctx.reply(`❌ ${TASK_TITLE[role]} (${escapeHtml(prov)}):\n<code>${escapeHtml(String(e?.message ?? e).slice(0, 250))}</code>`, {
        parse_mode: "HTML",
      });
    }
  }
  bot.callbackQuery(/^adm:test:(score|letter|all)$/, async (ctx) => {
    if (await denyIfNotOwner(ctx)) return;
    await ctx.answerCallbackQuery({ text: "Проверяю…" });
    const which = (ctx.match as RegExpMatchArray)[1];
    if (which === "all") {
      await testRole(ctx, "score");
      await testRole(ctx, "letter");
    } else {
      await testRole(ctx, which as "score" | "letter");
    }
  });

  // ── Приём текста: фильтр моделей ИЛИ значение поля ──
  bot.on("message:text", async (ctx, next) => {
    const a = ctx.session.awaiting;
    if (a?.kind === "admin_model_filter") {
      const q = ctx.message.text.trim().toLowerCase();
      ctx.session.awaiting = undefined;
      view = q === "-" || !q ? modelCache : modelCache.filter((m) => m.toLowerCase().includes(q));
      if (!view.length) {
        view = modelCache;
        await ctx.reply("Ничего не найдено — показываю все.");
      }
      await show(ctx, renderModels(a.target, 0), false);
      return;
    }
    if (a?.kind !== "admin_field") return next();
    const key = a.key;
    ctx.session.awaiting = undefined;
    const value = ctx.message.text.trim();
    await store.setSetting(key, value);
    if (isSecret(key)) await ctx.deleteMessage().catch(() => {});

    // После ввода своего base URL — сразу просим ключ этого же scope.
    const baseToRole: Record<string, Role | undefined> = { aiBase: undefined, scoreBase: "score", letterBase: "letter" };
    if (key in baseToRole) {
      const role = baseToRole[key];
      const warn = /console\.|dashboard|\/keys|\/settings/i.test(value)
        ? "\n⚠️ Похоже на адрес кабинета, а не API (обычно хост вида api.…)."
        : "";
      ctx.session.awaiting = { kind: "admin_field", key: SCOPE_FIELDS[role ?? "main"].key };
      await ctx.reply(
        `✅ base URL сохранён. Запросы пойдут на <code>${escapeHtml(chatUrlFor(role))}</code>${warn}\n🔑 Теперь пришли API-ключ.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const label = KEY_LABEL[key] ?? TEXT_FIELDS.find((f) => f.key === key)?.label ?? key;
    const kb = new InlineKeyboard().text("⬅️ К настройкам", "adm:home");
    await ctx.reply(`✅ «${escapeHtml(label)}» обновлено: <code>${escapeHtml(displayValue(key))}</code>`, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });
}
