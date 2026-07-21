import { config } from "./config.js";

/**
 * Настройки, редактируемые на лету через /admin. Ключ совпадает с полем config —
 * правки мутируют config (читается в точке вызова → без перезапуска) и персистятся
 * в store (data/, gitignore). Провайдер и модели правятся своими пикерами в admin.ts,
 * остальное — свободным вводом (TEXT_FIELDS).
 */
type Kind = "string" | "number" | "list";

interface FieldMeta {
  kind: Kind;
  secret?: boolean;
}

/** Все переопределяемые/персистимые ключи config и их тип. */
const FIELDS: Record<string, FieldMeta> = {
  aiProvider: { kind: "string" },
  aiBase: { kind: "string" },
  aiKey: { kind: "string", secret: true },
  aiProxy: { kind: "string" },
  hhScrapeProxy: { kind: "string" },
  scoreThreshold: { kind: "number" },
  letterModel: { kind: "string" },
  scoreModels: { kind: "list" },
};

/** Поля со свободным текстовым вводом — показываются кнопками на экране /admin. */
export interface TextField {
  key: string;
  label: string;
  hint?: string;
}
export const TEXT_FIELDS: TextField[] = [
  { key: "aiKey", label: "API-ключ", hint: "ключ выбранного провайдера" },
  { key: "aiProxy", label: "SOCKS-прокси для ИИ", hint: "socks5h://127.0.0.1:1080 — или «-», чтобы очистить" },
  { key: "hhScrapeProxy", label: "SOCKS-прокси для hh.ru", hint: "socks5h://127.0.0.1:10800 — или «-», чтобы очистить" },
  { key: "scoreThreshold", label: "Порог совпадения (0–100)", hint: "напр. 60" },
];

export function isSecret(key: string): boolean {
  return Boolean(FIELDS[key]?.secret);
}

/** Применяет одно значение к живому config согласно типу поля. «-» очищает строку. */
export function applyOverride(key: string, raw: string): void {
  const f = FIELDS[key];
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

function maskSecret(v: string): string {
  if (!v) return "— не задан";
  return v.length <= 6 ? "••••••" : "••••••" + v.slice(-4);
}

/** Текущее значение поля для показа (секреты замаскированы). */
export function displayValue(key: string): string {
  const f = FIELDS[key];
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
