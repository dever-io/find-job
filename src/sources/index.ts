import type { JobSource, SearchOpts } from "./base.js";
import { hhSource } from "./hh.js";
import { trudvsemSource } from "./trudvsem.js";
import type { SearchQuery, Vacancy } from "../types.js";

export { suggestArea } from "./hh.js";

/** Подключённые источники. Новый источник — просто добавить сюда. */
export const SOURCES: JobSource[] = [hhSource, trudvsemSource];

/** Опрашивает все источники параллельно, объединяет и дедуплицирует результат. */
export async function searchAll(q: SearchQuery, opts: SearchOpts): Promise<Vacancy[]> {
  const settled = await Promise.allSettled(SOURCES.map((s) => s.search(q, opts)));
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
      console.warn(`[sources] ${SOURCES[i].id} failed: ${r.reason?.message ?? r.reason}`);
    }
  });

  // свежее — выше
  merged.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
  return merged;
}
