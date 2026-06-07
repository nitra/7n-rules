---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:26:53+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Регулювання шрифту markdown preview у Zed через `ui_font_size`

## Context and Problem Statement
Користувач хотів зменшити розмір шрифту у вікні markdown preview у Zed до рівня шрифту терміналу нижче. Незважаючи на те що і `buffer_font_size`, і `terminal.font_size` були встановлені на 17, текст у preview візуально відображався значно крупніше.

## Considered Options
* Зменшити `buffer_font_size` — вплинуло б на весь текстовий редактор
* Зменшити `ui_font_size` — впливає на весь інтерфейс Zed, включно з markdown preview
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Зменшити `ui_font_size`", because markdown preview у Zed рендериться відповідно до `ui_font_size` (було 21), а не `buffer_font_size` (17); зниження до 14 наближає розмір preview до розміру терміналу.

### Consequences
* Good, because transcript фіксує очікувану користь: preview font наближається до розміру терміналу.
* Bad, because `ui_font_size` є глобальним параметром і зменшує шрифт у всіх елементах інтерфейсу Zed, а не лише в markdown preview.

## More Information
- Файл змінено: `/Users/vitaliytv/.config/zed/settings.json`
- Зміна: `"ui_font_size": 21` → `"ui_font_size": 14`
- До виявлення редактора (Zed) асистент помилково додав `"markdown.preview.fontSize": 11` у `/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json`; спроба відкату цієї зміни завершилась помилкою (`File has been modified since read`) і зміна лишилась у файлі Cursor.
- Вміст preview включав YAML frontmatter (`session:`, `captured:`, `transcript:`), який Zed рендерить як звичайний текст, що додатково збільшувало видимий розмір блоку.
