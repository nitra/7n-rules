---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:31:17+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

На жаль, Zed наразі не підтримує окремий CSS або font override лише для panel preview — немає еквіваленту `markdown.styles` як у VS Code.

Що є:

**Варіант 1 — мовний override для .md у буфері** (не preview):
```json
"languages": {
"Markdown": {
"buffer_font_size": 13
}
}
```
Це зменшить шрифт коли *редагуєш* .md файл, але preview — окремий WebView і цього не відчує.

**Варіант 2 — Cmd+- у сфокусованому preview**
Зум не зберігається між сесіями, але працює одразу для потрібної панелі.

**Варіант 3 — `ui_font_size: 17`**
Компроміс: preview стає розміром терміналу, UI трохи менший ніж зараз (21→17), але не так критично як 14.

Щодо **жирності** — у preview `## ADR ...` це h2-заголовок, він завжди bold — це HTML-рендеринг, а не налаштування шрифту.

Якщо хочеш варіант 3 — скажи, поставлю `ui_font_size: 17`.

---

## ADR Зменшення шрифту markdown preview у Zed

## Context and Problem Statement
У вікні Zed markdown preview шрифт відображається більшим, ніж у терміналі нижче. Користувач хотів зменшити шрифт виключно у preview-панелі, не зачіпаючи решту інтерфейсу.

## Considered Options
* Змінити `markdown.preview.fontSize` у Cursor (помилково застосовано спочатку — editor не той)
* Зменшити `ui_font_size` у Zed (глобально впливає на весь UI)
* Знайти ізольоване налаштування тільки для preview (не існує в Zed)
* Мовний override `languages.Markdown.buffer_font_size` (впливає лише на editor-буфер, не preview)
* Клавіатурний зум `Cmd -` у сфокусованому preview (не зберігається)

## Decision Outcome
Chosen option: "Повернення до `ui_font_size: 21` без змін", because Zed не підтримує ізольований font override для markdown preview panel — єдиний параметр, що впливає на preview, є `ui_font_size`, який одночасно змінює весь інтерфейс (sidebar, tabs, panels), крім терміналу.

### Consequences
* Good, because transcript фіксує очікувану користь: зміна `ui_font_size: 14` підтвердила, що саме цей параметр контролює preview — технічна гіпотеза перевірена.
* Bad, because ізольоване зменшення шрифту тільки у preview технічно неможливе в поточній версії Zed без workaround із непостійним зумом.

## More Information
- Файл налаштувань: `/Users/vitaliytv/.config/zed/settings.json`
- Перевірені параметри: `ui_font_size` (21), `buffer_font_size` (17), `agent_buffer_font_size` (17), `terminal.font_size` (17)
- Markdown preview у Zed є окремим WebView і не успадковує `buffer_font_size` або мовні overrides (`languages.Markdown.*`)
- Еквівалент `markdown.styles` (CSS injection) — відсутній у Zed на момент сесії
- Зміна `ui_font_size: 21 → 14` підтверджена користувачем як така, що зменшила preview але також увесь UI
- Зміна в Cursor `markdown.preview.fontSize: 13 → 11` була відмінена як нерелевантна (неправильний редактор)
