import { config } from "../config.js";
import type { Experience } from "../types.js";
import { chat } from "./openrouter.js";

const EXPS: Experience[] = ["noExperience", "between1And3", "between3And6", "moreThan6"];

function asExp(v: unknown): Experience | undefined {
  return typeof v === "string" && (EXPS as string[]).includes(v) ? (v as Experience) : undefined;
}

function parseJson(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Один JSON-запрос с перебором score-моделей (дёшево, для разовых задач онбординга). */
async function askJson(system: string, user: string): Promise<any | null> {
  for (const model of config.scoreModels) {
    try {
      const text = await chat({ model, system, user, maxTokens: 500 });
      const o = parseJson(text);
      if (o) return o;
    } catch (e: any) {
      console.warn(`[derive] ${model}: ${e.message}`);
    }
  }
  return null;
}

export interface ResumeTrack {
  title: string;
  keywords: string;
  experience?: Experience;
}

/**
 * По тексту резюме определяет целевую должность, поисковый запрос для hh.ru
 * и требуемый опыт. Бросает, если нет ключа OpenRouter (тогда — ручной ввод).
 */
export async function deriveResumeTrack(resume: string): Promise<ResumeTrack> {
  if (!config.openRouterKey) throw new Error("OPENROUTER_API_KEY не задан");
  const system =
    "Ты помогаешь настроить поиск вакансий по резюме. Верни ТОЛЬКО JSON без пояснений.";
  const user =
    `Резюме:\n${resume.slice(0, 6000)}\n\n` +
    `Определи основную целевую должность кандидата и поисковый запрос для hh.ru.\n` +
    `Верни JSON: {"title":"короткое название должности","keywords":"2-5 ключевых слов/синонимов для поиска","experience":"noExperience|between1And3|between3And6|moreThan6"}`;
  const o = await askJson(system, user);
  if (!o?.keywords) throw new Error("модель не вернула ключевые слова");
  return {
    title: String(o.title || o.keywords).slice(0, 80),
    keywords: String(o.keywords).slice(0, 200),
    experience: asExp(o.experience),
  };
}

export interface TargetTrack {
  title: string;
  keywords: string;
  transferPrompt: string;
}

/**
 * Строит второй трек (переход в другую сферу): поисковый запрос под желаемую роль
 * + карту переноса опыта из резюме на язык этой роли.
 */
export async function deriveTargetTrack(resume: string, targetRole: string): Promise<TargetTrack> {
  if (!config.openRouterKey) throw new Error("OPENROUTER_API_KEY не задан");

  const meta = await askJson(
    "Ты помогаешь настроить поиск вакансий. Верни ТОЛЬКО JSON без пояснений.",
    `Желаемое направление кандидата: "${targetRole}".\n` +
      `Верни JSON: {"title":"короткое название должности","keywords":"2-5 ключевых слов/синонимов для поиска на hh.ru"}`,
  );
  const title = String(meta?.title || targetRole).slice(0, 80);
  const keywords = String(meta?.keywords || targetRole).slice(0, 200);

  const transferPrompt = await chat({
    model: config.letterModel,
    system:
      "Ты карьерный консультант. По резюме кандидата составь карту переноса опыта (transferable skills) " +
      "на язык желаемой роли: переформулируй РЕАЛЬНЫЙ опыт, ничего не выдумывая. Верни только текст карты, 5-8 пунктов.",
    user: `Резюме:\n${resume.slice(0, 6000)}\n\nЖелаемая роль: ${targetRole}`,
    temperature: 0.4,
    maxTokens: 600,
  }).catch(() => "");

  return {
    title,
    keywords,
    transferPrompt:
      transferPrompt.trim() ||
      `Кандидат переходит в «${targetRole}». Оценивай через transferable skills из резюме, не приписывая несуществующего опыта.`,
  };
}
