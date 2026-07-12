import "dotenv/config";

const env = process.env;

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  botToken: env.BOT_TOKEN ?? "",

  // Единственный пользователь-владелец: только он управляет ботом.
  ownerId: env.OWNER_ID ? Number(env.OWNER_ID) : undefined,

  openRouterKey: env.OPENROUTER_API_KEY ?? "",
  openRouterUrl: env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions",
  // Модели для скоринга вакансий: перебор с фолбэком (бесплатные по умолчанию).
  scoreModels: (
    env.OPENROUTER_SCORE_MODELS ??
    "deepseek/deepseek-chat-v3-0324:free,meta-llama/llama-3.3-70b-instruct:free,google/gemini-2.0-flash-exp:free,qwen/qwen-2.5-72b-instruct:free"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Сильная модель для генерации сопроводительных писем (не free-tier).
  letterModel: env.LETTER_MODEL ?? "deepseek/deepseek-v4-pro",

  appUrl: env.APP_PUBLIC_URL ?? "https://t.me",
  appTitle: env.APP_TITLE ?? "CareerAgent",

  // HeadHunter: базовый URL можно переопределить на собственный RU-прокси,
  // если бот деплоится вне России (api.hh.ru гео-блокирует зарубежные IP).
  hhApiBase: (env.HH_API_BASE ?? "https://api.hh.ru").replace(/\/+$/, ""),
  // HH рекомендует UA формата "AppName/version (contact-email)".
  // ВАЖНО: HH заносит в чёрный список плейсхолдерные UA (example.com/test) → 400 bad_user_agent.
  hhUserAgent: env.HH_USER_AGENT ?? "CareerAgent/0.2 (d.alxndrov@gmail.com)",
  // Секрет для реверс-прокси HH (заголовок X-Proxy-Key). Пусто = ходим напрямую.
  hhProxyKey: env.HH_PROXY_KEY ?? "",
  // Access token приложения HH (dev.hh.ru/admin). Авторизованный доступ обходит
  // блокировку анонимных дата-центровых IP (Selectel/облака).
  hhAccessToken: env.HH_ACCESS_TOKEN ?? "",
  // Источник данных HH:
  //   "api"    — официальный api.hh.ru (требует HH_ACCESS_TOKEN, иначе 403/капча);
  //   "scrape" — парсинг SSR-стейта сайта hh.ru (без токена);
  //   "auto"   — есть токен → api, нет → scrape.
  hhMode: (env.HH_MODE ?? "auto") as "api" | "scrape" | "auto",
  // База для скрапинга сайта (можно указать RU-прокси сайта, если ДЦ-IP режется).
  hhWebBase: (env.HH_WEB_BASE ?? "https://hh.ru").replace(/\/+$/, ""),
  // Браузерный User-Agent для скрапинга (сайт ждёт браузер, а не "AppName/ver").
  hhWebUserAgent:
    env.HH_WEB_USER_AGENT ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",

  cronExpr: env.CRON_EXPR ?? "0 9 * * *",
  cronTz: env.CRON_TZ ?? "Europe/Moscow",
  // Частый скан «горячих» вакансий (по умолчанию — каждый час в :15).
  hotCronExpr: env.HOT_CRON_EXPR ?? "15 * * * *",
  // Еженедельный дайджест (по умолчанию — понедельник 10:00).
  digestCronExpr: env.DIGEST_CRON_EXPR ?? "0 10 * * 1",

  dataDir: env.DATA_DIR ?? "./data",

  scoreThreshold: num(env.SCORE_THRESHOLD, 60),
  maxMatchesPerRun: num(env.MAX_MATCHES, 8),
  candidatesToVerify: num(env.CANDIDATES, 18),
  verifyConcurrency: num(env.VERIFY_CONCURRENCY, 4),
};
