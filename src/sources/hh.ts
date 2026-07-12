import { fetchJson, fetchText, type JobSource, type SearchOpts } from "./base.js";
import { config } from "../config.js";
import type { SearchQuery, Vacancy } from "../types.js";

const HH_HEADERS: Record<string, string> = {
  "User-Agent": config.hhUserAgent,
  // при работе через RU-прокси шлём секрет, иначе прокси ответит 403
  ...(config.hhProxyKey ? { "X-Proxy-Key": config.hhProxyKey } : {}),
  // авторизованный доступ HH (обходит блок анонимных дата-центровых IP)
  ...(config.hhAccessToken ? { Authorization: `Bearer ${config.hhAccessToken}` } : {}),
};

/** Заголовки для скрапинга сайта (браузерный UA + опц. секрет прокси). */
function webHeaders(): Record<string, string> {
  return {
    "User-Agent": config.hhWebUserAgent,
    ...(config.hhProxyKey ? { "X-Proxy-Key": config.hhProxyKey } : {}),
  };
}

/**
 * Какой путь использовать: "scrape" — парсинг сайта (без токена);
 * "api" — официальный api.hh.ru; "auto" — есть токен → api, нет → scrape.
 */
function useScrape(): boolean {
  if (config.hhMode === "scrape") return true;
  if (config.hhMode === "api") return false;
  return !config.hhAccessToken;
}

function stripHl(s: string): string {
  return s.replace(/<\/?highlighttext>/g, "");
}

/** HTML-описание вакансии → плоский текст (теги вон, сущности назад, пробелы схлопнуты). */
function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|ul|ol|div|br|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─────────────────────────── Официальный API (api.hh.ru) ───────────────────────────

/** Поиск через api.hh.ru/vacancies. Требует HH_ACCESS_TOKEN, иначе HH отдаёт 403/капчу. */
async function hhApiSearch(q: SearchQuery, { limit, periodDays }: SearchOpts): Promise<Vacancy[]> {
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
}

/** Добор деталей через api.hh.ru/vacancies/{id}. */
async function hhApiDetail(
  nativeId: string,
): Promise<{ description?: string; keySkills?: string[]; experienceName?: string }> {
  const data = await fetchJson(`${config.hhApiBase}/vacancies/${nativeId}`, { headers: HH_HEADERS });
  return {
    description: typeof data?.description === "string" ? htmlToText(data.description) : undefined,
    keySkills: Array.isArray(data?.key_skills)
      ? data.key_skills.map((k: any) => k?.name).filter((s: any): s is string => Boolean(s))
      : undefined,
    experienceName: data?.experience?.name ?? undefined,
  };
}

// ─────────────────────────── Скрапинг сайта (hh.ru SSR-стейт) ───────────────────────────
//
// Сайт hh.ru отдаёт выдачу серверным рендером (SSR): в HTML вшит JSON-стейт
// <template id="HH-Lux-InitialState">…</template> со структурой, аналогичной API.
// Это работает без токена и без логина (см. диагностику: api.hh.ru требует OAuth,
// а страница сайта — нет). Минус: неофициально и может измениться при редизайне.

