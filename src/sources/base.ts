import type { SearchQuery, Vacancy } from "../types.js";

export interface SearchOpts {
  limit: number;
  periodDays?: number;
}

/** Общий интерфейс источника вакансий. Добавить новый (SuperJob и т.п.) —
 *  реализовать этот интерфейс и включить в SOURCES в sources/index.ts. */
export interface JobSource {
  id: string;
  label: string;
  search(query: SearchQuery, opts: SearchOpts): Promise<Vacancy[]>;
}

export async function fetchJson(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "StarJobsBot/0.1 (+https://t.me)",
        Accept: "application/json",
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Как fetchJson, но возвращает сырой текст (HTML) — для скрапинга страниц. */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ru,en;q=0.9",
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
