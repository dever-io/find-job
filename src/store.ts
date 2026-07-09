import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { nowIso } from "./util.js";
import type { Status, StoredVacancy, TrackId } from "./types.js";

/** Куда бот постит: id супергруппы и message_thread_id топиков. */
export type TopicKey = TrackId | "inbox" | "digest";

interface Meta {
  groupId?: number;
  topics: Partial<Record<TopicKey, number>>;
}

interface DB {
  meta: Meta;
  seen: Partial<Record<TrackId, string[]>>; // дедуп по трекам
  vacancies: Record<string, StoredVacancy>;
}

function emptyDB(): DB {
  return { meta: { topics: {} }, seen: {}, vacancies: {} };
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
      this.db = {
        meta: { ...base.meta, ...parsed.meta, topics: { ...base.meta.topics, ...parsed.meta?.topics } },
        seen: parsed.seen ?? {},
        vacancies: parsed.vacancies ?? {},
      };
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
      await this.flush();
    }
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

  // ---- Привязка группы/топиков ----

  get meta(): Meta {
    return this.db.meta;
  }

  async bindTopic(key: TopicKey, groupId: number, threadId?: number): Promise<void> {
    this.db.meta.groupId = groupId;
    if (threadId !== undefined) this.db.meta.topics[key] = threadId;
    await this.flush();
  }

  threadId(key: TopicKey): number | undefined {
    return this.db.meta.topics[key];
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