/** Декодирует HTML-сущности обратно в символы (стейт вшит как HTML-escaped JSON). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // &amp; — последним, чтобы не раскодировать дважды
}

/** Вытаскивает и парсит SSR-стейт HH-Lux-InitialState из HTML страницы. */
function extractInitialState(html: string): any {
  const m = html.match(/id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
  if (!m) {
    throw new Error("HH scrape: не найден HH-Lux-InitialState (вероятно, анти-бот-страница или редизайн)");
  }
  return JSON.parse(decodeEntities(m[1]));
}

/** Опыт на сайте приходит строкой-enum ("between1And3"); переводим в текст. */
const EXPERIENCE_LABELS: Record<string, string> = {
  noExperience: "Нет опыта",
  between1And3: "1–3 года",
  between3And6: "3–6 лет",
  moreThan6: "более 6 лет",
};
function expLabel(x: any): string | undefined {
  if (typeof x === "string") return EXPERIENCE_LABELS[x] ?? x;
  if (x && typeof x.name === "string") return x.name;
  return undefined;
}

/** Нормализует объект вакансии из SSR-стейта поиска в наш тип Vacancy. */
function mapWebVacancy(v: any): Vacancy {
  const c = v.compensation ?? {};
  const pt = v.publicationTime;
  const publishedAt = typeof pt === "string" ? pt : pt?.$ ?? pt?.iso ?? undefined;
  const vacancyId = String(v.vacancyId);
  return {
    id: `hh:${vacancyId}`,
    source: "hh",
    title: v.name ?? "Вакансия",
    company: v.company?.visibleName ?? v.company?.name,
    area: v.area?.name,
    salaryFrom: typeof c.from === "number" ? c.from : undefined,
    salaryTo: typeof c.to === "number" ? c.to : undefined,
    currency: c.currencyCode ?? undefined,
    url: v.links?.desktop ?? `${config.hhWebBase}/vacancy/${vacancyId}`,
    publishedAt,
    experienceName: expLabel(v.workExperience),
  };
}

/** Поиск через скрапинг hh.ru/search/vacancy. Фильтры — те же query-параметры, что у API. */
async function hhWebSearch(q: SearchQuery, { limit, periodDays }: SearchOpts): Promise<Vacancy[]> {
  const p = new URLSearchParams();
  p.set("text", q.keywords);
  p.set("area", q.areaId || "113");
  p.set("page", "0");
  p.set("order_by", "publication_time");
  p.set("search_period", String(periodDays ?? 7)); // на сайте период называется search_period (дни)
  if (q.salaryFrom) p.set("salary", String(q.salaryFrom));
  if (q.experience) p.set("experience", q.experience);
  if (q.schedule && q.schedule !== "any") p.set("schedule", q.schedule);
  if (q.employment && q.employment !== "any") p.set("employment", q.employment);

  const html = await fetchText(`${config.hhWebBase}/search/vacancy?${p.toString()}`, {
    headers: webHeaders(),
    timeoutMs: 20000,
  });
  const st = extractInitialState(html);
  const items: any[] = st?.vacancySearchResult?.vacancies ?? [];
  return items.slice(0, limit).map(mapWebVacancy);
}

/** Добор деталей через скрапинг страницы hh.ru/vacancy/{id}. */
async function hhWebDetail(
  nativeId: string,
): Promise<{ description?: string; keySkills?: string[]; experienceName?: string }> {
  const html = await fetchText(`${config.hhWebBase}/vacancy/${nativeId}`, {
    headers: webHeaders(),
    timeoutMs: 20000,
  });
  const st = extractInitialState(html);
  const vv = st?.vacancyView ?? {};
  const rawSkills = vv.keySkills?.keySkill ?? vv.keySkills ?? [];
  const keySkills = Array.isArray(rawSkills)
    ? rawSkills.map((k: any) => (typeof k === "string" ? k : k?.name)).filter((s: any): s is string => Boolean(s))
    : undefined;
  return {
    description: typeof vv.description === "string" ? htmlToText(vv.description) : undefined,
    keySkills: keySkills && keySkills.length ? keySkills : undefined,
    experienceName: expLabel(vv.workExperience ?? vv.experience),
  };
}

// ─────────────────────────── Публичный интерфейс (диспетчер) ───────────────────────────

/**
 * Добор деталей вакансии hh: полное описание, ключевые навыки, требуемый опыт.
 * Принимает нативный id ("12345"), а не "hh:12345". Путь выбирается по HH_MODE.
 */
export async function hhDetail(
  nativeId: string,
): Promise<{ description?: string; keySkills?: string[]; experienceName?: string }> {
  return useScrape() ? hhWebDetail(nativeId) : hhApiDetail(nativeId);
}

/**
 * HeadHunter. Два пути: официальный api.hh.ru (нужен HH_ACCESS_TOKEN) и скрапинг
 * сайта hh.ru (без токена). Выбор — через config.hhMode (env HH_MODE).
 */
export const hhSource: JobSource = {
  id: "hh",
  label: "HeadHunter",
  async search(q, opts) {
    return useScrape() ? hhWebSearch(q, opts) : hhApiSearch(q, opts);
  },
};

/** Резолв города в id региона hh.ru (для «Другой город»). Только через API. */
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
