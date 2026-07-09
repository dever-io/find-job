import { config } from "../config.js";
import type { Plan, SearchQuery, Vacancy, VerifyResult } from "../types.js";
import { chat } from "./openrouter.js";

const SYSTEM =
  "Ты — ассистент рекрутера. Оцениваешь, насколько вакансия соответствует запросу кандидата. " +
  "Отвечай ТОЛЬКО одним JSON-объектом, без markdown и пояснений.";

function buildPrompt(q: SearchQuery, v: Vacancy): string {
  const criteria = [
    `Запрос: ${q.keywords}`,
    q.salaryFrom ? `Желаемая з/п: от ${q.salaryFrom} ₽` : "З/п: не важно",
    q.experience ? `Опыт: ${q.experience}` : null,
    q.schedule && q.schedule !== "any" ? `Формат работы: ${q.schedule}` : null,
    q.extra ? `Особые пожелания: ${q.extra}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const vac = [
    `Название: ${v.title}`,
    `Компания: ${v.company ?? "—"}`,
    `Регион: ${v.area ?? "—"}`,
    `З/п: ${v.salaryFrom ?? "?"}–${v.salaryTo ?? "?"} ${v.currency ?? ""}`,
    `Описание: ${(v.snippet ?? "").slice(0, 700)}`,
  ].join("\n");

  return (
    `Критерии кандидата:\n${criteria}\n\n` +
    `Вакансия:\n${vac}\n\n` +
    `Верни строго JSON вида:\n` +
    `{"relevant": true|false, "score": 0-100, "reason": "одно короткое предложение по-русски"}`
  );
}

function parse(text: string): { relevant: boolean; score: number; reason: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const score = Math.max(0, Math.min(100, Math.round(Number(o.score))));
    if (!Number.isFinite(score)) return null;
    return {
      relevant: typeof o.relevant === "boolean" ? o.relevant : score >= config.scoreThreshold,
      score,
      reason: String(o.reason ?? "").slice(0, 200) || "оценено ИИ",
    };
  } catch {
    return null;
  }
}

/** Фолбэк без ИИ: простое пересечение по ключевым словам. */
function heuristic(q: SearchQuery, v: Vacancy): VerifyResult {
  const hay = `${v.title} ${v.snippet ?? ""}`.toLowerCase();
  const toks = q.keywords
    .toLowerCase()
    .split(/[^a-zа-яё0-9+#.]+/i)
    .filter((t) => t.length > 2);
  const hits = toks.filter((t) => hay.includes(t)).length;
  let score = toks.length ? Math.round((hits / toks.length) * 100) : 50;
  if (q.salaryFrom && v.salaryFrom && v.salaryFrom < q.salaryFrom) score -= 25;
  score = Math.max(0, Math.min(100, score));
  return {
    vacancyId: v.id,
    relevant: score >= config.scoreThreshold,
    score,
    reason: `Совпадение по ключевым словам: ${hits}/${toks.length || 0}`,
    model: "эвристика",
  };
}

/** Проверка одной вакансии: перебор моделей плана, затем фолбэк на эвристику. */
export async function verifyOne(q: SearchQuery, v: Vacancy, plan: Plan): Promise<VerifyResult> {
  const isPro = plan === "pro";
  const models = isPro ? [config.proModel] : config.freeModels;
  if (config.openRouterKey && models.length) {
    for (const model of models) {
      try {
        const text = await chat({
          model,
          system: SYSTEM,
          user: buildPrompt(q, v),
          // для Про (reasoning-модель qwen3-32b) отключаем thinking и даём запас токенов
          maxTokens: isPro ? 500 : 250,
          reasoningEnabled: isPro ? false : undefined,
        });
        const p = parse(text);
        if (p) return { vacancyId: v.id, model, ...p };
      } catch (e: any) {
        console.warn(`[verify] ${model}: ${e.message}`);
      }
    }
  }
  return heuristic(q, v);
}

/** Проверка списка вакансий с ограниченным параллелизмом. */
export async function verifyMany(q: SearchQuery, vacancies: Vacancy[], plan: Plan): Promise<VerifyResult[]> {
  const out: VerifyResult[] = new Array(vacancies.length);
  let idx = 0;
  const workers = Math.max(1, Math.min(config.verifyConcurrency, vacancies.length || 1));
  async function worker() {
    while (idx < vacancies.length) {
      const i = idx++;
      out[i] = await verifyOne(q, vacancies[i], plan);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
