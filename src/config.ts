import "dotenv/config";

const env = process.env;

export type Plan = "basic" | "pro";

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  botToken: env.BOT_TOKEN ?? "",

  openRouterKey: env.OPENROUTER_API_KEY ?? "",
  openRouterUrl: env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions",
  freeModels: (
    env.OPENROUTER_FREE_MODELS ??
    "meta-llama/llama-3.3-70b-instruct:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,qwen/qwen3-next-80b-a3b-instruct:free,nousresearch/hermes-3-llama-3.1-405b:free,meta-llama/llama-3.2-3b-instruct:free"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  proModel: env.OPENROUTER_PRO_MODEL ?? "qwen/qwen3-32b",

  appUrl: env.APP_PUBLIC_URL ?? "https://t.me",
  appTitle: env.APP_TITLE ?? "StarJobs",

  // HeadHunter: базовый URL можно переопределить на собственный RU-прокси,
  // если бот деплоится вне России (api.hh.ru гео-блокирует зарубежные IP).
  hhApiBase: (env.HH_API_BASE ?? "https://api.hh.ru").replace(/\/+$/, ""),
  // HH рекомендует UA формата "AppName/version (contact-email)".
  hhUserAgent: env.HH_USER_AGENT ?? "StarJobs/0.1 (starjobs-bot@example.com)",

  cronExpr: env.CRON_EXPR ?? "0 9 * * *",
  cronTz: env.CRON_TZ ?? "Europe/Moscow",

  dataDir: env.DATA_DIR ?? "./data",
  adminId: env.ADMIN_ID ? Number(env.ADMIN_ID) : undefined,

  scoreThreshold: num(env.SCORE_THRESHOLD, 60),
  maxMatchesPerDay: num(env.MAX_MATCHES, 8),
  candidatesToVerify: num(env.CANDIDATES, 18),
  verifyConcurrency: num(env.VERIFY_CONCURRENCY, 4),
};

/** Единственное значение периода подписки, которое принимает Telegram (30 дней). */
export const SUBSCRIPTION_PERIOD = 2592000;

export interface Tariff {
  plan: Plan;
  priceStars: number;
  perDay: number;
  label: string;
  ai: string;
}

export const TARIFFS: Record<Plan, Tariff> = {
  basic: {
    plan: "basic",
    priceStars: num(env.BASIC_PRICE_STARS, 30),
    perDay: 1,
    label: "Базовый",
    ai: "бесплатные модели ИИ",
  },
  pro: {
    plan: "pro",
    priceStars: num(env.PRO_PRICE_STARS, 3000),
    perDay: 100,
    label: "Про",
    ai: "qwen3-32b",
  },
};
