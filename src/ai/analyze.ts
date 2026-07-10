import { config } from "../config.js";
import type { ScoreWeights, TrackConfig, Vacancy, VerifyResult } from "../types.js";
import { chat } from "./openrouter.js";

/** Факторы скоринга — совпадают с ключами ScoreWeights (spec §7). */
const FACTORS = ["experience", "skills", "salary", "schedule", "industry", "requirements"] as const;
type Factor = (typeof FACTORS)[number];

const FACTOR_RU: Record<Factor, string> = {
  experience: "релевантность опыта кандидата задачам вакансии",
  skills: "совпадение навыков/стека",
  salary: "соответствие зарплатных ожиданий (если указаны)",
  schedule: "формат работы (удалёнка/офис/график)",
  industry: "близость индустрии/домена",
  requirements: "покрытие формальных требований вакансии",
};

interface Analysis {
  factors: Record<Factor, number>; // 0..100 по каждому фактору
  matchReasons: string[];
  mismatchReasons: string[];
}

const SYSTEM =
  "Ты — ассистент карьерного консультанта. Оцениваешь, насколько вакансия подходит конкретному " +
  "кандидату по его резюме. Возвращаешь ТОЛЬКО один JSON-объект без markdown, кода и пояснений.";

function buildPrompt(track: TrackConfig, v: Vacancy): string {
  const factorList = FACTORS.map((f) => `  "${f}": 0-100  // ${FACTOR_RU[f]}`).join("\n");

  const vac = [
    `Название: ${v.title}`,
    `Компания: ${v.company ?? "—"}`,
    `Регион: ${v.area ?? "—"}`,
    `З/п: ${v.salaryFrom ?? "?"}–${v.salaryTo ?? "?"} ${v.currency ?? ""}`,
    v.experienceName ? `Требуемый опыт: ${v.experienceName}` : null,
    v.keySkills?.length ? `Ключевые навыки: ${v.keySkills.join(", ")}` : null,
    `Описание: ${(v.description || v.snippet || "").slice(0, 2500)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const transfer = track.transferPrompt
    ? `\n\nВАЖНО (перенос опыта):\n${track.transferPrompt}\n`
    : "\n";

  return (
    `РЕЗЮМЕ КАНДИДАТА:\n${track.resumeProfile}\n` +
    transfer +
    `\nВАКАНСИЯ:\n${vac}\n\n` +
    `Оцени соответствие по каждому фактору 0..100 и приведи по 1–4 коротких аргумента ` +
    `«за» и «против» (по-русски, по существу). Верни строго JSON:\n` +
    `{\n"factors": {\n${factorList}\n},\n` +
    `"match": ["аргумент за", ...],\n"mismatch": ["аргумент против", ...]\n}`
  );
}

function clamp(n: unknown): number {
  const x = Math.round(Number(n));
  return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : 0;
}

function parse(text: string): Analysis | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const src = o.factors ?? o;
    const factors = {} as Record<Factor, number>;
    let any = false;
    for (const f of FACTORS) {
      if (src[f] !== undefined) any = true;
      factors[f] = clamp(src[f]);
    }
    if (!any) return null;
    const toArr = (x: unknown): string[] =>
      Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean).slice(0, 4) : [];
    return { factors, matchReasons: toArr(o.match), mismatchReasons: toArr(o.mismatch) };
  } catch {
    return null;
  }
}

/** Взвешенное среднее по весам трека → итоговый matchScore 0..100. */
export function weightedScore(factors: Record<Factor, number>, weights: ScoreWeights): number {
  let sum = 0;
  let wsum = 0;
  for (const f of FACTORS) {
    const w = weights[f] ?? 0;
    sum += factors[f] * w;
    wsum += w;
  }
  return wsum ? Math.round(sum / wsum) : 0;
}

/** Фолбэк без ИИ: пересечение ключевых слов трека с текстом вакансии. */
function heuristic(track: TrackConfig, v: Vacancy): VerifyResult {
  const hay = `${v.title} ${v.description || v.snippet || ""} ${(v.keySkills ?? []).join(" ")}`.toLowerCase();
  const toks = track.query.keywords
    .toLowerCase()
    .replace(/\bor\b/gi, " ")
    .split(/[^a-zа-яё0-9+#.]+/i)
    .filter((t) => t.length > 2);
  const hits = toks.filter((t) => hay.includes(t)).length;
  let score = toks.length ? Math.round((hits / toks.length) * 100) : 50;
  const q = track.query;
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

function summarize(a: Analysis, score: number): string {
  if (a.matchReasons.length) return a.matchReasons[0];
  if (a.mismatchReasons.length) return `Риски: ${a.mismatchReasons[0]}`;
  return `Оценка ИИ: ${score}/100`;
}

/** Анализ одной вакансии для трека: перебор моделей → взвешенный скор, затем эвристика. */
export async function analyzeOne(track: TrackConfig, v: Vacancy): Promise<VerifyResult> {
  const models = config.scoreModels;
  if (config.openRouterKey && models.length) {
    for (const model of models) {
      try {
        const text = await chat({
          model,
          system: SYSTEM,
          user: buildPrompt(track, v),
          maxTokens: 600,
        });
        const a = parse(text);
        if (a) {
          const score = weightedScore(a.factors, track.weights);
          return {
            vacancyId: v.id,
            model,
            score,
            relevant: score >= config.scoreThreshold,
            reason: summarize(a, score),
            matchReasons: a.matchReasons,
            mismatchReasons: a.mismatchReasons,
          };
        }
      } catch (e: any) {
        console.warn(`[analyze] ${model}: ${e.message}`);
      }
    }
  }
  return heuristic(track, v);
}

/** Анализ списка вакансий с ограниченным параллелизмом. */
export async function analyzeMany(track: TrackConfig, vacancies: Vacancy[]): Promise<VerifyResult[]> {
  const out: VerifyResult[] = new Array(vacancies.length);
  let idx = 0;
  const workers = Math.max(1, Math.min(config.verifyConcurrency, vacancies.length || 1));
  async function worker() {
    while (idx < vacancies.length) {
      const i = idx++;
      out[i] = await analyzeOne(track, vacancies[i]);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
