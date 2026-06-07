---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:36:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і шукав шрифт для редактора Zed, де літери не були б "щілинними" (вузькими і схожими одна на одну). Поточний шрифт `Menlo` не має проміжних ваг між Regular і Bold, тому зменшення `buffer_font_weight` з 500 до 400 не дало помітного результату.

## Considered Options
* Залишити Menlo (стандартний системний моноширинний шрифт macOS)
* Atkinson Hyperlegible Mono (розроблений Braille Institute для слабкого зору)
* JetBrains Mono (широкі форми символів, знижена втома очей)

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono", because шрифт спроектований спеціально для умов слабкого зору: широкі літери, чіткі відмінності між схожими символами (`0`/`O`, `l`/`1`/`I`), що безпосередньо вирішує проблему астигматизму.

### Consequences
* Good, because transcript фіксує очікувану користь: краща розбірливість схожих символів у коді при астигматизмі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Встановлення: `brew install --cask font-atkinson-hyperlegible-mono`
Змінений параметр: `buffer_font_family` у `/Users/vitaliytv/.config/zed/settings.json`
Також встановлено `font-jetbrains-mono` як альтернативу для подальшого порівняння.

---

## ADR Відмова від ізольованого зменшення шрифту markdown preview у Zed

## Context and Problem Statement
Користувач хотів зменшити розмір тексту лише у вікні markdown preview до рівня терміналу, не зачіпаючи решту інтерфейсу Zed. Перша спроба була зроблена в `settings.json` Cursor (`markdown.preview.fontSize`), але preview виявився у Zed.

## Considered Options
* Змінити `ui_font_size` у Zed (впливає на весь UI, включно з preview)
* Використати `Cmd -` безпосередньо у preview-пані (тимчасовий зум, не зберігається)
* Компроміс: виставити `ui_font_size: 17` (рівень терміналу)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Reverted `ui_font_size` до початкового значення 21", because після зменшення `ui_font_size` з 21 до 14 зменшились усі вікна крім терміналу — sidebar, таби, панелі — що виявилось неприйнятним. Zed не має окремого налаштування для markdown preview.

### Consequences
* Good, because transcript фіксує очікувану користь: збереження зручного розміру UI-елементів.
* Bad, because розмір тексту у markdown preview залишається більшим за текст терміналу — ізольованого контролю немає.

## More Information
`ui_font_size` повернуто до `21` у `/Users/vitaliytv/.config/zed/settings.json`.
Markdown preview у Zed рендериться через WebKit і стилізується власним CSS — ін'єкція кастомних стилів через `settings.json` не підтримується.
Зміна в `/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json` (`markdown.preview.fontSize`) теж не мала ефекту — preview був у Zed, не в Cursor.
