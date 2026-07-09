import { config } from "../config.js";

export interface ChatOptions {
  model: string;
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** false → явно отключить «размышления» reasoning-моделей (qwen3, gpt-oss…),
   *  иначе они тратят весь бюджет токенов на thinking и возвращают пустой content. */
  reasoningEnabled?: boolean;
}

/** Один запрос к OpenRouter Chat Completions. Бросает при ошибке/пустом ответе. */
export async function chat(opts: ChatOptions, timeoutMs = 30000): Promise<string> {
  if (!config.openRouterKey) throw new Error("OPENROUTER_API_KEY is empty");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(config.openRouterUrl, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${config.openRouterKey}`,
        "Content-Type": "application/json",
        // OpenRouter просит указывать источник трафика (необязательно):
        "HTTP-Referer": config.appUrl,
        "X-Title": config.appTitle,
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 400,
        ...(opts.reasoningEnabled === false ? { reasoning: { enabled: false } } : {}),
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 160)}`);
    }
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("OpenRouter: empty content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}
