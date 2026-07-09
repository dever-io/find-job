import type { Plan } from "./config.js";

export type { Plan };

export type Experience = "noExperience" | "between1And3" | "between3And6" | "moreThan6";
export type Schedule = "any" | "remote" | "fullDay" | "flexible";
export type Employment = "any" | "full" | "part" | "project";

/** Что ищет пользователь — набор фильтров. */
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
}

/** Вердикт ИИ (или эвристики) о соответствии вакансии запросу. */
export interface VerifyResult {
  vacancyId: string;
  relevant: boolean;
  score: number; // 0..100
  reason: string;
  model: string;
}

export interface SubscriptionState {
  plan: Plan;
  active: boolean;
  isRecurring: boolean; // включено ли автопродление
  expiresAt?: number; // unix seconds (subscription_expiration_date)
  chargeId?: string; // telegram_payment_charge_id (для отмены/возврата)
  startedAt?: string;
}

export interface UserRecord {
  id: number;
  chatId: number;
  username?: string;
  firstName?: string;
  createdAt: string;
  query?: SearchQuery;
  subscription: SubscriptionState;
  seenVacancyIds: string[]; // дедуп: что уже отправляли
  lastDeliveryDate?: string; // YYYY-MM-DD последней дневной выдачи
  lastPreviewAt?: string;
}

/** Шаги визарда, требующие текстового ввода (остальные — на кнопках). */
export type WizardStep = "idle" | "keywords" | "area_custom" | "extra";

export interface Session {
  step: WizardStep;
  draft: Partial<SearchQuery>;
}

export function defaultSubscription(): SubscriptionState {
  return { plan: "basic", active: false, isRecurring: false };
}
