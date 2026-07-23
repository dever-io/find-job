import { store } from "../store.js";
import type { Role } from "../providers.js";

/**
 * Оценка стоимости вызова модели: средние токены из СТАТИСТИКИ реальных прогонов
 * (store.aiStat, пишется в chat()) × тариф модели. Тарифы OpenRouter приходят из
 * его /models (setDynamicPricing), для прямых провайдеров — таблица ниже.
 * Всё ориентировочно (≈): тарифы меняются, поэтому без гарантий.
 */

/** Тариф: $ за 1 МЛН токенов (вход/выход). */
export interface Price {
  in: number;
  out: number;
}

/** Статичные тарифы прямых провайдеров, $/1M токенов (примерно, на середину 2026). */
const STATIC: [RegExp, Price][] = [
  // Anthropic
  [/claude-opus-4-[5-9]/i, { in: 5, out: 25 }],
  [/claude-opus/i, { in: 15, out: 75 }],
  [/claude-sonnet/i, { in: 3, out: 15 }],
  [/claude-haiku-4/i, { in: 1, out: 5 }],
  [/claude-haiku/i, { in: 0.8, out: 4 }],
  // OpenAI
  [/gpt-4o-mini/i, { in: 0.15, out: 0.6 }],
  [/gpt-4o/i, { in: 2.5, out: 10 }],
  [/gpt-4\.1-nano/i, { in: 0.1, out: 0.4 }],
  [/gpt-4\.1-mini/i, { in: 0.4, out: 1.6 }],
  [/gpt-4\.1/i, { in: 2, out: 8 }],
  [/o4-mini|o3-mini/i, { in: 1.1, out: 4.4 }],
  [/^o3(\b|-)/i, { in: 2, out: 8 }],
  // DeepSeek
  [/deepseek-chat|deepseek-v3/i, { in: 0.27, out: 1.1 }],
  [/deepseek-reasoner|deepseek-r1/i, { in: 0.55, out: 2.19 }],
  // Прочее популярное
  [/llama-3\.3-70b/i, { in: 0.6, out: 0.8 }],
  [/mistral-large/i, { in: 2, out: 6 }],
];

/** Живые тарифы из /models провайдера (OpenRouter отдаёт pricing) — точнее таблицы. */
const dynamic = new Map<string, Price>();

/** Кладёт живой тариф (вход: $/токен строками, как в OpenRouter API). */
export function setDynamicPrice(modelId: string, promptPerTok: string | number, completionPerTok: string | number): void {
  const pin = Number(promptPerTok);
  const pout = Number(completionPerTok);
  if (Number.isFinite(pin) && Number.isFinite(pout) && (pin > 0 || pout > 0)) {
    dynamic.set(modelId, { in: pin * 1e6, out: pout * 1e6 });
  }
}

export function priceFor(modelId: string): Price | null {
  const d = dynamic.get(modelId);
  if (d) return d;
  for (const [re, p] of STATIC) if (re.test(modelId)) return p;
  return null;
}

/** Средние токены на один вызов, если своей статистики ещё нет. */
const DEFAULT_TOKENS: Record<string, { p: number; c: number }> = {
  score: { p: 2600, c: 900 },
  letter: { p: 2200, c: 750 },
};

/** Средние токены задачи: реальная статистика прогонов или дефолт. */
export function avgTokens(role: Role): { p: number; c: number; measured: boolean } {
  const s = store.aiStat(role);
  if (s && s.n > 0) return { p: s.p, c: s.c, measured: true };
  const d = DEFAULT_TOKENS[role] ?? { p: 2000, c: 600 };
  return { ...d, measured: false };
}

/** ≈ стоимость одного вызова модели для задачи, $. null — тариф неизвестен. */
export function estimateUsd(role: Role, modelId: string): number | null {
  const price = priceFor(modelId);
  if (!price) return null;
  const t = avgTokens(role);
  return (t.p * price.in + t.c * price.out) / 1e6;
}

export function fmtUsd(u: number): string {
  if (u >= 0.1) return "$" + u.toFixed(2);
  if (u >= 0.01) return "$" + u.toFixed(3);
  return "$" + u.toFixed(4);
}
