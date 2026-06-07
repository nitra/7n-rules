---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:39:24+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора Zed на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і шукав шрифт для редактора Zed, де літери не виглядають вузькими та щільними. Наявний шрифт Menlo не підтримує проміжних вагових варіантів (лише Regular та Bold), тому `buffer_font_weight: 500` не давало видимого ефекту.

## Considered Options
* Atkinson Hyperlegible Mono
* JetBrains Mono
* Menlo (попередній)

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono", because шрифт розроблений Braille Institute спеціально для людей зі слабким зором — широкі літери, чіткі відмінності між схожими символами (0/O, l/1/I), і безкоштовний.

### Consequences
* Good, because transcript фіксує очікувану користь: широкі, добре розрізнювані літери зменшують навантаження при астигматизмі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Встановлено через `brew install --cask font-atkinson-hyperlegible-mono`
- Змінено в `/Users/vitaliytv/.config/zed/settings.json`: `"buffer_font_family": "Atkinson Hyperlegible Mono"`
- Замінює попереднє значення `"Menlo"`

---

## ADR Зміна шрифту терміналу Zed на JetBrains Mono

## Context and Problem Statement
Після зміни `buffer_font_family` на Atkinson Hyperlegible Mono термінал успадкував новий шрифт, але користувач хотів залишити в терміналі шрифт із підтримкою variable weight, щоб можна було прибрати "жирність". Menlo не підтримує проміжних вагових варіантів.

## Considered Options
* JetBrains Mono (підтримує variable weight)
* Menlo (лише Regular/Bold — не задовольняє вимогу)

## Decision Outcome
Chosen option: "JetBrains Mono", because цей шрифт підтримує variable weight (зокрема `font_weight: 400`), що дозволяє зробити текст терміналу тоншим без зміни шрифту в редакторі.

### Consequences
* Good, because transcript фіксує очікувану користь: термінал отримує незалежний шрифт з підтримкою ваги.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Встановлено через `brew install --cask font-jetbrains-mono`
- Змінено в `/Users/vitaliytv/.config/zed/settings.json`:
```json
"terminal": {
"font_size": 17.0,
"font_family": "JetBrains Mono",
"font_weight": 400
}
```
- `terminal.font_family` задано явно, щоб перекрити успадкування від `buffer_font_family`

---

## ADR Відмова від зміни розміру шрифту markdown preview у Zed

## Context and Problem Statement
Користувач хотів зменшити розмір шрифту в панелі markdown preview Zed до рівня терміналу, не впливаючи на решту інтерфейсу.

## Considered Options
* Зменшити `ui_font_size` (глобальне налаштування)
* Зменшити `buffer_font_size` (впливає на редактор)
* CSS injection у preview (Zed не підтримує через `settings.json`)
* Клавіатурний зум `Cmd -` у фокусі preview (не зберігається між сесіями)

## Decision Outcome
Chosen option: "Відмова від зміни (revert)", because у Zed немає ізольованого налаштування шрифту для markdown preview — `ui_font_size` впливає на весь UI (sidebar, таби, панелі), а CSS injection через `settings.json` не підтримується.

### Consequences
* Good, because `ui_font_size` повернуто до початкового значення `21`, щоб не погіршити загальний UI.
* Bad, because розмір шрифту в markdown preview залишається прив'язаним до `ui_font_size` і не може бути налаштований ізольовано засобами Zed.

## More Information
- `ui_font_size` тестувалось зі значенням `14` — підтверджено, що preview зменшується, але разом з усім UI
- Повернуто до `"ui_font_size": 21` в `/Users/vitaliytv/.config/zed/settings.json`
- `markdown.preview.fontSize` в Cursor (`/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json`) було додано помилково (сесія починалась у припущенні що preview в Cursor) і потім видалено
