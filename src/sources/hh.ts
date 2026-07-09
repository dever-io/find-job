import { fetchJson, type JobSource } from "./base.js";
import { config } from "../config.js";
import type { Vacancy } from "../types.js";

const HH_HEADERS: Record<string, string> = {
  "User-Agent": config.hhUserAgent,
  // при работе через RU-прокси шлём секрет, иначе прокси ответит 403
  ...(config.hhProxyKey ? { "X-Proxy-Key": config.hhProxyKey } : {}),
};

function stripHl(s: string): string {
  return s.replace(/<\/?highlighttext>/g, "");
}

/**
 * HeadHunter — публичный API api.hh.ru/vacancies, без ключа.
 * Документация фильтров: https://api.hh.ru/openapi/redoc#tag/Poisk-vakansij
 */
export const hhSource: JobSource = {
  id: "hh",
  label: "HeadHunter",
  async search(q, { limit, periodDays }) {
    const p = new URLSearchParams();
    p.set("text", q.keywords);
    p.set("area", q.areaId || "113");
    p.set("per_page", String(Math.min(limit, 100)));
    p.set("page", "0");
    p.set("order_by", "publication_time");
    p.set("period", String(periodDays ?? 7));
    if (q.salaryFrom) p.set("salary", String(q.salaryFrom));
    if (q.experience) p.set("experience", q.experience);
    if (q.schedule && q.schedule !== "any") p.set("schedule", q.schedule);
    if (q.employment && q.employment !== "any") p.set("employment", q.employment);

    const data = await fetchJson(`${config.hhApiBase}/vacancies?${p.toString()}`, { headers: HH_HEADERS });
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    return items.map((it): Vacancy => ({
      id: `hh:${it.id}`,
      source: "hh",
      title: it.name ?? "Вакансия",
      company: it.employer?.name,
      area: it.area?.name,
      salaryFrom: it.salary?.from ?? undefined,
      salaryTo: it.salary?.to ?? undefined,
      currency: it.salary?.currency ?? undefined,
      url: it.alternate_url,
      publishedAt: it.published_at,
      snippet: stripHl([it.snippet?.responsibility, it.snippet?.requirement].filter(Boolean).join(" ")),
    }));
  },
};

/** Резолв города в id региона hh.ru (для «Другой город»). */
export async function suggestArea(text: string): Promise<{ id: string; name: string } | null> {
  try {
    const data = await fetchJson(`${config.hhApiBase}/suggests/areas?text=${encodeURIComponent(text)}`, {
      headers: HH_HEADERS,
    });
    const first = data?.items?.[0];
    if (first?.id) return { id: String(first.id), name: first.text ?? text };
  } catch {
    /* ignore */
  }
  return null;
}
