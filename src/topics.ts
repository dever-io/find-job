import { type Api } from "grammy";
import { store, type TopicKey } from "./store.js";

/**
 * Создаёт и привязывает темы для настроенных треков + «Отклики» и «Аналитика».
 * Идемпотентно: уже привязанные пропускает. Возвращает строки отчёта.
 * Работает в личке с ботом (Threaded Mode) и в супергруппе с Темами.
 */
export async function ensureTopics(api: Api, chatId: number): Promise<string[]> {
  const items: Array<{ key: TopicKey; name: string }> = [
    ...store.tracks().map((t) => ({ key: t.id as TopicKey, name: t.title })),
    { key: "inbox", name: "Отклики" },
    { key: "digest", name: "Аналитика" },
  ];
  const report: string[] = [];
  for (const it of items) {
    if (store.threadId(it.key) !== undefined) {
      report.push(`• ${it.name} — уже есть`);
      continue;
    }
    try {
      const topic = await api.createForumTopic(chatId, it.name);
      await store.bindTopic(it.key, chatId, topic.message_thread_id);
      report.push(`• ${it.name} ✅`);
    } catch (e: any) {
      report.push(`• ${it.name} — ошибка: ${e?.description ?? e?.message ?? e}`);
    }
  }
  return report;
}
