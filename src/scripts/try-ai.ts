/** Проверка ИИ-верификации на живой вакансии: Про (qwen3-32b) и Базовый. */
import { searchAll } from "../sources/index.js";
import { verifyOne } from "../ai/verify.js";
import type { SearchQuery } from "../types.js";

const q: SearchQuery = { keywords: "python разработчик", areaId: "113", areaName: "Россия" };
const raw = await searchAll(q, { limit: 5, periodDays: 30 });
if (!raw.length) {
  console.log("Источники ничего не вернули.");
  process.exit(0);
}
const v = raw[0];
console.log(`Вакансия: ${v.title} — ${v.company ?? "—"}\n`);

for (const plan of ["pro", "basic"] as const) {
  const r = await verifyOne(q, v, plan);
  console.log(`[${plan}] модель=${r.model} score=${r.score} relevant=${r.relevant}`);
  console.log(`        reason: ${r.reason}\n`);
}
process.exit(0);
