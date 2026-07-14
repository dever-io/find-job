import { fetchJson, type JobSource } from "./base.js";
import type { Vacancy } from "../types.js";

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zа-яё0-9+#.]+/i)
    .filter((t) => t.length > 2);
}

/**
 * «Работа России» (Trudvsem) — открытые госданные.
 * opendata.trudvsem.ru/api/v1/vacancies — без ключа. Фильтрация ограничена,
 * поэтому подстраховываемся клиентским отбором по ключевым словам и зарплате.
 */
export const trudvsemSource: JobSource = {
  id: "trudvsem",
  label: "Работа России",
  async search(q, { limit }) {
    const p = new URLSearchParams();
    p.set("text", q.keywords);
    p.set("limit", String(Math.min(limit, 100)));
    p.set("offset", "0");

    const data = await fetchJson(`http://opendata.trudvsem.ru/api/v1/vacancies?${p.toString()}`);
    const list: any[] = data?.results?.vacancies ?? [];
    const kw = tokens(q.keywords);

    const mapped = list
      .map((w): Vacancy | null => {
        const v = w?.vacancy;
        if (!v?.id) return null;
        return {
          id: `trudvsem:${v.id}`,
          source: "trudvsem",
          title: v["job-name"] ?? "Вакансия",
          company: v.company?.name,
          area: v.region?.name,
          salaryFrom: typeof v.salary_min === "number" ? v.salary_min : undefined,
          salaryTo: typeof v.salary_max === "number" ? v.salary_max : undefined,
          currency: v.currency ?? "RUR",
          url: v.vac_url,
          publishedAt: v.creation_date,
          workFormat: typeof v.schedule === "string" && v.schedule.trim() ? v.schedule.trim() : undefined,
          snippet: String(v.duty ?? "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 400),
        };
      })
      .filter((v): v is Vacancy => v !== null);

    const filtered = mapped.filter((v) => {
      if (!kw.length) return true;
      const hay = `${v.title} ${v.snippet ?? ""}`.toLowerCase();
      return kw.some((t) => hay.includes(t));
    });

    if (q.salaryFrom) {
      return filtered.filter((v) => !v.salaryFrom || v.salaryFrom >= q.salaryFrom!);
    }
    return filtered;
  },
};
