import type { Vacancy, VerifyResult, SearchQuery } from "./types.js";

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

/** Карточка вакансии в HTML. */
export function vacancyCard(v: Vacancy, verdict?: VerifyResult): string {
  const lines: string[] = [`<b>${escapeHtml(v.title)}</b>`];
  const meta: string[] = [];
  if (v.company) meta.push("🏢 " + escapeHtml(v.company));
  if (v.area) meta.push("📍 " + escapeHtml(v.area));
  if (meta.length) lines.push(meta.join(" · "));
  lines.push("💰 " + escapeHtml(fmtMoney(v.salaryFrom, v.salaryTo, v.currency)));
  if (verdict) {
    lines.push(`${scoreEmoji(verdict.score)} <b>${verdict.score}/100</b> — ${escapeHtml(verdict.reason)}`);
  }
  lines.push(`<i>Источник: ${escapeHtml(SRC_LABEL[v.source] ?? v.source)}</i>`);
  return lines.join("\n");
}

const EXP_LABEL: Record<string, string> = {
  noExperience: "без опыта",
  between1And3: "1–3 года",
  between3And6: "3–6 лет",
  moreThan6: "6+ лет",
};

const SCH_LABEL: Record<string, string> = {
  remote: "удалёнка",
  fullDay: "офис",
  flexible: "гибкий график",
};

/** Человекочитаемое резюме фильтров. */
export function querySummary(q: SearchQuery): string {
  const parts = [
    "✅ <b>Фильтры сохранены</b>",
    `💼 ${escapeHtml(q.keywords)}`,
    `📍 ${escapeHtml(q.areaName)}`,
    q.salaryFrom ? `💰 от ${q.salaryFrom.toLocaleString("ru-RU")} ₽` : "💰 зарплата любая",
  ];
  if (q.experience) parts.push(`🎓 ${EXP_LABEL[q.experience]}`);
  if (q.schedule) parts.push(`🗓 ${SCH_LABEL[q.schedule]}`);
  if (q.extra) parts.push(`✨ ${escapeHtml(q.extra)}`);
  return parts.join("\n");
}
