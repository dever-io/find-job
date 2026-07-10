import { type Api } from "grammy";
import { store, nowIso } from "../store.js";
import { findMatches } from "./pipeline.js";
import { vacancyCard } from "../format.js";
import { actionKeyboard } from "../ui.js";
import { sleep } from "../util.js";
import { getTrack, TRACK_IDS } from "../tracks/index.js";
import type { StoredVacancy, TrackId } from "../types.js";

/** Горячая вакансия: свежая (≤24ч) и с высоким скором. */
function isHot(publishedAt: string | undefined, score: number): boolean {
  if (score < 85 || !publishedAt) return false;
  const ageH = (Date.now() - Date.parse(publishedAt)) / 3.6e6;
  return Number.isFinite(ageH) && ageH <= 24;
}

/** Прогон одного трека: поиск → отбор → постинг карточек в топик трека. */
export async function runTrack(api: Api, trackId: TrackId): Promise<number> {
  const track = getTrack(trackId);
  const groupId = store.meta.groupId;
  const threadId = store.threadId(trackId);
  if (!groupId || threadId === undefined) {
    console.warn(`[run] трек ${trackId} не привязан к топику — пропуск`);
    return 0;
  }

  const matches = await findMatches(track, {
    excludeIds: store.seenSet(trackId),
    periodDays: 3,
  });

  store.markSeen(
    trackId,
    matches.map((m) => m.vacancy.id),
  );
  await store.save();

  for (const m of matches) {
    const hot = isHot(m.vacancy.publishedAt, m.verdict.score);
    const text = vacancyCard(m.vacancy, m.verdict, { track: trackId, hot });
    const sent = await api
      .sendMessage(groupId, text, {
        message_thread_id: threadId,
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

  console.log(`[run] трек ${trackId}: отправлено ${matches.length}`);
  return matches.length;
}

/** Прогон по всем трекам — вызывается кроном и командой /run. */
export async function runAll(api: Api): Promise<Record<TrackId, number>> {
  const result = {} as Record<TrackId, number>;
  for (const t of TRACK_IDS) {
    try {
      result[t] = await runTrack(api, t);
    } catch (e) {
      console.error(`[run] трек ${t} упал`, e);
      result[t] = 0;
    }
  }
  return result;
}
