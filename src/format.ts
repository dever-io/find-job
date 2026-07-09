import type { Vacancy, VerifyResult, TrackId } from "./types.js";

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
  track?: TrackId;
  hot?: boolean;
  statusLine?: string; // напр. итоговый статус после нажатия кнопки
}

/** Карточка вакансии в HTML. */
export function vacancyCard(v: Vacancy, verdict?: VerifyResult, opts: CardOpts = {}): string {
  const head: string[] = [];
  if (opts.track) head.push(`[Track ${opts.track}]`);
  if (opts.hot) head.push("🔥 Горячая");
  const lines: string[] = [];
  if (head.length) lines.push(`<i>${head.join("  ")}</i>`);
  lines.push(`<b>${escapeHtml(v.title)}</b>`);

  const meta: string[] = [];
  if (v.company) meta.push("🏢 " + escapeHtml(v.company));
  if (v.area) meta.push("📍 " + escapeHtml(v.area));
  if (meta.length) lines.push(meta.join(" · "));
  lines.push("💰 " + escapeHtml(fmtMoney(v.salaryFrom, v.salaryTo, v.currency)));
  if (verdict) {
    lines.push(`${scoreEmoji(verdict.score)} <b>${verdict.score}/100</b> — ${escapeHtml(verdict.reason)}`);
  }
  lines.push(`<i>Источник: ${escapeHtml(SRC_LABEL[v.source] ?? v.source)}</i>`);
  if (opts.statusLine) lines.push(`\n${opts.statusLine}`);
  return lines.join("\n");
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
