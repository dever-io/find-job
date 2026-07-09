# План реализации — AI Career Agent (на базе StarJobs)

**Статус:** Draft для согласования
**Источник требований:** [`AI_Career_Agent_Spec_v2.md`](AI_Career_Agent_Spec_v2.md)
**Решения владельца (зафиксированы):**
1. UI — **один супер-чат, разделение на топики** (Telegram Forum Topics), не два бота.
2. Порядок — **сначала полный план**, затем код.
3. Кодовая база — **этот репозиторий переписывается свободно**; деплой автоматический по push в `main`.

---

## 0. Сверка с текущим кодом: что остаётся / меняется / удаляется

| Модуль | Сейчас | Действие |
|---|---|---|
| `sources/hh.ts`, `trudvsem.ts`, `base.ts`, `index.ts` | Поиск по фильтрам, отдаёт `snippet` | **Оставляем**, добавляем добор деталей вакансии (`GET /vacancies/{id}`) |
| `ai/openrouter.ts` | Один chat-клиент | **Оставляем**, добавляем вторую «сильную» модель для писем |
| `ai/verify.ts` | `{relevant, score, reason}` | **Заменяем** на `ai/analyze.ts` — полный JSON + взвешенный скоринг по треку |
| `jobs/pipeline.ts` | search→verify→filter | **Переписываем** под треки + добор деталей + дедуп |
| `jobs/daily.ts` | Рассылка по юзерам | **Переписываем** под треки → постинг в топики |
| `handlers/search.ts` | Визард поиска на юзера | **Удаляем** визард, заменяем на конфиг треков + `/bind` |
| `handlers/payments.ts`, `subscription.ts` | Telegram Stars, подписки | **Удаляем полностью** |
| `handlers/start.ts` | Приветствие/меню | **Упрощаем** под личный инструмент |
| `config.ts` (`TARIFFS`, `SUBSCRIPTION_PERIOD`, `Plan`) | Тарифы, период подписки | **Удаляем** биллинг; добавляем OWNER/группа/топики/треки |
| `types.ts` (`SubscriptionState`, `UserRecord`, `Plan`) | Модель юзера+подписки | **Переписываем** под owner+track+vacancy+application |
| `store.ts` (`users`, `payments`) | JSON, юзеры и платежи | **Переписываем** схему: tracks, vacancies, applications |
| `format.ts`, `ui.ts` | Карточки/клавиатуры | **Расширяем** под богатую карточку + кнопки действий |
| `bot.ts`, `index.ts`, `toolkit.ts` | Сборка бота, крон | **Правим**: owner-guard, новые команды, крон дайджеста |

---

## 1. Целевая архитектура

Один владелец (`OWNER_ID`), одна супергруппа с включёнными **Темами**, бот — админ группы с **выключенным** privacy mode (чтобы видеть текстовые правки писем).

```
Telegram супергруппа (Forum)
├── Топик «Track A — Проекты/продакшн»   ← карточки трека A
├── Топик «Track B — IT PM/PdM»           ← карточки трека B
├── Топик «Отклики / переписка»           ← черновики писем, ответы (V2)
└── Топик «Аналитика»                      ← еженедельный дайджест
        ▲
        │ message_thread_id
┌───────┴───────────────────────────────────────────┐
│                     Ядро (общее)                    │
│  sources/    — hh (поиск + детали), trudvsem        │
│  ai/         — analyze (скоринг), letter (письма)   │
│  jobs/       — pipeline (поиск→детали→скоринг→отбор) │
│                digest (еженедельная аналитика)       │
│  tracks/     — конфиг двух треков (фильтры, веса,    │
│                резюме-профиль, topic_id)             │
│  store/      — vacancies, applications, meta         │
└─────────────────────────────────────────────────────┘
```

Привязка топиков — командой `/bind <track>` **внутри нужного топика**: бот берёт `chat.id` и `message_thread_id` из апдейта и сохраняет в store. Никаких ручных ID.

---

## 2. Модель данных (новая схема store)

