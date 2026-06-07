---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:38:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора Zed з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач скаржився, що шрифт у редакторі важко читати через астигматизм: літери здаються вузькими та злитими. Поточний шрифт `buffer_font_family: "Menlo"` не має проміжних ваг між Regular і Bold, тому зниження `buffer_font_weight` з 500 до 400 не дало жодного видимого ефекту.

## Considered Options
* Atkinson Hyperlegible Mono (розроблений Braille Institute для слабкого зору)
* JetBrains Mono (широкі знаки, знижена стомлюваність очей)

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono", because шрифт спеціально проєктувався під порушення зору — широкі гліфи, підвищений контраст між схожими символами (0/O, l/1/I).

### Consequences
* Good, because transcript фіксує очікувану користь: широкі нечіткі літери зменшують навантаження при астигматизмі.
* Bad, because `buffer_font_family` у Zed наслідується також терміналом, тому після зміни довелося явно зафіксувати `terminal.font_family: "Menlo"` щоб повернути термінал до попереднього вигляду.

## More Information
- Встановлено через: `brew install --cask font-atkinson-hyperlegible-mono`
- Файл: `/Users/vitaliytv/.config/zed/settings.json`
- Ключі: `"buffer_font_family": "Atkinson Hyperlegible Mono"`, `"buffer_font_weight": 400`
- Термінал ізольовано явним ключем: `"terminal": { "font_family": "Menlo" }`

---

## ADR Явне задання terminal.font_family у Zed після зміни buffer_font_family

## Context and Problem Statement
Після зміни `buffer_font_family` з `"Menlo"` на `"Atkinson Hyperlegible Mono"` термінал Zed також підхопив новий шрифт, хоча користувач хотів залишити його без змін.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "явний `terminal.font_family: "Menlo"` у секції `terminal`", because Zed наслідує термінальний шрифт від `buffer_font_family` якщо явне значення відсутнє; єдиний спосіб ізоляції — задати його вручну.

### Consequences
* Good, because термінал залишається на Menlo незалежно від майбутніх змін `buffer_font_family`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `/Users/vitaliytv/.config/zed/settings.json`
- Додано у секцію `"terminal"`: `"font_family": "Menlo"`
- Паралельно у тій же секції `"font_size": 17.0` вже існував

---

## ADR Відмова від ui_font_size для управління шрифтом markdown preview у Zed

## Context and Problem Statement
Користувач хотів зменшити розмір тексту у вбудованому markdown preview Zed, не зачіпаючи термінал. Спочатку `ui_font_size` було знижено з 21 до 14, але це зменшило весь UI — sidebar, таби, панелі — залишивши термінал незмінним.

## Considered Options
* Зменшити `ui_font_size` (глобальний вплив на увесь UI)
* Компроміс `ui_font_size: 17` (наближення до розміру терміналу, але UI все одно менший)
* Зум клавіатурою `Cmd -` у фокусі preview (не зберігається між сесіями)

## Decision Outcome
Chosen option: "повернення `ui_font_size: 21`", because Zed не надає ізольованого налаштування шрифту тільки для markdown preview; будь-яка зміна `ui_font_size` зачіпає весь UI, що є неприйнятним побічним ефектом.

### Consequences
* Good, because transcript фіксує очікувану користь: розмір sidebar, табів і панелей повернувся до зручного рівня.
* Bad, because розмір тексту у markdown preview залишився незмінним — задачу ізольованого масштабування preview не вирішено.

## More Information
- Zed не підтримує CSS injection для markdown preview через `settings.json` (станом на дату сесії)
- Файл: `/Users/vitaliytv/.config/zed/settings.json`, ключ `"ui_font_size"`
- Markdown preview рендериться через WebKit з вбудованими стилями; заголовки h1/h2 залишаються жирними незалежно від `buffer_font_weight`
