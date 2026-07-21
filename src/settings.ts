import { config } from "./config.js";

/**
 * Реестр настроек, редактируемых на лету через /admin. Ключ совпадает с полем
 * config — правки мутируют объект config, а он читается в точке вызова, поэтому
 * действуют без перезапуска. Значения персистятся в store (data/, gitignore),
 * чтобы переживать рестарт. Добавить новую настройку = одна строка в ADMIN_FIELDS.
 */
export interface AdminField {
  key: string; // и ключ хранилища, и имя поля config
  label: string;
  kind: "string" | "number" | "list"; // list — CSV → string[]
  secret?: boolean; // маскировать в выводе + удалять сообщение с вводом
  hint?: string; // подсказка при вводе
}

export const ADMIN_FIELDS: AdminField[] = [
  { key: "openRouterKey", label: "OpenRouter API-ключ", kind: "string", secret: true, hint: "sk-or-v1-…" },
  {
    key: "letterModel",
    label: "Модель для писем",
    kind: "string",
    hint: "напр. deepseek/deepseek-chat-v3-0324",
  },
  {
    key: "scoreModels",
    label: "Модели скоринга (через запятую)",
    kind: "list",
    hint: "deepseek/deepseek-chat-v3-0324, meta-llama/llama-3.3-70b-instruct",
  },
  {
    key: "openRouterProxy",
    label: "SOCKS-прокси для OpenRouter",
    kind: "string",
    hint: "socks5h://127.0.0.1:1080 — или «-», чтобы очистить",
  },
  {
    key: "hhScrapeProxy",
    label: "SOCKS-прокси для hh.ru",
    kind: "string",
    hint: "socks5h://127.0.0.1:10800 — или «-», чтобы очистить",
  },
  { key: "scoreThreshold", label: "Порог совпадения (0–100)", kind: "number", hint: "напр. 60" },
];

export function adminField(key: string): AdminField | undefined {
  return ADMIN_FIELDS.find((f) => f.key === key);
}

/** Применяет одно значение к живому config согласно типу поля. «-» очищает строку. */
export function applyOverride(key: string, raw: string): void {
  const f = adminField(key);
  if (!f) return;
  const val = raw.trim();
  const cfg = config as unknown as Record<string, unknown>;
  if (f.kind === "list") {
    cfg[key] = val === "-" ? [] : val.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (f.kind === "number") {
    const n = Number(val);
    if (Number.isFinite(n)) cfg[key] = n;
  } else {
    cfg[key] = val === "-" ? "" : val;
  }
}

/** Маскирует секрет: показываем только хвост. */
function maskSecret(v: string): string {
  if (!v) return "— не задан";
  return v.length <= 6 ? "••••••" : "••••••" + v.slice(-4);
}

/** Текущее значение поля для показа в /admin (секреты замаскированы). */
export function displayValue(key: string): string {
  const f = adminField(key);
  if (!f) return "";
  const cur = (config as unknown as Record<string, unknown>)[key];
  if (f.kind === "list") {
    const arr = Array.isArray(cur) ? (cur as string[]) : [];
    return arr.length ? arr.join(", ") : "— пусто";
  }
  if (f.kind === "number") return String(cur ?? "—");
  const s = typeof cur === "string" ? cur : "";
  if (f.secret) return maskSecret(s);
  return s || "— пусто";
}