```ts
interface TrackConfig {
  id: "A" | "B";
  title: string;
  query: SearchQuery;          // keywords + фильтры hh
  weights: ScoreWeights;       // веса факторов (spec §7)
  resumeProfile: string;       // текст базового резюме трека
  threadId?: number;           // message_thread_id топика (из /bind)
  transferPrompt?: string;     // карта переноса опыта (трек B, spec §5)
}

interface AnalyzedVacancy {
  id: string;                  // "hh:12345"
  track: "A" | "B";
  raw: Vacancy;                // нормализованная вакансия
  fields: {                    // извлечено LLM (spec §7)
    company?: string; salary?: string; region?: string; remote?: boolean;
    stack: string[]; requirements: string[]; responsibilities: string[];
    experienceRequired?: string; englishLevel?: string;
  };
  matchScore: number;          // 0..100 взвешенный
  matchReasons: string[];
  mismatchReasons: string[];
  hot: boolean;                // свежая + мало откликов + высокий скор
  status: Status;              // см. §6
  cardMessageId?: number;      // для обновления карточки по кнопкам
  createdAt: string;
}

interface Application {
  vacancyId: string;
  letter: string;              // финальный текст письма
  history: { at: string; status: Status }[];
  updatedAt: string;
}

type Status = "Viewed" | "Saved" | "Ignored" | "Responded"
            | "Interview" | "Offer" | "Rejected";

interface DB {
  meta: { boundGroupId?: number; topics: Record<"A"|"B"|"inbox"|"digest", number|undefined> };
  vacancies: Record<string, AnalyzedVacancy>;
  applications: Record<string, Application>;
}
```

Дедуп — по ключу `vacancies[id]`: если вакансия уже в store, повторно не постим.

---

## 3. Изменения конфига (`.env`)

Добавляем:
```
OWNER_ID=              # твой Telegram user id (единственный, кому отвечает бот)
LETTER_MODEL=          # сильная модель для писем (напр. anthropic/claude-sonnet)
```
Удаляем: `BASIC_PRICE_STARS`, `PRO_PRICE_STARS` и всё про подписки.
Треки (keywords, фильтры, веса, резюме) — в коде `tracks/` с возможностью правки; `GROUP_CHAT_ID`/topic id — заполняются автоматически через `/bind`.

`HH_API_BASE` (RU-прокси) и `OPENROUTER_API_KEY` — остаются критичными для прода (см. §9).

---

## 4. Фазы (каждая — самостоятельно рабочий инкремент)

### Фаза 0 — Каркас: снести биллинг, ввести owner + треки + топики
- Удалить `payments.ts`, `subscription.ts`, тарифы, подписки из `config/types/store`.
- Owner-guard в `bot.ts` (реагируем только на `OWNER_ID`).
- Новая схема store; команды: `/bind`, `/run`, `/status`, `/help`.
- `daily.ts` → `runTrack(track)`: постит карточки (пока в старом формате) в топик трека.
- **Готово, когда:** `/bind` в двух топиках привязывает их, `/run` кладёт вакансии в оба топика.

### Фаза 1 — Два трек-профиля + полный AI-скоринг
- `tracks/`: конфиги A и B (фильтры + веса + резюме + transferPrompt B из spec §5).
- `sources/hh.ts`: добор `GET /vacancies/{id}` (description, key_skills, experience…).
- `ai/analyze.ts`: полный JSON (spec §7) + взвешенный `matchScore` по весам трека.
- **Готово, когда:** карточка показывает `matchScore`, match/mismatch-причины; веса A≠B.

### Фаза 2 — Богатая карточка + кнопки действий + «горячие»
- `format.ts` под spec §9; кнопки `👍 Откликнуться / ❌ / ⭐ / 📄`.
- Метка 🔥 (свежая + высокий скор) → постим сразу, вне расписания.
- Callback-хендлеры меняют `status` и обновляют карточку.
- **Готово, когда:** кнопки меняют статус в store и вид карточки.

