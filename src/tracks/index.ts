import type { ScoreWeights, TrackConfig, TrackId } from "../types.js";

/** Базовое резюме владельца (трек A — продакшн/проекты). Источник для писем и скоринга. */
const RESUME_A = `Даниил Александров, 30 лет, Москва. Английский B2. Руководитель проектов / исполнительный продюсер, ~6.5 лет опыта в видео/медиа-продакшене.

Ключевой опыт:
- Head of Production Operations: международный видеопродакшн 30+ человек, до 40+ параллельных проектов, три отдела (креатив, продюсирование, постпродакшн). Построил систему обработки заявок через Tally + Notion, сквозной production pipeline (бриф → выдача → фидбек). Найм по всему миру (Европа, Азия, Лат. Америка). Взаимодействие с маркетингом, legal, аналитикой.
- Исполнительный продюсер (YouTube-шоу): календарные планы, контроль таймингов и бюджетов, координация команды и подрядчиков, внедрение ИИ-инструментов.
- Project Ops Manager (Дубай): управление бизнесом аренды авто «под ключ», CRM, логистика.
- Руководитель отделов пост-продакшн и видеопродакшна: команды 25+ человек, масштабирование 10→35 шоу, автоматизация и контроль качества.

Навыки: проектный менеджмент, планирование бюджета, делегирование, деловая коммуникация, управление подрядчиками, кросс-командное взаимодействие, найм и онбординг, автоматизация бизнес-процессов, Notion, GPT-4, Google Sheets.`;

/** Карта переноса опыта на язык IT PM/PdM (spec §5). Переформулировка, НЕ выдумывание навыков. */
const TRANSFER_B = `Кандидат переходит из видео/медиа-продакшена в IT Product/Project Management. Оценивай через transferable skills — это переформулировка реального опыта, не приписывание несуществующих навыков:
- Вёл 40+ параллельных проектов, pipeline «бриф → выдача → фидбек» → управление бэклогом/pipeline, координация множественных потоков работ.
- Система заявок через Tally + Notion → построение внутренних инструментов и процессов, no-code tooling.
- Управлял 30+ людьми в 3 отделах, найм по миру → кросс-функциональное лидерство, международный найм.
- Взаимодействие с маркетингом, legal, аналитикой → stakeholder management, кросс-департаментная координация.
- Внедрение AI-инструментов в продакшн → AI-tooling adoption.
- Запуск на разных платформах (YouTube, Twitch, Kick) → multi-platform product launches.
Формального опыта в IT-должности нет — оценивай потенциал перехода, а не буквальное совпадение прошлых тайтлов.`;

const WEIGHTS_A: ScoreWeights = {
  experience: 35,
  skills: 20,
  salary: 15,
  schedule: 10,
  industry: 10,
  requirements: 10,
};

const WEIGHTS_B: ScoreWeights = {
  experience: 20,
  skills: 35,
  salary: 15,
  schedule: 10,
  industry: 5,
  requirements: 15,
};

export const TRACKS: Record<TrackId, TrackConfig> = {
  A: {
    id: "A",
    title: "Track A · Руководитель проектов (продакшн)",
    query: {
      keywords: "руководитель проектов продюсер продакшн",
      areaId: "113",
      areaName: "Россия",
      experience: "moreThan6",
    },
    weights: WEIGHTS_A,
    resumeProfile: RESUME_A,
  },
  B: {
    id: "B",
    title: "Track B · Product / Project Manager (IT)",
    query: {
      keywords: "product manager OR project manager OR продакт менеджер OR проджект менеджер",
      areaId: "113",
      areaName: "Россия",
    },
    weights: WEIGHTS_B,
    resumeProfile: RESUME_A,
    transferPrompt: TRANSFER_B,
  },
};

export const TRACK_IDS: TrackId[] = ["A", "B"];

export function getTrack(id: TrackId): TrackConfig {
  return TRACKS[id];
}
