import type { Experience, ScoreWeights, TrackConfig } from "../types.js";

/** Трек по резюме (прямое совпадение): вес опыта выше. */
export const WEIGHTS_A: ScoreWeights = {
  experience: 35,
  skills: 20,
  salary: 15,
  schedule: 10,
  industry: 10,
  requirements: 10,
};

/** Трек-переход в другую сферу: вес навыков/требований выше, опыт ниже. */
export const WEIGHTS_B: ScoreWeights = {
  experience: 20,
  skills: 35,
  salary: 15,
  schedule: 10,
  industry: 5,
  requirements: 15,
};

const DEFAULT_AREA = { areaId: "113", areaName: "Россия" };

export interface TrackAInput {
  title: string;
  keywords: string;
  experience?: Experience;
  resume: string;
}

export interface TrackBInput {
  title: string;
  keywords: string;
  transferPrompt: string;
  resume: string;
}

/** Основной трек — прямо по резюме пользователя. */
export function buildTrackA(input: TrackAInput): TrackConfig {
  return {
    id: "A",
    title: `Track A · ${input.title}`,
    query: { keywords: input.keywords, ...DEFAULT_AREA, experience: input.experience },
    weights: WEIGHTS_A,
    resumeProfile: input.resume,
  };
}

/** Второй трек — переход в смежное/другое направление через перенос опыта. */
export function buildTrackB(input: TrackBInput): TrackConfig {
  return {
    id: "B",
    title: `Track B · ${input.title}`,
    query: { keywords: input.keywords, ...DEFAULT_AREA },
    weights: WEIGHTS_B,
    resumeProfile: input.resume,
    transferPrompt: input.transferPrompt,
  };
}
