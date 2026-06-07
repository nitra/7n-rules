---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:31:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Шрифт у Zed markdown preview: обмеження ізольованого контролю

## Context and Problem Statement
Користувач хотів зменшити розмір шрифту у панелі markdown preview в Zed так, щоб він відповідав розміру шрифту в терміналі нижче. Паралельно — прибрати «жирність» тексту у preview.

## Considered Options
* Змінити `markdown.preview.fontSize` у Cursor `settings.json` (помилковий редактор)
* Зменшити `ui_font_size` у Zed `settings.json`
* Зменшити `buffer_font_weight` у Zed `settings.json`
* Тимчасовий зум клавішею `Cmd -` у фокусі preview-панелі

## Decision Outcome
Chosen option: "Зменшити `buffer_font_weight` до `400`", because це єдина зміна, яку можна застосувати ізольовано (впливає на редактор та rendering), не зачіпаючи розміри sidebar, тайтлбарів та інших UI-елементів. Зміна `ui_font_size` була відхилена після тесту: значення `14` зменшило весь інтерфейс крім терміналу, термінал має власний `terminal.font_size`.

### Consequences
* Good, because `buffer_font_weight: 400` (замість `500`) прибирає зайву «жирність» шрифту без побічних ефектів на масштаб UI.
* Bad, because розмір шрифту у markdown preview залишається незмінним: у Zed немає ізольованого налаштування font size для preview-панелі — preview наслідує `ui_font_size`, а не `buffer_font_size`; CSS injection через `settings.json` не підтримується.

## More Information
- Файл змін: `/Users/vitaliytv/.config/zed/settings.json`
- Змінено: `buffer_font_weight: 500` → `buffer_font_weight: 400`
- Відхилено та відкочено: `ui_font_size: 21` → `14` → `21`
- Скасовано як нерелевантне: `markdown.preview.fontSize: 11` у `/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json` (неправильний редактор)
- Workaround без збереження між сесіями: `Cmd -` у фокусі preview-панелі Zed
