import { config } from "../config.js";
import { searchAll, enrichDetails } from "../sources/index.js";
import { analyzeMany } from "../ai/analyze.js";
import type { TrackConfig, Vacancy, VerifyResult } from "../types.js";

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
 * Полный цикл трека: собрать кандидатов из источников → отсеять уже показанные →
 * добрать полное описание/навыки → оценить ИИ по весам трека → оставить релевантные
 * выше порога → отсортировать по взвешенному score.
 */
export async function findMatches(track: TrackConfig, opts: FindOpts = {}): Promise<Match[]> {
  const raw = await searchAll(track.query, { limit: config.candidatesToVerify * 2, periodDays: opts.periodDays });
  const fresh = raw.filter((v) => !opts.excludeIds?.has(v.id)).slice(0, config.candidatesToVerify);
  if (!fresh.length) return [];

  // Добор деталей до скоринга — ИИ оценивает по полному описанию, а не по сниппету.
  await enrichDetails(fresh);

  const verdicts = await analyzeMany(track, fresh);
  return fresh
    .map((v, i) => ({ vacancy: v, verdict: verdicts[i] }))
    .filter((m) => m.verdict.relevant && m.verdict.score >= config.scoreThreshold)
    .sort((a, b) => b.verdict.score - a.verdict.score)
    .slice(0, opts.limit ?? config.maxMatchesPerRun);
}
