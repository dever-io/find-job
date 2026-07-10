import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { config } from "./config.js";

/** Скачивает файл Telegram по file_path (из getFile) в буфер. */
export async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${config.botToken}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать файл: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Извлекает текст из PDF-буфера. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return (data.text || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Валидна ли строка как текст резюме (защита от «привет»). */
export function looksLikeResume(text: string): boolean {
  return text.trim().length >= 120;
}
