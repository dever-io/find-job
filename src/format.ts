import type { Vacancy, VerifyResult } from "./types.js";

/** Экранирование для parse_mode: "HTML" (& первым!). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CUR: Record<string, string> = {
  RUR: "₽",
  RUB: "₽",
  USD: "$",
  EUR: "€",
  KZT: "₸",
  BYR: "Br",
  BYN: "Br",
  UAH: "₴",
};

export function fmtMoney(from?: number, to?: number, cur?: string): string {
  if (!from && !to) return "з/п не указана";
  const sym = CUR[cur ?? "RUR"] ?? cur ?? "";
  const n = (x: number) => x.toLocaleString("ru-RU");
  if (from && to) return `${n(from)}–${n(to)} ${sym}`;
  if (from) return `от ${n(from)} ${sym}`;
  return `до ${n(to!)} ${sym}`;
}

export function scoreEmoji(score: number): string {
  if (score >= 85) return "🟢";
  if (score >= 70) return "🟡";
  return "🟠";
}

const SRC_LABEL: Record<string, string> = {
  hh: "hh.ru",
  trudvsem: "Работа России",
  tg: "Telegram-канал",
};

const STATUS_LABEL: Record<string, string> = {
  Saved: "⭐ Сохранено",
  Ignored: "❌ Не интересно",
  Responded: "✅ Отклик отправлен",
  Interview: "🗣 Собеседование",
  Offer: "🎉 Оффер",
  Rejected: "🚫 Отказ",
};

export interface CardOpts {
  tag?: string; // хэштег трека, напр. "#видеопродакшн" (кликабельная подборка)
  hot?: boolean;
  statusLine?: string; // напр. итоговый статус после нажатия кнопки
}

/** Краткое описание вакансии: 2–3 предложения из полного текста/сниппета. */
function shortDesc(v: Vacancy, maxLen = 300): string {
  const raw = (v.description || v.snippet || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  // берём до 3 предложений, но не длиннее maxLen (обрезаем по границе слова)
  const sentences = (raw.match(/[^.!?]+[.!?]+/g)?.slice(0, 3).map((s) => s.trim()).join(" ") || raw).trim();
  if (sentences.length <= maxLen) return sentences;
  const cut = sentences.slice(0, maxLen);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : maxLen).trim() + "…";
}

/** Карточка вакансии в HTML (spec §9). */
export function vacancyCard(v: Vacancy, verdict?: VerifyResult, opts: CardOpts = {}): string {
  const lines: string[] = [];

  // Хэштег — плоским текстом (Telegram сам делает его кликабельным).
  const head: string[] = [];
  if (opts.tag) head.push(escapeHtml(opts.tag));
  if (opts.hot) head.push("🔥 Горячая");
  if (head.length) lines.push(head.join("  ·  "));
  lines.push(`<b>${escapeHtml(v.title)}</b>`);
  lines.push("");

  const meta: string[] = [];
  if (v.company) meta.push("🏢 " + escapeHtml(v.company));
  if (v.area) meta.push("📍 " + escapeHtml(v.area));
  if (meta.length) lines.push(meta.join("  ·  "));
  lines.push("💰 " + escapeHtml(fmtMoney(v.salaryFrom, v.salaryTo, v.currency)));
  if (v.workFormat) lines.push("🗓 График: " + escapeHtml(v.workFormat));
  if (v.experienceName) lines.push("🧭 Опыт: " + escapeHtml(v.experienceName));
  if (verdict) {
    lines.push(`${scoreEmoji(verdict.score)} Совпадение: <b>${verdict.score}%</b>`);
  }

  const pros = (verdict?.matchReasons ?? []).slice(0, 4);
  if (pros.length) {
    lines.push("");
    lines.push("<b>Почему подходит:</b>");
    for (const r of pros) lines.push("✅ " + escapeHtml(r));
  }
  const cons = (verdict?.mismatchReasons ?? []).slice(0, 3);
  if (cons.length) {
    lines.push("");
    lines.push("<b>Что смущает:</b>");
    for (const r of cons) lines.push("⚠️ " + escapeHtml(r));
  }

  // Краткое описание вакансии (2–3 предложения) — показываем всегда, если есть.
  const desc = shortDesc(v);
  if (desc) {
    lines.push("");
    lines.push(`<i>${escapeHtml(desc)}</i>`);
  }

  const duties = (verdict?.responsibilities ?? []).slice(0, 6);
  if (duties.length) {
    lines.push("");
    lines.push("<b>Обязанности:</b>");
    for (const d of duties) lines.push("• " + escapeHtml(d));
  }

  lines.push("");
  lines.push(`<i>Источник: ${escapeHtml(SRC_LABEL[v.source] ?? v.source)}</i>`);
  if (opts.statusLine) lines.push(opts.statusLine);
  return lines.join("\n");
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Черновик сопроводительного письма (единый чат, помечен #отклик + хэштег трека). */
export function letterCard(v: Vacancy, letter: string, tag?: string, footer?: string): string {
  const lines: string[] = [];
  lines.push(["#отклик", tag ? escapeHtml(tag) : ""].filter(Boolean).join("  ·  "));
  lines.push("<i>✍️ Сопроводительное письмо</i>");
  lines.push(`<b>${escapeHtml(v.title)}${v.company ? " · " + escapeHtml(v.company) : ""}</b>`);
  lines.push("");
  lines.push(escapeHtml(letter));
  if (footer) {
    lines.push("");
    lines.push(footer);
  }
  return lines.join("\n");
}
