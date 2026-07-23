import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { applyOverride } from "./settings.js";
import { nowIso } from "./util.js";
import type { Status, StoredVacancy, TrackConfig, TrackId } from "./types.js";

interface Meta {
  /** Единый чат для постинга карточек/писем/аналитики (личка владельца). */
  chatId?: number;
  /** Владелец, пойманный в рантайме (fallback к config.ownerId, если env пуст). */
  ownerId?: number;
  /** Доп. источники — публичные Telegram-каналы (юзернеймы без @). */
  tgChannels?: string[];
  /** Переопределения настроек из /admin (ключ поля config → значение-строка). */
  settings?: Record<string, string>;
  /** Накопленная статистика токенов по задачам (score/letter) — для оценки цены в /admin. */
  aiUsage?: Partial<Record<string, { promptSum: number; completionSum: number; n: number }>>;
}

interface DB {
  meta: Meta;
  tracks: Partial<Record<TrackId, TrackConfig>>; // треки, собранные в онбординге
  seen: Partial<Record<TrackId, string[]>>; // дедуп по трекам
  vacancies: Record<string, StoredVacancy>;
}

function emptyDB(): DB {
  return { meta: {}, tracks: {}, seen: {}, vacancies: {} };
}

/**
 * Персистентное JSON-хранилище с атомарной записью.
 * Личный инструмент → один владелец, без юзеров/подписок.
 */
