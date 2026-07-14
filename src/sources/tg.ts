import { fetchText, type JobSource } from "./base.js";
import type { Vacancy } from "../types.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** HTML → плоский текст (теги вон, <br>/блоки → перевод строки, сущности назад). */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Post {
  id: string; // "channel/123"
  text: string;
  url: string;
  date?: string;
}

/** Парсит посты из веб-превью канала t.me/s/<channel>. */
function extractPosts(html: string, channel: string): Post[] {
  const posts: Post[] = [];
  // каждое сообщение — блок с data-post="channel/123"
  const blocks = html.split('class="tgme_widget_message ').slice(1);
  for (const b of blocks) {
    const idm = b.match(/data-post="([^"]+)"/);
    const id = idm?.[1] ?? "";
    const txm = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_(?:footer|reply_markup|meta))/);
    const text = txm ? htmlToText(txm[1]) : "";
    const dm = b.match(/datetime="([^"]+)"/);
    if (id && text.length > 40) {
      posts.push({ id, text, url: `https://t.me/${id}`, date: dm?.[1] });
    }
  }
  return posts;
}

const VAC_MARKERS =
  /вакансия|ваканси|ищем|требуется|нужен в|в команду|з\/п|зарплат|оклад|обязанност|требовани к|условия работ|удалёнк|удаленк|полная занятость|частичная занятость|опыт от|опыт работы|резюме|откликнуть|hh\.ru|график работы|мы предлагаем|что нужно делать|чем предстоит/i;

function looksLikeVacancy(text: string): boolean {
  return VAC_MARKERS.test(text);
}

/** Грубо определяет формат работы по тексту поста (у TG нет структурного поля). */
function detectFormat(text: string): string | undefined {
  const t = text.toLowerCase();
  const remote = /\b(remote|удал[её]нк|удал[её]нн|из дома|out of office|релокац)/.test(t);
  const hybrid = /\b(гибрид|hybrid|частично удал)/.test(t);
  const office = /\b(офис|office|на месте|on-?site|в офисе)/.test(t);
  if (hybrid) return "Гибрид";
  if (remote && !office) return "Удалённо";
  if (remote && office) return "Гибрид/офис";
  if (office) return "В офисе";
  return undefined;
}

function firstLine(text: string): string {
  const line = text.split("\n").map((s) => s.trim()).find((s) => s.length > 3) ?? text;
  return line.replace(/^[#*•\-–—>\s]+/, "").slice(0, 120) || "Вакансия из Telegram";
}

function tokens(keywords: string): string[] {
  return keywords
    .toLowerCase()
    .replace(/\bor\b/gi, " ")
    .split(/[^a-zа-яё0-9+#.]+/i)
    .filter((t) => t.length > 2);
}

/** Источник вакансий из публичного Telegram-канала (веб-превью t.me/s/<channel>). */
export function tgChannelSource(channel: string): JobSource {
  return {
    id: `tg:${channel}`,
    label: `@${channel}`,
    async search(q, { limit }): Promise<Vacancy[]> {
      let html: string;
      try {
        html = await fetchText(`https://t.me/s/${channel}`, { headers: { "User-Agent": UA }, timeoutMs: 15000 });
      } catch {
        return [];
      }
      const posts = extractPosts(html, channel).filter((p) => looksLikeVacancy(p.text));
      // лёгкий пре-фильтр по ключевым словам трека (чтобы не скорить весь канал)
      const kws = tokens(q.keywords);
      const relevant = kws.length
        ? posts.filter((p) => {
            const low = p.text.toLowerCase();
            return kws.some((k) => low.includes(k));
          })
        : posts;
      return relevant.slice(0, limit).map((p): Vacancy => ({
        id: `tg:${p.id}`,
        source: "tg",
        title: firstLine(p.text),
        url: p.url,
        publishedAt: p.date,
        description: p.text,
        workFormat: detectFormat(p.text),
      }));
    },
  };
}