### Фаза 3 — Генерация сопроводительного письма + согласование
- `ai/letter.ts` на `LETTER_MODEL` (не free-tier).
- `👍` → черновик письма в топик «Отклики» с кнопками `Отправить / Короче / Официальнее / Редактировать`.
- Текстовая правка (владелец пишет сообщение — бот видит благодаря выкл. privacy).
- **Готово, когда:** письмо генерится, переписывается кнопками и правится текстом.

### Фаза 4 — Полуавтоматический отклик
- По `Отправить`: ссылка на отклик HH + готовый текст письма для вставки; статус → `Responded`.
- Полный авто (HH OAuth `negotiations`) — вынесен в отдельный spike (§9), в MVP не входит.

### Фаза 5 — История и статусы
- Таймлайн `Viewed → Responded → Interview → Offer/Rejected/Ignored`.
- `/status` — воронка по трекам.

### Фаза 6 — Еженедельный дайджест (понедельник) + skill-gap
- Крон (пн) в топик «Аналитика»: просмотрено/откликов/ответов/собеседований.
- Skill-gap для трека B — частотность требований из проанализированных за неделю вакансий (spec §13).

### Фаза 7 — Профили резюме
- `resume_track_a` / `resume_track_b` (текст/PDF) в store; используются в промпте письма.
- Точечная адаптация под вакансию — генерацией в моменте, с подтверждением.

### V2 (после MVP) — Переписка с работодателями
- Чтение входящих HH `negotiations` требует OAuth-приложения HH → отдельный spike, не в MVP (spec §10, §16.3).

---

## 5. Порядок и зависимости

```
Фаза 0 (каркас) ─┬─> Фаза 1 (скоринг) ─> Фаза 2 (карточка/кнопки) ─┬─> Фаза 3 (письма) ─> Фаза 4 (отклик)
                 │                                                  └─> Фаза 5 (статусы) ─> Фаза 6 (дайджест)
                 └────────────────────────────────────────────────────> Фаза 7 (резюме, параллельно с 3+)
```
MVP по spec §17 закрывается фазами 0–7. V2 (переписка) — после.

---

## 6. Открытые вопросы к владельцу — СТАТУС

1. **Настройка группы:** ✅ владелец создаст супергруппу с «Темами», добавит бота админом, выключит privacy mode. Топики: A, B, «Отклики», «Аналитика».
2. **Ключи на сервере:** ✅ деплой на **Fly.io**, env хранятся как Fly/GitHub secrets. Владелец предоставил Fly deploy-токен (→ в GitHub Secrets `FLY_API_TOKEN`, не в код; после настройки перевыпустить).
3. **RU-гео для HH:** 🔶 на владельце. Fly не в РФ → нужен RU-прокси в `HH_API_BASE`.
4. **Модель для писем (`LETTER_MODEL`):** ✅ DeepSeek («V4 Pro») через OpenRouter — точный slug подтвердить перед вайрингом Фазы 3.
5. **Резюме:** 🔶 есть только одно — под трек A (продакшн, PDF получен). Резюме трека B **генерируем** из него по карте переноса опыта (spec §5).
6. **HH OAuth (negotiations):** ⏳ решение отложено; в MVP полуавто-отклик, полный авто/переписка — V2.

### ⚠️ Обнаружено при сверке
Деплой-инфры в репо **нет** (`Dockerfile`, `fly.toml`, `.github/workflows` отсутствуют — «готовый workflow» относится к оригинальному StarJobs, не к этому репо). Нужно **создать**: `Dockerfile` + `fly.toml` + `.github/workflows/fly-deploy.yml`, прописать `FLY_API_TOKEN` в GitHub Secrets. Добавлено как задача деплой-фазы.

---

## 7. Допущения по деплою

- Push в `main` → авто-деплой (workflow на сервере готов). Билд: `npm run build`, запуск: `npm start`.
- Данные (`data/store.json`) должны лежать на **персистентном** диске сервера, иначе история/статусы теряются при рестарте.
- Секреты — только в env сервера, в репозиторий не коммитятся (`.env` уже в `.gitignore`).
```
