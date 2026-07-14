import type { JobSource, SearchOpts } from "./base.js";
import { hhSource, hhDetail } from "./hh.js";
import { trudvsemSource } from "./trudvsem.js";
import { tgChannelSource } from "./tg.js";
import { store } from "../store.js";
import { config } from "../config.js";
import type { SearchQuery, Vacancy } from "../types.js";

export { suggestArea } from "./hh.js";

/** Базовые источники. Плюс динамические TG-каналы из настроек (store). */
export const SOURCES: JobSource[] = [hhSource, trudvsemSource];

/** Полный список источников: базовые + TG-каналы, добавленные в настройках. */
function allSources(): JobSource[] {
  return [...SOURCES, ...store.channels().map(tgChannelSource)];
}

/** Опрашивает все источники параллельно, объединяет и дедуплицирует результат. */
export async function searchAll(q: SearchQuery, opts: SearchOpts): Promise<Vacancy[]> {
  const sources = allSources();
  const settled = await Promise.allSettled(sources.map((s) => s.search(q, opts)));
  const seen = new Set<string>();
  const merged: Vacancy[] = [];

  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const v of r.value) {
        if (v.url && !seen.has(v.id)) {
          seen.add(v.id);
          merged.push(v);
        }
      }
    } else {
      console.warn(`[sources] ${sources[i].id} failed: ${r.reason?.message ?? r.reason}`);
    }
  });

  // свежее — выше
  merged.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
  return merged;
}

/**
 * Добор полного описания/навыков/опыта для вакансий (мутирует объекты на месте).
 * Пока умеет только hh; прочие источники пропускает. Мягко игнорирует ошибки
 * отдельных запросов, чтобы один упавший detail не рушил весь прогон.
 */
export async function enrichDetails(vacancies: Vacancy[]): Promise<void> {
  const targets = vacancies.filter((v) => v.source === "hh" && v.description === undefined);
  let idx = 0;
  const workers = Math.max(1, Math.min(config.verifyConcurrency, targets.length || 1));
  async function worker() {
    while (idx < targets.length) {
      const v = targets[idx++];
      const nativeId = v.id.slice(v.id.indexOf(":") + 1);
      try {
        const d = await hhDetail(nativeId);
        if (d.description) v.description = d.description;
        if (d.keySkills?.length) v.keySkills = d.keySkills;
        if (d.experienceName) v.experienceName = d.experienceName;
        if (d.workFormat && !v.workFormat) v.workFormat = d.workFormat;
      } catch (e: any) {
        console.warn(`[enrich] ${v.id}: ${e?.message ?? e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
}
