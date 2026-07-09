import { InlineKeyboard } from "grammy";

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔎 Настроить поиск", "menu:search")
    .row()
    .text("📊 Мой статус", "menu:status")
    .text("⭐ Тарифы", "menu:plan")
    .row()
    .text("❓ Как это работает", "menu:help");
}

export function areaKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🇷🇺 Вся Россия", "w:area:113")
    .row()
    .text("Москва", "w:area:1")
    .text("Санкт-Петербург", "w:area:2")
    .row()
    .text("🏙 Другой город", "w:area:custom");
}

export function salaryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Не важно", "w:sal:0")
    .row()
    .text("от 80 000", "w:sal:80000")
    .text("от 120 000", "w:sal:120000")
    .row()
    .text("от 180 000", "w:sal:180000")
    .text("от 250 000", "w:sal:250000");
}

export function experienceKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Не важно", "w:exp:any")
    .text("Без опыта", "w:exp:noExperience")
    .row()
    .text("1–3 года", "w:exp:between1And3")
    .row()
    .text("3–6 лет", "w:exp:between3And6")
    .text("6+ лет", "w:exp:moreThan6");
}

export function scheduleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Не важно", "w:sch:any")
    .text("🏠 Удалёнка", "w:sch:remote")
    .row()
    .text("🏢 Офис", "w:sch:fullDay")
    .text("🕐 Гибкий", "w:sch:flexible");
}

export function extraKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("⏭ Пропустить", "w:extra:skip");
}
