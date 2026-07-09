/**
 * Локальная проверка поиска + ИИ без Telegram.
 * Запуск:  npm run try:search -- A
 *          npm run try:search -- "product manager"   (произвольные ключевые слова)
 */
import { searchAll } from "../sources/index.js";
import { verifyMany } from "../ai/verify.js";
import { fmtMoney } from "../format.js";
import { config } from "../config.js";
import { TRACKS } from "../tracks/index.js";
import type { SearchQuery, TrackId } from "../types.js";

const arg = process.argv.slice(2).join(" ").trim();
let q: SearchQuery;
if (arg === "A" || arg === "B") {
  q = TRACKS[arg as TrackId].query;
} else {
  q = { keywords: arg || TRACKS.A.query.keywords, areaId: "113", areaName: "Россия" };
}

console.log(`\n🔎 Ищу: "${q.keywords}" (${q.areaName})`);
console.log(`ИИ: ${config.openRouterKey ? "OpenRouter" : "эвристика (нет OPENROUTER_API_KEY)"}\n`);

const raw = await searchAll(q, { limit: 20, periodDays: 14 });
console.log(`Источники вернули ${raw.length} вакансий. Проверяю первые 6…\n`);

const sample = raw.slice(0, 6);
const verdicts = await verifyMany(q, sample);

sample.forEach((v, i) => {
  const vd = verdicts[i];
  console.log(`${vd.score}/100 [${vd.model}]  ${v.title}`);
  console.log(`   ${v.company ?? "—"} · ${v.area ?? "—"} · ${fmtMoney(v.salaryFrom, v.salaryTo, v.currency)}`);
  console.log(`   ${vd.reason}`);
  console.log(`   ${v.url}\n`);
});

process.exit(0);
