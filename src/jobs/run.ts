import { type Api } from "grammy";
import { store, nowIso } from "../store.js";
import { findMatches, type Match } from "./pipeline.js";
import { vacancyCard } from "../format.js";
import { actionKeyboard } from "../ui.js";
import { sleep } from "../util.js";
import type { StoredVacancy, TrackId } from "../types.js";

/** Горячая вакансия: свежая (≤24ч) и с высоким скором. */
export function isHot(publishedAt: string | undefined, score: number): boolean {
  if (score < 85 || !publishedAt) return false;
  const ageH = (Date.now() - Date.parse(publishedAt)) / 3.6e6;
  return Number.isFinite(ageH) && ageH <= 24;
}

/** Куда постим трек: группа + тред топика. null — трек не привязан. */
function target(trackId: TrackId): { groupId: number; threadId: number } | null {
  const groupId = store.meta.groupId;
  const threadId = store.threadId(trackId);
  if (!groupId || threadId === undefined) {
    console.warn(`[run] трек ${trackId} не привязан к топику — пропуск`);
    return null;
  }
  return { groupId, threadId };
}

/** Постит набор матчей в топик трека, помечает их seen, сохраняет в историю. */
async function postMatches(api: Api, trackId: TrackId, matches: Match[]): Promise<number> {
  const dst = target(trackId);
  if (!dst || !matches.length) return 0;

  store.markSeen(
    trackId,
    matches.map((m) => m.vacancy.id),
  );
  await store.save();

  for (const m of matches) {
    const hot = isHot(m.vacancy.publishedAt, m.verdict.score);
    const text = vacancyCard(m.vacancy, m.verdict, { track: trackId, hot });
    const sent = await api
      .sendMessage(dst.groupId, text, {
        message_thread_id: dst.threadId,
        parse_mode: "HTML",
        reply_markup: actionKeyboard(m.vacancy.id, m.vacancy.url),
        link_preview_options: { is_disabled: true },
      })
      .catch((e) => {
        console.error("[run] send failed:", e?.message ?? e);
        return undefined;
      });

    const rec: StoredVacancy = {
      id: m.vacancy.id,
      track: trackId,
      vacancy: m.vacancy,
      verdict: m.verdict,
      status: "Viewed",
      hot,
      cardMessageId: sent?.message_id,
      createdAt: nowIso(),
    };
    await store.upsertVacancy(rec);
    await sleep(150); // мягкий троттлинг под лимиты Telegram
  }
  return matches.length;
}

/** Плановый прогон одного трека: поиск за 3 дня → постинг всех матчей. */
export async function runTrack(api: Api, trackId: TrackId): Promise<number> {
  const track = store.getTrack(trackId);
  if (!track || !target(trackId)) return 0;
  const matches = await findMatches(track, {
    excludeIds: store.seenSet(trackId),
    periodDays: 3,
  });
  const n = await postMatches(api, trackId, matches);
  console.log(`[run] трек ${trackId}: отправлено ${n}`);
  return n;
}

/** Горячий скан трека: свежие (≤1 день) → постим ТОЛЬКО 🔥, seen ставим только им. */
export async function runHotTrack(api: Api, trackId: TrackId): Promise<number> {
  const track = store.getTrack(trackId);
  if (!track || !target(trackId)) return 0;
  const matches = await findMatches(track, {
    excludeIds: store.seenSet(trackId),
    periodDays: 1,
  });
  const hot = matches.filter((m) => isHot(m.vacancy.publishedAt, m.verdict.score));
  const n = await postMatches(api, trackId, hot);
  if (n) console.log(`[run] трек ${trackId}: 🔥 отправлено ${n}`);
  return n;
}

/** Прогон по всем настроенным трекам — вызывается дневным кроном и командой /run. */
export async function runAll(api: Api): Promise<Record<TrackId, number>> {
  const result = {} as Record<TrackId, number>;
  for (const track of store.tracks()) {
    try {
      result[track.id] = await runTrack(api, track.id);
    } catch (e) {
      console.error(`[run] трек ${track.id} упал`, e);
      result[track.id] = 0;
    }
  }
  return result;
}

/** Горячий скан по всем трекам — вызывается частым кроном. */
export async function runHotAll(api: Api): Promise<number> {
  let total = 0;
  for (const track of store.tracks()) {
    try {
      total += await runHotTrack(api, track.id);
    } catch (e) {
      console.error(`[run] горячий скан трека ${track.id} упал`, e);
    }
  }
  return total;
}
