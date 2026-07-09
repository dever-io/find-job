import { InlineKeyboard, type Api } from "grammy";
import { store } from "../store.js";
import { findMatches } from "./pipeline.js";
import { vacancyCard } from "../format.js";
import { todayStr, sleep } from "../util.js";
import type { UserRecord } from "../types.js";

/** Ежедневная выдача одному пользователю (списаниями рулит Telegram). */
export async function runDailyForUser(api: Api, rec: UserRecord): Promise<void> {
  const s = rec.subscription;
  const active = s.active && (!s.expiresAt || s.expiresAt * 1000 > Date.now());

  if (!active) {
    if (s.active) {
      // подписка истекла и не продлилась
      s.active = false;
      await store.save(rec);
      await api
        .sendMessage(rec.chatId, "⌛️ Подписка закончилась. Продли её в /plan, чтобы снова получать вакансии каждый день.")
        .catch(() => {});
    }
    return;
  }

  if (!rec.query) return;

  const today = todayStr();
  if (rec.lastDeliveryDate === today) return; // уже доставили сегодня

  const matches = await findMatches(rec.query, s.plan, {
    excludeIds: new Set(rec.seenVacancyIds),
    periodDays: 3,
  });

  rec.lastDeliveryDate = today;
  store.markSeen(rec, matches.map((m) => m.vacancy.id));
  await store.save(rec);

  if (!matches.length) {
    await api
      .sendMessage(
        rec.chatId,
        `🌅 Доброе утро! Новых подходящих вакансий по запросу «${rec.query.keywords}» пока нет. Как появятся — сразу пришлю.`,
      )
      .catch(() => {});
    return;
  }

  await api
    .sendMessage(rec.chatId, `🌅 Доброе утро! Нашёл <b>${matches.length}</b> новых вакансий для тебя:`, {
      parse_mode: "HTML",
    })
    .catch(() => {});

  for (const m of matches) {
    await api
      .sendMessage(rec.chatId, vacancyCard(m.vacancy, m.verdict), {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().url("🔗 Открыть вакансию", m.vacancy.url),
        link_preview_options: { is_disabled: true },
      })
      .catch(() => {});
    await sleep(120); // мягкий троттлинг под лимиты Telegram
  }
}

/** Прогон по всем пользователям — вызывается кроном раз в сутки. */
export async function runDailyForAllUsers(api: Api): Promise<void> {
  const users = store.all();
  console.log(`[daily] running for ${users.length} users`);
  for (const rec of users) {
    try {
      await runDailyForUser(api, rec);
    } catch (e) {
      console.error(`[daily] user ${rec.id} failed`, e);
    }
  }
  console.log("[daily] done");
}
