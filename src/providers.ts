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

export function providerLabel(): string {
  return providerDef(config.aiProvider)?.label ?? (config.aiProvider || "—");
}

/** База OpenAI-совместимого API: явный aiBase → иначе из реестра по aiProvider. */
export function resolveBase(): string {
  let b = config.aiBase || providerDef(config.aiProvider)?.base || "";
  b = b.trim();
  if (b && !/^https?:\/\//i.test(b)) b = "https://" + b; // без схемы fetch не парсит URL
  return b.replace(/\/+$/, "");
}

export function chatUrl(): string {
  return resolveBase() + "/chat/completions";
}

export function modelsUrl(): string {
  return resolveBase() + "/models";
}
