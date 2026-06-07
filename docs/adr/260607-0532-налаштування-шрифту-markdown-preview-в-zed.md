---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:32:34+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Налаштування шрифту markdown preview в Zed

## Context and Problem Statement
Шрифт у панелі markdown preview у Zed виглядав значно крупнішим і жирнішим, ніж у вбудованому терміналі нижче. Користувач хотів вирівняти їх до одного візуального розміру.

## Considered Options
* Змінити `markdown.preview.fontSize` у Cursor `settings.json`
* Змінити `ui_font_size` у Zed `settings.json`
* Змінити `buffer_font_size` у Zed `settings.json`
* Використати `Cmd -` (локальний zoom панелі, не зберігається між сесіями)
* Змінити `buffer_font_weight` у Zed `settings.json`

## Decision Outcome
Chosen option: "Змінити `buffer_font_weight: 400` у Zed `settings.json`", because це єдина зміна з чотирьох спроб, яка не зачіпає інші пани (sidebar, tabs) і хоч частково впливає на вагу шрифту в редакторі.

### Consequences
* Good, because зміна `buffer_font_weight: 500` → `400` полегшує шрифт в редакторному буфері без впливу на UI-chrome.
* Bad, because transcript фіксує, що після застосування зміни користувач не побачив жодного ефекту у preview — markdown-заголовки (`h1`/`h2`) та body-текст у WebKit-рендері preview ігнорують `buffer_font_weight`.

## More Information
* Файл: `/Users/vitaliytv/.config/zed/settings.json`
* Фінальне значення: `"buffer_font_weight": 400`
* Попереднє значення: `"buffer_font_weight": 500`
* Спочатку зміна була зроблена помилково у Cursor (`/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json`, `markdown.preview.fontSize: 11`) — потім відмінена.

---

## ADR Обмеження ізольованого налаштування markdown preview у Zed

## Context and Problem Statement
Під час сесії виявилось, що Zed не надає окремого налаштування font size виключно для панелі markdown preview — на відміну від VS Code (`markdown.preview.fontSize`).

## Considered Options
* `ui_font_size` — контролює весь UI, включаючи preview
* `buffer_font_size` — контролює текст у редакторі, але НЕ впливає на markdown preview
* CSS injection через `settings.json` — не підтримується Zed на момент сесії

## Decision Outcome
Chosen option: "Прийняти обмеження — ізоляція шрифту preview в Zed недоступна через `settings.json`", because transcript підтвердив: зміна `ui_font_size: 21 → 14` зменшила preview разом з усім UI (sidebar, tabs), а `buffer_font_size` на preview не впливає.

### Consequences
* Good, because transcript фіксує очікувану користь: з'ясоване точне маппінг — preview → `ui_font_size`, редактор → `buffer_font_size`, термінал → `terminal.font_size` (17.0).
* Bad, because неможливо зменшити шрифт preview без одночасного зменшення всього інтерфейсу; `ui_font_size` було повернуто до 21.

## More Information
* Файл: `/Users/vitaliytv/.config/zed/settings.json`
* `ui_font_size: 21` (повернуто після відкату з 14)
* `buffer_font_size: 17`
* `terminal.font_size: 17.0` (окремий блок, не пов'язаний з `ui_font_size`)
* Єдиний незбережений workaround — `Cmd -` у сфокусованій preview-панелі (скидається при закритті вкладки).
