import { config } from "./config.js";

/**
 * Реестр ИИ-провайдеров. Все — OpenAI-совместимые: Chat Completions на
 * {base}/chat/completions, список моделей на {base}/models. Провайдер и ключ
 * меняются через /admin. "custom" — свой base URL для самохоста/иного провайдера.
 */
export interface ProviderDef {
  id: string;
  label: string;
  base: string; // без хвостового /chat/completions; пусто у custom
  keyHint: string;
}

export const PROVIDERS: ProviderDef[] = [
  { id: "openrouter", label: "OpenRouter", base: "https://openrouter.ai/api/v1", keyHint: "sk-or-v1-…" },
  { id: "openai", label: "OpenAI", base: "https://api.openai.com/v1", keyHint: "sk-…" },
  // Anthropic: нативный API НЕ OpenAI-совместим, но есть compat-эндпоинт на /v1
  // (Bearer + заголовок anthropic-version, который добавляется в ai/openrouter.ts).
  { id: "anthropic", label: "Anthropic (Claude)", base: "https://api.anthropic.com/v1", keyHint: "sk-ant-…" },
  { id: "deepseek", label: "DeepSeek", base: "https://api.deepseek.com", keyHint: "sk-…" },
  { id: "groq", label: "Groq", base: "https://api.groq.com/openai/v1", keyHint: "gsk_…" },
  { id: "mistral", label: "Mistral", base: "https://api.mistral.ai/v1", keyHint: "…" },
  { id: "together", label: "Together AI", base: "https://api.together.xyz/v1", keyHint: "…" },
  { id: "custom", label: "Другой (свой URL)", base: "", keyHint: "ключ провайдера" },
];

export function providerDef(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerLabelOf(id: string): string {
  return providerDef(id)?.label ?? (id || "—");
}

/** Нормализует base URL: добавляет схему (без неё fetch не парсит), снимает хвостовой /. */
export function normalizeBase(raw: string): string {
  let b = (raw || "").trim();
  if (b && !/^https?:\/\//i.test(b)) b = "https://" + b;
  return b.replace(/\/+$/, "");
}

/** База OpenAI-совместимого API по провайдеру: явный customBase → иначе из реестра. */
export function providerBase(providerId: string, customBase: string): string {
  return normalizeBase(customBase || providerDef(providerId)?.base || "");
}

// ── Роли (задачи), которым можно назначить свой провайдер ──
export type Role = "score" | "letter";

export interface Endpoint {
  providerId: string;
  base: string;
  key: string;
}

/**
 * Эндпоинт для задачи: если у роли задан свой провайдер (scoreProvider/
 * letterProvider) — берём его провайдер+ключ, иначе общий (aiProvider/aiKey).
 */
export function endpointFor(role?: Role): Endpoint {
  if (role === "score" && config.scoreProvider) {
    return { providerId: config.scoreProvider, base: providerBase(config.scoreProvider, config.scoreBase), key: config.scoreKey };
  }
  if (role === "letter" && config.letterProvider) {
    return { providerId: config.letterProvider, base: providerBase(config.letterProvider, config.letterBase), key: config.letterKey };
  }
  return { providerId: config.aiProvider, base: providerBase(config.aiProvider, config.aiBase), key: config.aiKey };
}

/** Задан ли у роли собственный провайдер (иначе — «как общий»). */
export function roleHasOwn(role: Role): boolean {
  return role === "score" ? Boolean(config.scoreProvider) : Boolean(config.letterProvider);
}

export function chatUrlFor(role?: Role): string {
  return endpointFor(role).base + "/chat/completions";
}
export function modelsUrlFor(role?: Role): string {
  return endpointFor(role).base + "/models";
}
export function keyFor(role?: Role): string {
  return endpointFor(role).key;
}

// ── Общий (default) провайдер — тонкие обёртки над endpointFor(undefined) ──
export function providerLabel(): string {
  return providerLabelOf(config.aiProvider);
}
export function resolveBase(): string {
  return endpointFor(undefined).base;
}
export function chatUrl(): string {
  return chatUrlFor(undefined);
}
export function modelsUrl(): string {
  return modelsUrlFor(undefined);
}
