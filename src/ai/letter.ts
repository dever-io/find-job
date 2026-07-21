import { config } from "../config.js";
import type { TrackConfig, Vacancy } from "../types.js";
import { chat } from "./openrouter.js";

const SYSTEM =
  "Ты помогаешь кандидату писать сопроводительные письма к вакансиям на русском языке. " +
  "Пишешь от первого лица, по делу, без канцелярита и клише вроде «коммуникабельный, стрессоустойчивый». " +
  "Опираешься ТОЛЬКО на реальный опыт из резюме — ничего не выдумываешь. " +
  "Возвращаешь ТОЛЬКО текст письма, без markdown, без темы письма и без пояснений.";

export interface LetterOpts {
  /** Доп. инструкция: «короче», «официальнее» или свободная правка от владельца. */
  instruction?: string;
  /** Предыдущий вариант письма — тогда модель правит его, а не пишет с нуля. */
  previous?: string;
}

function buildPrompt(track: TrackConfig, v: Vacancy, opts: LetterOpts): string {
  const vac = [
    `Вакансия: ${v.title}`,
    v.company ? `Компания: ${v.company}` : null,
    v.keySkills?.length ? `Ключевые навыки: ${v.keySkills.join(", ")}` : null,
    `Описание: ${(v.description || v.snippet || "").slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const transfer = track.transferPrompt
    ? `\nПЕРЕНОС ОПЫТА (кандидат меняет сферу — переформулируй реальный опыт на язык этой вакансии, не приписывай несуществующее):\n${track.transferPrompt}\n`
    : "\n";

  const base =
    `РЕЗЮМЕ КАНДИДАТА:\n${track.resumeProfile}\n` +
    transfer +
    `\n${vac}\n\n`;

  if (opts.previous) {
    return (
      base +
      `Текущий вариант письма:\n"""\n${opts.previous}\n"""\n\n` +
      `Перепиши это письмо с учётом правки: ${opts.instruction ?? "улучши формулировки"}. ` +
      `Сохрани опору на реальный опыт. Верни только новый текст письма.`
    );
  }

  return (
    base +
    `Напиши сопроводительное письмо к этой вакансии: 3–5 абзацев, ` +
    `свяжи конкретный опыт кандидата с задачами вакансии, ` +
    `в конце — короткая фраза о готовности обсудить детали.` +
    (opts.instruction ? `\nДоп. требование: ${opts.instruction}.` : "")
  );
}

/**
 * Генерация/переписывание сопроводительного письма сильной моделью (LETTER_MODEL).
 * Бросает, если нет ключа OpenRouter — писем без ИИ не делаем.
 */
export async function generateLetter(track: TrackConfig, v: Vacancy, opts: LetterOpts = {}): Promise<string> {
  if (!config.aiKey) throw new Error("ключ ИИ не задан — генерация писем недоступна");
  const text = await chat(
    {
      model: config.letterModel,
      system: SYSTEM,
      user: buildPrompt(track, v, opts),
      temperature: 0.5,
      maxTokens: 900,
    },
    45000,
  );
  return text.trim();
}
