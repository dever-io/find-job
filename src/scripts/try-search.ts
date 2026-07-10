/**
 * Локальная проверка поиска + ИИ без Telegram.
 * Запуск:  npm run try:search -- A
 *          npm run try:search -- B
 * (произвольные ключевые слова прогоняются через профиль трека A)
 */
import { searchAll, enrichDetails } from "../sources/index.js";
import { analyzeMany } from "../ai/analyze.js";
import { fmtMoney } from "../format.js";
import { config } from "../config.js";
import { TRACKS } from "../tracks/index.js";
import type { TrackConfig, TrackId } from "../types.js";

const arg = process.argv.slice(2).join(" ").trim();
let track: TrackConfig;
if (arg === "A" || arg === "B") {
  track = TRACKS[arg as TrackId];
} else if (arg) {
  track = { ...TRACKS.A, query: { ...TRACKS.A.query, keywords: arg } };
} else {
  track = TRACKS.A;
}

console.log(`\n🔎 ${track.title}`);
console.log(`Ищу: "${track.query.keywords}" (${track.query.areaName})`);
console.log(`ИИ: ${config.openRouterKey ? "OpenRouter (взвешенный скор)" : "эвристика (нет OPENROUTER_API_KEY)"}\n`);

const raw = await searchAll(track.query, { limit: 20, periodDays: 14 });
console.log(`Источники вернули ${raw.length} вакансий. Разбираю первые 6…\n`);

const sample = raw.slice(0, 6);
await enrichDetails(sample);
const verdicts = await analyzeMany(track, sample);

sample.forEach((v, i) => {
  const vd = verdicts[i];
  console.log(`${vd.score}/100 [${vd.model}]  ${v.title}`);
  console.log(`   ${v.company ?? "—"} · ${v.area ?? "—"} · ${fmtMoney(v.salaryFrom, v.salaryTo, v.currency)}`);
  if (vd.matchReasons?.length) console.log(`   ✅ ${vd.matchReasons.join("; ")}`);
  if (vd.mismatchReasons?.length) console.log(`   ⚠️ ${vd.mismatchReasons.join("; ")}`);
  console.log(`   ${v.url}\n`);
});

process.exit(0);
