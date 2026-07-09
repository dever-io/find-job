import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { nowIso } from "./util.js";
import { defaultSubscription, type UserRecord } from "./types.js";

export interface PaymentRecord {
  chargeId: string;
  userId: number;
  stars: number;
  plan: string;
  isRecurring: boolean;
  at: string;
}

interface DB {
  users: Record<string, UserRecord>;
  payments: PaymentRecord[];
}

/**
 * Простое персистентное JSON-хранилище с атомарной записью.
 * Достаточно для MVP; интерфейс легко заменить на Redis/Postgres.
 */
class Store {
  private db: DB = { users: {}, payments: [] };
  private file = path.join(config.dataDir, "store.json");
  private chain: Promise<void> = Promise.resolve();
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<DB>;
      this.db = { users: parsed.users ?? {}, payments: parsed.payments ?? [] };
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

  get(userId: number): UserRecord | undefined {
    return this.db.users[String(userId)];
  }

  /** Гарантирует наличие записи пользователя, обновляя контактные поля. */
  ensure(u: { id: number; chatId: number; username?: string; firstName?: string }): UserRecord {
    const key = String(u.id);
    let rec = this.db.users[key];
    if (!rec) {
      rec = {
        id: u.id,
        chatId: u.chatId,
        username: u.username,
        firstName: u.firstName,
        createdAt: nowIso(),
        subscription: defaultSubscription(),
        seenVacancyIds: [],
      };
      this.db.users[key] = rec;
      void this.flush();
    } else {
      rec.chatId = u.chatId;
      if (u.username) rec.username = u.username;
      if (u.firstName) rec.firstName = u.firstName;
    }
    return rec;
  }

  async save(rec: UserRecord): Promise<void> {
    this.db.users[String(rec.id)] = rec;
    await this.flush();
  }

  all(): UserRecord[] {
    return Object.values(this.db.users);
  }

  async addPayment(rec: PaymentRecord): Promise<void> {
    this.db.payments.push(rec);
    await this.flush();
  }

  /** Помечает вакансии как показанные (с ограничением размера истории). */
  markSeen(rec: UserRecord, ids: string[], cap = 1000): void {
    const set = new Set(rec.seenVacancyIds);
    for (const id of ids) set.add(id);
    let arr = Array.from(set);
    if (arr.length > cap) arr = arr.slice(arr.length - cap);
    rec.seenVacancyIds = arr;
  }
}

export const store = new Store();
