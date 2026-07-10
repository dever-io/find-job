import { type Api } from "grammy";
import { store } from "../store.js";
import { getTrack, TRACK_IDS } from "../tracks/index.js";
import { escapeHtml } from "../format.js";
import type { StoredVacancy, TrackId } from "../types.js";

const RESPONDED_PLUS = new Set(["Responded", "Interview", "Offer", "Rejected"]);

function count(rows: StoredVacancy[], pred: (v: StoredVacancy) => boolean): number {
  return rows.reduce((n, v) => n + (pred(v) ? 1 : 0), 0);
}

/** Топ востребованных навыков по вакансиям недели (spec §13, skill-gap). */
function topSkills(rows: StoredVacancy[], limit = 8): Array<[string, number]> {
  const freq = new Map<string, number>();
  for (const v of rows) {
    for (const s of v.vacancy.keySkills ?? []) {
      const key = s.trim();
      if (key) freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function trackBlock(trackId: TrackId, rows: StoredVacancy[]): string[] {
  const track = getTrack(trackId);
  const out: string[] = [`<b>${escapeHtml(track.title)}</b>`];
  if (!rows.length) {
    out.push("— новых вакансий не было");
    return out;
  }
  const responded = count(rows, (v) => RESPONDED_PLUS.has(v.status));
  const interviews = count(rows, (v) => v.status === "Interview" || v.status === "Offer");
  const offers = count(rows, (v) => v.status === "Offer");
  const convRate = rows.length ? Math.round((responded / rows.length) * 100) : 0;

  out.push(
    `Показано: ${rows.length} · Сохранено: ${count(rows, (v) => v.status === "Saved")} · ` +
      `Откликов: ${responded} · Собеседований: ${interviews} · Офферов: ${offers}`,
  );
  out.push(`Конверсия в отклик: ${convRate}%`);

  const skills = topSkills(rows);
  if (skills.length) {
    out.push("Чаще всего требуют:");
    out.push(skills.map(([s, n]) => `• ${escapeHtml(s)} (${n})`).join("\n"));
  }
  return out;
}

/** Собирает текст еженедельного дайджеста за последние `days` дней. */
export function buildDigest(days = 7): string {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const recent = store.vacanciesSince(since);

  const lines: string[] = [`<b>📊 Дайджест за ${days} дн.</b>`];
  if (!recent.length) {
    lines.push("");
    lines.push("За период новых вакансий не было.");
    return lines.join("\n");
  }
  lines.push(`Всего вакансий: <b>${recent.length}</b>`);
  for (const t of TRACK_IDS) {
    lines.push("");
    lines.push(...trackBlock(t, recent.filter((v) => v.track === t)));
  }
  return lines.join("\n");
}

/** Постит дайджест в топик «Аналитика» (fallback: General группы). */
export async function postDigest(api: Api, days = 7): Promise<boolean> {
  const groupId = store.meta.groupId;
  if (!groupId) {
    console.warn("[digest] группа не привязана — пропуск");
    return false;
  }
  const threadId = store.threadId("digest");
  await api
    .sendMessage(groupId, buildDigest(days), {
      message_thread_id: threadId,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
    .catch((e) => {
      console.error("[digest] send failed:", e?.message ?? e);
      return undefined;
    });
  return true;
}
