---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:43:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора Zed з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і шукав шрифт для редактора Zed, де літери не виглядають вузькими чи зщільненими. Існуючий шрифт `Menlo` не підтримує проміжні ваги і тому не дозволяє зменшити жирність. Також було потрібно відокремити шрифт терміналу від редактора.

## Considered Options
* Залишити `Menlo` з іншим `buffer_font_weight`
* Змінити на **Atkinson Hyperlegible Mono** (розроблений Braille Institute для слабкого зору)
* Змінити на **JetBrains Mono** (широкі літероформи, підтримка variable weights)

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono для редактора, JetBrains Mono Thin для терміналу", because `Menlo` має лише Regular і Bold — weight 400 vs 500 не дає видимої різниці, тоді як Atkinson Hyperlegible Mono розроблений спеціально для читабельності при порушеннях зору, а JetBrains Mono підтримує Thin-варіант для легшого відображення у терміналі.

### Consequences
* Good, because transcript фіксує очікувану користь: ширші літероформи Atkinson Hyperlegible Mono зручніші при астигматизмі, а JetBrains Mono Thin дає тонший шрифт у терміналі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни у `/Users/vitaliytv/.config/zed/settings.json`:
- `"buffer_font_family": "Atkinson Hyperlegible Mono"` — шрифт редактора
- `"buffer_font_weight": 400` — вага (не дає ефекту з Menlo, але залишена для нового шрифту)
- `"terminal.font_family": "JetBrains Mono Thin"` — шрифт терміналу
- `"terminal.font_size": 17.0` — розмір терміналу

Встановлення: `brew install --cask font-atkinson-hyperlegible-mono font-jetbrains-mono`

---

## ADR Неможливість ізольованого налаштування шрифту markdown preview у Zed

## Context and Problem Statement
Користувач хотів зменшити шрифт у вікні markdown preview до розміру терміналу, не зачіпаючи інші панелі. В процесі сесії було виявлено, що Zed не має окремого налаштування для preview-панелі.

## Considered Options
* Зменшити `markdown.preview.fontSize` (VS Code/Cursor-специфічне, у Zed відсутнє)
* Зменшити `ui_font_size` (впливає на всі 4 колонки UI одночасно)
* CSS injection у markdown preview (Zed не підтримує через `settings.json`)
* Використовувати `Cmd -` у фокусі preview-панелі (тимчасовий зум, не зберігається)

## Decision Outcome
Chosen option: "Повернути `ui_font_size: 21` без змін", because жоден варіант не дозволяє ізольовано зменшити preview: `ui_font_size` зачіпає всі панелі (sidebar, tabs, chat, changes), а CSS injection відсутній у Zed. `Cmd -` у фокусі preview — єдина тимчасова опція, але вона скидається при закритті вкладки.

### Consequences
* Good, because transcript фіксує очікувану користь: колонки 1 і 2 залишаються на зручному розмірі 21px.
* Bad, because preview і changes panel (колонки 3 і 4) залишаються того ж розміру, що й решта UI — окреме зменшення неможливе.

## More Information
У `/Users/vitaliytv/.config/zed/settings.json` значення `"ui_font_size": 21` відновлено після спроб 14 і 16. Термінал використовує окреме `terminal.font_size: 17.0` і не залежить від `ui_font_size`. Markdown preview у Zed рендериться через WebKit і успадковує `ui_font_size`, CSS-кастомізація через `settings.json` недоступна.
