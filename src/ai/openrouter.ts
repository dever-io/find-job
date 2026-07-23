import { config } from "../config.js";
import { chatUrlFor, modelsUrlFor, endpointFor, type Role } from "../providers.js";
import { store } from "../store.js";
import https from "node:https";

// Клиент любого OpenAI-совместимого провайдера (OpenRouter/OpenAI/DeepSeek/Groq/…).
// URL и ключ берутся из config/providers по роли задачи, поэтому у скоринга и писем
// могут быть разные провайдеры. Имя файла историческое.

export interface ChatOptions {
  model: string;
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Задача: определяет провайдера+ключ (см. providers.endpointFor). */
  role?: Role;
  /** false → явно отключить «размышления» reasoning-моделей (qwen3, gpt-oss…),
   *  иначе они тратят весь бюджет токенов на thinking и возвращают пустой content. */
  reasoningEnabled?: boolean;
}

type Headers = Record<string, string>;

function authHeaders(role?: Role): Headers {
  const ep = endpointFor(role);
  const h: Headers = {
    Authorization: `Bearer ${ep.key}`,
    "Content-Type": "application/json",
    // OpenRouter просит указывать источник трафика (прочие провайдеры игнорируют):
    "HTTP-Referer": config.appUrl,
    "X-Title": config.appTitle,
  };
  // Anthropic: у него РАЗНАЯ авторизация на эндпоинтах. /v1/chat/completions
  // (OpenAI-compat) принимает Bearer, а нативный /v1/models ждёт x-api-key. Шлём
  // оба заголовка + версию API — тогда работают и генерация, и список моделей.
  if (ep.base.includes("api.anthropic.com")) {
    h["anthropic-version"] = "2023-06-01";
    h["x-api-key"] = ep.key;
  }
  return h;
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

/**
 * Один запрос к Chat Completions провайдера роли. Бросает при ошибке/пустом ответе.
 *
 * Разные провайдеры/модели не принимают часть параметров (новые Claude: 400
 * «temperature is deprecated»; o-серия OpenAI: max_tokens → max_completion_tokens;
 * не-OpenRouter не знают reasoning). Поэтому при 400 про конкретный параметр
 * адаптируем payload и повторяем — до 3 попыток.
 */
export async function chat(opts: ChatOptions, timeoutMs = 30000): Promise<string> {
  if (!endpointFor(opts.role).key) throw new Error("ключ ИИ не задан");
  const payload: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 400,
    ...(opts.reasoningEnabled === false ? { reasoning: { enabled: false } } : {}),
    messages: [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: opts.user },
    ],
  };

  for (let attempt = 0; ; attempt++) {
    try {
      const data = await request("POST", chatUrlFor(opts.role), authHeaders(opts.role), JSON.stringify(payload), timeoutMs);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("ИИ: пустой ответ");
      // usage — формат OpenAI (prompt_tokens/completion_tokens); Anthropic-compat отдаёт то же.
      const u = data?.usage;
      if (opts.role && u) store.recordAiUsage(opts.role, Number(u.prompt_tokens) || 0, Number(u.completion_tokens) || 0);
      return content;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (attempt >= 3 || !/ИИ 4\d\d/.test(msg)) throw e;
      // Модель не принимает параметр → убираем/заменяем его и повторяем.
      if (/temperature/i.test(msg) && "temperature" in payload) {
        delete payload.temperature;
        continue;
      }
      if (/max_completion_tokens/i.test(msg) && "max_tokens" in payload) {
        payload.max_completion_tokens = payload.max_tokens;
        delete payload.max_tokens;
        continue;
      }
      if (/reasoning/i.test(msg) && "reasoning" in payload) {
        delete payload.reasoning;
        continue;
      }
      if (/max_tokens/i.test(msg) && "max_tokens" in payload) {
        payload.max_completion_tokens = payload.max_tokens;
        delete payload.max_tokens;
        continue;
      }
      throw e;
    }
  }
}

/**
 * Список доступных моделей провайдера роли (GET {base}/models, формат OpenAI:
 * {data:[{id}]}). Нужен для выбора модели в /admin, чтобы не угадывать слаги.
 */
export async function listModels(role?: Role, timeoutMs = 20000): Promise<string[]> {
  if (!endpointFor(role).key) throw new Error("ключ ИИ не задан");
  const data = await request("GET", modelsUrlFor(role), authHeaders(role), undefined, timeoutMs);
  const items: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  // OpenRouter отдаёт тариф прямо в /models (pricing.prompt/completion, $/токен) —
  // это точнее статичной таблицы в pricing.ts, кладём в её динамический кэш.
  if (items.some((m) => m?.pricing)) {
    const { setDynamicPrice } = await import("./pricing.js");
    for (const m of items) {
      if (m?.id && m?.pricing) setDynamicPrice(m.id, m.pricing.prompt, m.pricing.completion);
    }
  }
  const ids = items
    .map((m) => (typeof m === "string" ? m : m?.id))
    .filter((s): s is string => typeof s === "string" && Boolean(s));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
