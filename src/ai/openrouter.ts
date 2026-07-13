import { config } from "../config.js";
import https from "node:https";

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

type Headers = Record<string, string>;

/** POST напрямую через глобальный fetch (обычный путь, не-РФ IP). */
async function postDirect(url: string, headers: Headers, body: string, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers, body });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${b.slice(0, 160)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST через SOCKS-прокси (config.openRouterProxy) — обход гео-блокировки OpenRouter,
 * когда бот работает с РФ-IP. Используем node:https + socks-proxy-agent, т.к. глобальный
 * fetch Node не принимает сторонний dispatcher без конфликта версий undici.
 */
async function postProxied(url: string, headers: Headers, body: string, timeoutMs: number): Promise<any> {
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  const agent = new SocksProxyAgent(config.openRouterProxy);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "POST", agent, headers: { ...headers, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          if (code < 200 || code >= 400) return reject(new Error(`OpenRouter ${code}: ${d.slice(0, 160)}`));
          try {
            resolve(JSON.parse(d));
          } catch {
            reject(new Error("OpenRouter: невалидный JSON в ответе"));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("OpenRouter: таймаут")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Один запрос к OpenRouter Chat Completions. Бросает при ошибке/пустом ответе. */
export async function chat(opts: ChatOptions, timeoutMs = 30000): Promise<string> {
  if (!config.openRouterKey) throw new Error("OPENROUTER_API_KEY is empty");
  const headers: Headers = {
    Authorization: `Bearer ${config.openRouterKey}`,
    "Content-Type": "application/json",
    // OpenRouter просит указывать источник трафика (необязательно):
    "HTTP-Referer": config.appUrl,
    "X-Title": config.appTitle,
  };
  const body = JSON.stringify({
    model: opts.model,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 400,
    ...(opts.reasoningEnabled === false ? { reasoning: { enabled: false } } : {}),
    messages: [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: opts.user },
    ],
  });

  const data = config.openRouterProxy
    ? await postProxied(config.openRouterUrl, headers, body, timeoutMs)
    : await postDirect(config.openRouterUrl, headers, body, timeoutMs);

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenRouter: empty content");
  return content;
}