class Store {
  private db: DB = emptyDB();
  private file = path.join(config.dataDir, "store.json");
  private chain: Promise<void> = Promise.resolve();
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<DB>;
      const base = emptyDB();
      const pm: any = parsed.meta ?? {};
      this.db = {
        // миграция: старое meta.groupId → chatId
        meta: { ...base.meta, ...pm, chatId: pm.chatId ?? pm.groupId },
        tracks: parsed.tracks ?? {},
        seen: parsed.seen ?? {},
        vacancies: parsed.vacancies ?? {},
      };
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
      await this.flush();
    }
    // Применяем сохранённые /admin-переопределения поверх config (ключи, модели…).
    for (const [k, v] of Object.entries(this.db.meta.settings ?? {})) applyOverride(k, v);
    this.loaded = true;
  }

  private flush(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const tmp = this.file + ".tmp";
        await fs.writeFile(tmp, JSON.stringify(this.db, null, 2), "utf8");
        await fs.rename(tmp, this.file);
      })
      .catch((err) => console.error("[store] flush error:", err));
    return this.chain;
  }

  // ---- Чат для постинга / владелец ----

  get meta(): Meta {
    return this.db.meta;
  }

  /** Задать единый чат для постинга (личка владельца). */
  async setChat(chatId: number): Promise<void> {
    this.db.meta.chatId = chatId;
    await this.flush();
  }

  /** Запомнить владельца, если ещё не задан. */
  async setOwner(id: number): Promise<void> {
    this.db.meta.ownerId = id;
    await this.flush();
  }

  // ---- Треки (собираются в онбординге) ----

  getTrack(id: TrackId): TrackConfig | undefined {
    return this.db.tracks[id];
  }

  /** Настроенные треки в порядке добавления (A, B, C…). */
  tracks(): TrackConfig[] {
    return Object.values(this.db.tracks).filter((t): t is TrackConfig => Boolean(t));
  }

  hasTracks(): boolean {
    return this.tracks().length > 0;
  }

  /** Следующий свободный id трека: A, B, C, … */
  nextTrackId(): TrackId {
    for (let i = 0; i < 26; i++) {
      const id = String.fromCharCode(65 + i);
      if (!this.db.tracks[id]) return id;
    }
    return `T${Date.now()}`;
  }

  async setTrack(cfg: TrackConfig): Promise<void> {
    this.db.tracks[cfg.id] = cfg;
    await this.flush();
  }

  async removeTrack(id: TrackId): Promise<void> {
    delete this.db.tracks[id];
    delete this.db.seen[id];
    await this.flush();
  }

  // ---- Доп. источники: Telegram-каналы ----

  channels(): string[] {
    return this.db.meta.tgChannels ?? [];
  }

  async addChannel(name: string): Promise<void> {
    const n = name.trim().replace(/^@/, "").toLowerCase();
    if (!n) return;
    const list = this.db.meta.tgChannels ?? [];
    if (!list.includes(n)) list.push(n);
    this.db.meta.tgChannels = list;
    await this.flush();
  }

  async removeChannel(name: string): Promise<void> {
    const n = name.trim().replace(/^@/, "").toLowerCase();
    this.db.meta.tgChannels = (this.db.meta.tgChannels ?? []).filter((c) => c !== n);
    await this.flush();
  }

  // ---- Настройки /admin (переопределения config) ----

  /** Сохранить переопределение и применить его к живому config. */
  async setSetting(key: string, value: string): Promise<void> {
    const map = this.db.meta.settings ?? {};
    map[key] = value;
    this.db.meta.settings = map;
    applyOverride(key, value);
    await this.flush();
  }

  // ---- Статистика токенов по задачам (для оценки цены модели в /admin) ----

  /** Записывает фактические токены одного вызова (из usage ответа API). Копится
   *  скользящей суммой — не блокирует flush остальных операций. */
  recordAiUsage(role: string, promptTokens: number, completionTokens: number): void {
    if (!(promptTokens > 0 || completionTokens > 0)) return;
    const map = this.db.meta.aiUsage ?? {};
    const cur = map[role] ?? { promptSum: 0, completionSum: 0, n: 0 };
    // Скользящее окно (последние ~200 вызовов) — не даём сумме расти бесконечно
    // и не даём старым (иной модели/провайдера) данным доминировать вечно.
    const CAP = 200;
    if (cur.n >= CAP) {
      const scale = (CAP - 1) / CAP;
      cur.promptSum *= scale;
      cur.completionSum *= scale;
      cur.n = CAP - 1;
    }
    cur.promptSum += promptTokens;
    cur.completionSum += completionTokens;
    cur.n += 1;
    map[role] = cur;
    this.db.meta.aiUsage = map;
    void this.flush();
  }

  /** Средние токены на вызов задачи (score/letter) по накопленной статистике. */
  aiStat(role: string): { p: number; c: number; n: number } | undefined {
    const cur = this.db.meta.aiUsage?.[role];
    if (!cur || cur.n <= 0) return undefined;
    return { p: Math.round(cur.promptSum / cur.n), c: Math.round(cur.completionSum / cur.n), n: cur.n };
  }

  // ---- Дедуп ----

  isSeen(track: TrackId, id: string): boolean {
    return (this.db.seen[track] ?? []).includes(id);
  }

  seenSet(track: TrackId): Set<string> {
    return new Set(this.db.seen[track] ?? []);
  }

  markSeen(track: TrackId, ids: string[], cap = 2000): void {
    const set = new Set(this.db.seen[track] ?? []);
    for (const id of ids) set.add(id);
    let arr = Array.from(set);
    if (arr.length > cap) arr = arr.slice(arr.length - cap);
    this.db.seen[track] = arr;
  }

  // ---- Вакансии ----

  getVacancy(id: string): StoredVacancy | undefined {
    return this.db.vacancies[id];
  }

  async upsertVacancy(v: StoredVacancy): Promise<void> {
    this.db.vacancies[v.id] = v;
    await this.flush();
  }

  async setStatus(id: string, status: Status): Promise<StoredVacancy | undefined> {
    const v = this.db.vacancies[id];
    if (!v) return undefined;
    v.status = status;
    await this.flush();
    return v;
  }

  /** Сохранить текст письма и (опц.) координаты сообщения-черновика. */
  async setLetter(
    id: string,
    letter: string,
    coords?: { messageId?: number; threadId?: number },
  ): Promise<StoredVacancy | undefined> {
    const v = this.db.vacancies[id];
    if (!v) return undefined;
    v.letter = letter;
    if (coords?.messageId !== undefined) v.letterMessageId = coords.messageId;
    if (coords?.threadId !== undefined) v.letterThreadId = coords.threadId;
    await this.flush();
    return v;
  }

  allVacancies(): StoredVacancy[] {
    return Object.values(this.db.vacancies);
  }

  /** Вакансии, добавленные за последние N дней (для дайджеста). */
  vacanciesSince(sinceIso: string): StoredVacancy[] {
    return this.allVacancies().filter((v) => v.createdAt >= sinceIso);
  }

  async save(): Promise<void> {
    await this.flush();
  }
}

export const store = new Store();
export { nowIso };
