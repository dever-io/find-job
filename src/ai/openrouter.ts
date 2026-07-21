import { config } from "../config.js";
import { chatUrl, modelsUrl } from "../providers.js";
import https from "node:https";

// Клиент любого OpenAI-совместимого провайдера (OpenRouter/OpenAI/DeepSeek/Groq/…).
// URL и ключ берутся из config/providers, поэтому смена провайдера в /admin работает
// без правок кода. Имя файла историческое.

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

function authHeaders(): Headers {
  return {
    Authorization: `Bearer ${config.aiKey}`,
    "Content-Type": "application/json",
    // OpenRouter просит указывать источник трафика (прочие провайдеры игнорируют):
    "HTTP-Referer": config.appUrl,
    "X-Title": config.appTitle,
  };
}

// ── HTTP через SOCKS-прокси (config.aiProxy) или напрямую (глобальный fetch) ──

async function reqProxied(
  method: "GET" | "POST",
  url: string,
  headers: Headers,
  body: string | undefined,
  timeoutMs: number,
): Promise<any> {
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  const agent = new SocksProxyAgent(config.aiProxy);
  const h = body ? { ...headers, "Content-Length": Buffer.byteLength(body) } : headers;
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, agent, headers: h }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        const code = res.statusCode ?? 0;
        if (code < 200 || code >= 400) return reject(new Error(`ИИ ${code}: ${d.slice(0, 200)}`));
        try {
          resolve(JSON.parse(d));
        } catch {
          reject(new Error("ИИ: невалидный JSON в ответе"));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("ИИ: таймаут")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function reqDirect(
  method: "GET" | "POST",
  url: string,
  headers: Headers,
  body: string | undefined,
  timeoutMs: number,
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, signal: ctrl.signal, headers, body });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      throw new Error(`ИИ ${res.status}: ${b.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function request(
  method: "GET" | "POST",
  url: string,
  headers: Headers,
  body: string | undefined,
  timeoutMs: number,
): Promise<any> {
  return config.aiProxy
    ? reqProxied(method, url, headers, body, timeoutMs)
    : reqDirect(method, url, headers, body, timeoutMs);
}

/** Один запрос к Chat Completions выбранного провайдера. Бросает при ошибке/пустом ответе. */
export async function chat(opts: ChatOptions, timeoutMs = 30000): Promise<string> {
  if (!config.aiKey) throw new Error("ключ ИИ не задан");
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
  const data = await request("POST", chatUrl(), authHeaders(), body, timeoutMs);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("ИИ: пустой ответ");
  return content;
}

/**
 * Список доступных моделей провайдера (GET {base}/models, формат OpenAI:
 * {data:[{id}]}). Нужен для выбора модели в /admin, чтобы не угадывать слаги.
 */
export async function listModels(timeoutMs = 20000): Promise<string[]> {
  if (!config.aiKey) throw new Error("ключ ИИ не задан");
  const data = await request("GET", modelsUrl(), authHeaders(), undefined, timeoutMs);
  const items: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const ids = items
    .map((m) => (typeof m === "string" ? m : m?.id))
    .filter((s): s is string => typeof s === "string" && Boolean(s));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
