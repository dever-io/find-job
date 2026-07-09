import { config } from "./config.js";

/** Дата вида YYYY-MM-DD в заданной таймзоне (по умолчанию — крон-таймзона). */
export function todayStr(tz: string = config.cronTz): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
