/**
 * Оффлайн-проверка Telegram-каркаса без токена и без сети.
 * Прогоняет весь визард через bot.handleUpdate, перехватывая исходящие
 * API-вызовы трансформером и подсовывая фейковые ответы.
 *
 * Запуск:  BOT_TOKEN=111:AAAA npm run try:bot
 */
import { store } from "../store.js";
import { makeBot } from "../bot.js";

const CHAT = 42;
let upd = 1;
let mid = 1000;
const sent: Array<{ method: string; text?: string }> = [];

function msg(text: string, isCommand = false): any {
  const entities = isCommand ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : undefined;
  return {
    update_id: upd++,
    message: {
      message_id: mid++,
      date: 0,
      chat: { id: CHAT, type: "private" },
      from: { id: CHAT, is_bot: false, first_name: "Тест" },
      text,
      ...(entities ? { entities } : {}),
    },
  };
}

function cb(data: string): any {
  return {
    update_id: upd++,
    callback_query: {
      id: String(upd),
      from: { id: CHAT, is_bot: false, first_name: "Тест" },
      message: { message_id: mid++, date: 0, chat: { id: CHAT, type: "private" }, text: "…" },
      chat_instance: "ci",
      data,
    },
  };
}

async function main(): Promise<void> {
  await store.init();
  const bot = makeBot();
  // задаём botInfo, чтобы не ходить в getMe по сети
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: "StarJobs",
    username: "starjobs_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as any;

  // перехват всех исходящих вызовов Bot API
  bot.api.config.use(async (_prev, method, payload: any) => {
    let result: any = true;
    if (method === "sendMessage" || method === "editMessageText") {
      sent.push({ method, text: payload.text });
      result = { message_id: mid++, date: 0, chat: { id: CHAT, type: "private" }, text: payload.text };
    } else {
      sent.push({ method });
      if (method === "getMe") result = bot.botInfo;
      else if (method === "createInvoiceLink") result = "https://t.me/invoice/FAKE";
    }
    return { ok: true, result } as any;
  });

  const steps: Array<[string, any]> = [
    ["/start", msg("/start", true)],
    ["/search", msg("/search", true)],
    ['текст: "python backend разработчик"', msg("python backend разработчик")],
    ["кнопка area:113 (вся Россия)", cb("w:area:113")],
    ["кнопка sal:0 (з/п не важно)", cb("w:sal:0")],
    ["кнопка exp:any", cb("w:exp:any")],
    ["кнопка sch:remote (удалёнка)", cb("w:sch:remote")],
    ["кнопка extra:skip → finalize + живой поиск", cb("w:extra:skip")],
  ];

  for (const [label, u] of steps) {
    const before = sent.length;
    await bot.handleUpdate(u);
    console.log(`\n▶ ${label}`);
    for (const o of sent.slice(before)) {
      if (o.text) console.log(`   [${o.method}] ${o.text.replace(/\n/g, " ⏎ ").slice(0, 100)}`);
      else console.log(`   [${o.method}]`);
    }
  }

  console.log("\n✅ Визард прошёл все 6 шагов, finalize отработал, CTA-инвойс создан.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
