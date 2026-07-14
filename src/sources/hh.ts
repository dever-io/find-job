import https from "node:https";
import { fetchJson, type JobSource, type SearchOpts } from "./base.js";
import { config } from "../config.js";
import type { SearchQuery, Vacancy } from "../types.js";

const HH_HEADERS: Record<string, string> = {
  "User-Agent": config.hhUserAgent,
  // при работе через RU-прокси шлём секрет, иначе прокси ответит 403
  ...(config.hhProxyKey ? { "X-Proxy-Key": config.hhProxyKey } : {}),
  // авторизованный доступ HH (обходит блок анонимных дата-центровых IP)
  ...(config.hhAccessToken ? { Authorization: `Bearer ${config.hhAccessToken}` } : {}),
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Устойчивый фетчер для скрапинга: cookie-jar + ретраи + пейсинг ──
// DDoS-Guard перед hh.ru «флаппит»: тот же URL то 200, то 403. Ответы (в т.ч. 403)
// ставят куки __ddg*; переиспользование их + ретрай почти всегда пробивает.

/** Cookie-jar для hh.ru (имя → значение). Наполняется из Set-Cookie. */
const hhCookies = new Map<string, string>();
function cookieHeader(): string {
  return [...hhCookies].map(([k, v]) => `${k}=${v}`).join("; ");
}
function storeSetCookies(list: string[]): void {
  for (const c of list) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) hhCookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

interface HttpResult {
  status: number;
  body: string;
  setCookies: string[];
}

/**
 * GET с опциональным SOCKS-прокси ТОЛЬКО для hh.ru (config.hhScrapeProxy). Без прокси —
 * обычный fetch. С прокси — node:https + socks-proxy-agent (нативный fetch Node не
 * принимает SOCKS-диспетчер без конфликта версий undici).
 */
async function httpGet(url: string, headers: Record<string, string>): Promise<HttpResult> {
  if (config.hhScrapeProxy) {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    const agent = new SocksProxyAgent(config.hhScrapeProxy);
    return new Promise<HttpResult>((resolve, reject) => {
      const req = https.get(url, { headers, agent }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: d,
            setCookies: (res.headers["set-cookie"] as string[] | undefined) ?? [],
          }),
        );
      });
      req.setTimeout(20000, () => req.destroy(new Error(`таймаут ${url}`)));
      req.on("error", reject);
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
    const body = await res.text();
    return { status: res.status, body, setCookies: (res.headers as any).getSetCookie?.() ?? [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Браузерные заголовки + накопленные куки — чтобы выглядеть как реальный клиент. */
function browserHeaders(): Record<string, string> {
  return {
    "User-Agent": config.hhWebUserAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    ...(config.hhProxyKey ? { "X-Proxy-Key": config.hhProxyKey } : {}),
    ...(hhCookies.size ? { Cookie: cookieHeader() } : {}),
  };
}

// Сериализуем запросы к hh.ru с паузой — убираем «залп» (enrichDetails × N воркеров).
let hhChain: Promise<unknown> = Promise.resolve();
function paced<T>(task: () => Promise<T>): Promise<T> {
  const run = hhChain.then(task, task);
  hhChain = run.then(
    () => sleep(config.hhScrapeGapMs),
    () => sleep(config.hhScrapeGapMs),
  );
  return run;
}

let hhWarmed = false;
/** Прогрев: один GET главной, чтобы засеять cookie-jar (__ddg* и пр.) до поиска. */
async function warmup(): Promise<void> {
  if (hhWarmed) return;
  hhWarmed = true;
  try {
    const res = await httpGet(`${config.hhWebBase}/`, browserHeaders());
    storeSetCookies(res.setCookies);
  } catch {
    hhWarmed = false; // не вышло — попробуем в следующий раз
  }
}

/** Скачивает HTML с hh.ru: прогрев, пейсинг, ретраи на 403/429 с backoff. */
async function scrapeHtml(url: string): Promise<string> {
  await warmup();
  return paced(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await httpGet(url, browserHeaders());
        storeSetCookies(res.setCookies); // куки берём даже с 403 — помогают пройти ретрай
        if (res.status === 403 || res.status === 429) {
          lastErr = new Error(`HTTP ${res.status} ${url}`);
          await sleep(700 * (attempt + 1) + Math.floor(Math.random() * 500));
          continue;
        }
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} ${url}`);
        return res.body;
      } catch (e) {
        lastErr = e;
        await sleep(500 * (attempt + 1));
      }
    }
    throw lastErr ?? new Error(`scrapeHtml: не удалось получить ${url}`);
  });
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

/** Старый enum графика hh (schedule.id) → русская метка (fallback для work_format). */
const SCHEDULE_LABELS: Record<string, string> = {
  fullDay: "Полный день",
  shift: "Сменный график",
  flexible: "Гибкий график",
  remote: "Удалённо",
  flyInFlyOut: "Вахтовый метод",
};

/** Достаёт .name из массива объектов/строк ([{id,name}] | ["5/2"]). */
function pickNames(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => (typeof x === "string" ? x : (x as any)?.name)).filter((s): s is string => Boolean(s));
}

/**
 * Человекочитаемый график работы: формат (На месте / Удалённо / Гибрид / Разъездной)
 * из нового work_format, плюс дни (5/2, 2/2) из work_schedule_by_days. Если нового
 * поля нет — падаем на старый schedule («Полный день» и т.п.).
 */
function workFormatLabel(src: { workFormat?: unknown; schedule?: unknown; byDays?: unknown }): string | undefined {
  const parts: string[] = [];
  const fmt = pickNames(src.workFormat);
  if (fmt.length) {
    parts.push(fmt.join(", "));
  } else if (src.schedule) {
    const s = src.schedule as any;
    const name = typeof s === "string" ? SCHEDULE_LABELS[s] ?? s : s?.name;
    if (name) parts.push(name);
  }
  const days = pickNames(src.byDays);
  if (days.length) parts.push(days.join(", "));
  const label = parts.filter(Boolean).join(" · ");
  return label || undefined;
}

/**
 * Ключевые слова → HH-синтаксис поиска. LLM отдаёт список через запятую, но HH
 * трактует запятые как AND (нужны ВСЕ слова) → 0 результатов. Превращаем в OR,
 * многословные фразы берём в кавычки. Если запятых нет — отдаём как есть
 * (сохраняя уже готовые OR/AND-запросы).
 */
function toHhText(keywords: string): string {
  const parts = keywords.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return keywords.trim();
  return parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" OR ");
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
  p.set("text", toHhText(q.keywords));
  p.set("area", q.areaId || "113");
  p.set("per_page", String(Math.min(limit, 100)));
  p.set("page", "0");
  p.set("order_by", "relevance"); // релевантность > свежести: качество матчей
  p.set("period", String(periodDays ?? 7));
  if (q.salaryFrom) p.set("salary", String(q.salaryFrom));
  // Опыт НЕ фильтруем жёстко: сеньор подходит и на роли с меньшим требованием,
  // а соответствие опыта оценивает ИИ (один из факторов скоринга). Иначе теряем
  // релевантные вакансии (напр. продюсерских ролей с явным «>6 лет» почти нет).
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
    workFormat: workFormatLabel({ workFormat: it.work_format, schedule: it.schedule, byDays: it.work_schedule_by_days }),
  }));
}

/** Добор деталей через api.hh.ru/vacancies/{id}. */
async function hhApiDetail(
  nativeId: string,
): Promise<{ description?: string; keySkills?: string[]; experienceName?: string; workFormat?: string }> {
  const data = await fetchJson(`${config.hhApiBase}/vacancies/${nativeId}`, { headers: HH_HEADERS });
  return {
    description: typeof data?.description === "string" ? htmlToText(data.description) : undefined,
    keySkills: Array.isArray(data?.key_skills)
      ? data.key_skills.map((k: any) => k?.name).filter((s: any): s is string => Boolean(s))
      : undefined,
    experienceName: data?.experience?.name ?? undefined,
    workFormat: workFormatLabel({ workFormat: data?.work_format, schedule: data?.schedule, byDays: data?.work_schedule_by_days }),
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
    workFormat: workFormatLabel({
      workFormat: v.workFormat,
      schedule: v.workSchedule ?? v.schedule,
      byDays: v.workScheduleByDays,
    }),
  };
}

/** Поиск через скрапинг hh.ru/search/vacancy. Фильтры — те же query-параметры, что у API. */
async function hhWebSearch(q: SearchQuery, { limit, periodDays }: SearchOpts): Promise<Vacancy[]> {
  const p = new URLSearchParams();
  p.set("text", toHhText(q.keywords));
  p.set("area", q.areaId || "113");
  p.set("page", "0");
  p.set("order_by", "relevance"); // релевантность > свежести: качество матчей
  p.set("search_period", String(periodDays ?? 7)); // на сайте период называется search_period (дни)
  if (q.salaryFrom) p.set("salary", String(q.salaryFrom));
  // Опыт НЕ фильтруем жёстко: сеньор подходит и на роли с меньшим требованием,
  // а соответствие опыта оценивает ИИ (один из факторов скоринга). Иначе теряем
  // релевантные вакансии (напр. продюсерских ролей с явным «>6 лет» почти нет).
  if (q.schedule && q.schedule !== "any") p.set("schedule", q.schedule);
  if (q.employment && q.employment !== "any") p.set("employment", q.employment);

  const html = await scrapeHtml(`${config.hhWebBase}/search/vacancy?${p.toString()}`);
  const st = extractInitialState(html);
  const items: any[] = st?.vacancySearchResult?.vacancies ?? [];
  return items.slice(0, limit).map(mapWebVacancy);
}

/** Добор деталей через скрапинг страницы hh.ru/vacancy/{id}. */
async function hhWebDetail(
  nativeId: string,
): Promise<{ description?: string; keySkills?: string[]; experienceName?: string; workFormat?: string }> {
  const html = await scrapeHtml(`${config.hhWebBase}/vacancy/${nativeId}`);
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
    workFormat: workFormatLabel({
      workFormat: vv.workFormat,
      schedule: vv.workSchedule ?? vv.schedule,
      byDays: vv.workScheduleByDays,
    }),
  };
}

// ─────────────────────────── Публичный интерфейс (диспетчер) ───────────────────────────

/**
 * Добор деталей вакансии hh: полное описание, ключевые навыки, требуемый опыт.
 * Принимает нативный id ("12345"), а не "hh:12345". Путь выбирается по HH_MODE.
 */
export async function hhDetail(
  nativeId: string,
): Promise<{ description?: string; keySkills?: string[]; experienceName?: string; workFormat?: string }> {
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
