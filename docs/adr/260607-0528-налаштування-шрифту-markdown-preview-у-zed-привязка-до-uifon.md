---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:28:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Налаштування шрифту markdown preview у Zed: прив'язка до `ui_font_size`

## Context and Problem Statement

Користувач хотів зменшити розмір шрифту у вікні preview Zed до розміру шрифту терміналу (17 px), зберігши при цьому розміри інших елементів UI незмінними. У `~/.config/zed/settings.json` `ui_font_size` дорівнювало 21, `buffer_font_size` та `terminal.font_size` — 17.

## Considered Options

* Зменшити `ui_font_size` у `~/.config/zed/settings.json`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Зменшити `ui_font_size`", because це єдиний параметр у Zed, який впливає на відображення шрифту в markdown preview (знижено з 21 до 14). Після перевірки виявилося, що зміна зачіпає весь UI (sidebar, tabs, panels), окрім терміналу, тому зміну було скасовано — `ui_font_size` повернуто до 21.

### Consequences

* Good, because transcript фіксує очікувану користь: зменшення `ui_font_size` дійсно зменшує текст у markdown preview.
* Bad, because `ui_font_size` є глобальним налаштуванням UI і не може бути ізольоване лише для markdown preview — у Zed немає окремого параметра для шрифту preview-панелі. Завдання залишилось невиконаним і зміни відкочено.

## More Information

* Файл налаштувань: `~/.config/zed/settings.json`
* Перевірені параметри: `ui_font_size` (21), `buffer_font_size` (17), `terminal.font_size` відсутній (default 17)
* Markdown preview у Zed успадковує `ui_font_size`, а не `buffer_font_size`
* Cursor `settings.json` (`/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json`) було змінено помилково на початку сесії — `markdown.preview.fontSize: 11` — але ця зміна не стосується Zed і до кінця сесії в transcript не відкочена
