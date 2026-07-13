export type Experience = "noExperience" | "between1And3" | "between3And6" | "moreThan6";
export type Schedule = "any" | "remote" | "fullDay" | "flexible";
export type Employment = "any" | "full" | "part" | "project";

/** Идентификатор трека поиска. */
export type TrackId = "A" | "B";

/** Что ищет трек — набор фильтров для источников. */
export interface SearchQuery {
  keywords: string;
  areaId: string; // id региона в справочнике hh.ru ("113" = Россия)
  areaName: string;
  salaryFrom?: number;
  experience?: Experience;
  schedule?: Schedule;
  employment?: Employment;
  extra?: string; // свободные пожелания для ИИ
}

/** Веса факторов скоринга (сумма ≈ 100). Разные для треков (spec §7). */
export interface ScoreWeights {
  experience: number;
  skills: number;
  salary: number;
  schedule: number;
  industry: number;
  requirements: number;
}

/** Конфиг одного трека поиска. */
export interface TrackConfig {
  id: TrackId;
  title: string;
  /** Хэштег трека для подборки в едином чате, напр. "#видеопродакшн". */
  hashtag: string;
  query: SearchQuery;
  weights: ScoreWeights;
  /** Базовый текст резюме под трек (для писем и скоринга). */
  resumeProfile: string;
  /** Карта переноса опыта / доп. инструкции для LLM (актуально для трека B). */
  transferPrompt?: string;
}

/** Нормализованная вакансия из любого источника. */
export interface Vacancy {
  id: string; // `${source}:${nativeId}`
  source: string; // "hh" | "trudvsem"
  title: string;
  company?: string;
  area?: string;
  salaryFrom?: number;
  salaryTo?: number;
  currency?: string;
  url: string;
  publishedAt?: string; // ISO
  snippet?: string;
  description?: string; // полное описание (добор через detail-endpoint)
  keySkills?: string[]; // ключевые навыки из карточки вакансии (hh key_skills)
  experienceName?: string; // требуемый опыт словами (напр. «3–6 лет»)
}

/** Вердикт ИИ (или эвристики) о соответствии вакансии треку. */
export interface VerifyResult {
  vacancyId: string;
  relevant: boolean;
  score: number; // 0..100 — взвешенный по весам трека
  reason: string; // краткое резюме одной строкой
  model: string;
  /** Аргументы «за» (почему подходит) — для богатой карточки. */
  matchReasons?: string[];
  /** Аргументы «против» (несоответствия/риски). */
  mismatchReasons?: string[];
  /** Ключевые обязанности из вакансии — списком в карточку. */
  responsibilities?: string[];
}

/** Статусы вакансии/отклика в воронке. */
export type Status =
  | "Viewed"
  | "Saved"
  | "Ignored"
  | "Responded"
  | "Interview"
  | "Offer"
  | "Rejected";

/** Вакансия, прошедшая пайплайн и сохранённая в истории. */
export interface StoredVacancy {
  id: string;
  track: TrackId;
  vacancy: Vacancy;
  verdict: VerifyResult;
  status: Status;
  hot: boolean;
  cardMessageId?: number; // id сообщения-карточки для обновления по кнопкам
  createdAt: string;
  // ---- Сопроводительное письмо (Фаза 3) ----
  letter?: string; // текущий черновик/финал письма
  letterMessageId?: number; // id сообщения-черновика в топике «Отклики»
  letterThreadId?: number; // тред, где висит черновик (для editMessageText)
}

/** Ожидаемый следующий ввод пользователя (машина состояний диалога). */
export type Awaiting =
  | { kind: "letter_edit"; vacancyId: string }
  | { kind: "onb_resume" } // ждём резюме (PDF или текст)
  | { kind: "onb_keywords_a" } // ждём ключевые слова для трека по резюме (фолбэк без ИИ)
  | { kind: "onb_track_b" }; // ждём описание второго направления

/** Сессия grammY: держит состояние диалога (онбординг, правка письма). */
export interface Session {
  awaiting?: Awaiting;
  /** Текст резюме, пойманный в онбординге (до финализации треков). */
  draftResume?: string;
}
