import { config } from "../config.js";
import { searchAll } from "../sources/index.js";
import { verifyMany } from "../ai/verify.js";
import type { Plan, SearchQuery, Vacancy, VerifyResult } from "../types.js";

export interface Match {
  vacancy: Vacancy;
  verdict: VerifyResult;
}

export interface FindOpts {
  excludeIds?: Set<string>;
  limit?: number;
  periodDays?: number;
}

/**
 * Полный цикл: собрать кандидатов из источников → отсеять уже показанные →
 * проверить ИИ → оставить релевантные выше порога → отсортировать по score.
 */
export async function findMatches(q: SearchQuery, plan: Plan, opts: FindOpts = {}): Promise<Match[]> {
  const raw = await searchAll(q, { limit: config.candidatesToVerify * 2, periodDays: opts.periodDays });
  const fresh = raw.filter((v) => !opts.excludeIds?.has(v.id)).slice(0, config.candidatesToVerify);
  if (!fresh.length) return [];

  const verdicts = await verifyMany(q, fresh, plan);
  return fresh
    .map((v, i) => ({ vacancy: v, verdict: verdicts[i] }))
    .filter((m) => m.verdict.relevant && m.verdict.score >= config.scoreThreshold)
    .sort((a, b) => b.verdict.score - a.verdict.score)
    .slice(0, opts.limit ?? config.maxMatchesPerDay);
}
