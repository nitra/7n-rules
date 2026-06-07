---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:40:44+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора Zed з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і шукав моноширинний шрифт для редактора Zed, де літери не були б щілними, а текст — некомфортно жирним. Стандартний шрифт Menlo підтримує лише два варіанти ваги (Regular і Bold), що не дає змоги полегшити накреслення.

## Considered Options
* Залишити Menlo (не підтримує variable weight)
* JetBrains Mono (широкий, підтримує weight 400, безкоштовний)
* Atkinson Hyperlegible Mono (розроблений Braille Institute для слабкого зору, широкі літери, чіткі засічки між схожими символами 0/O, l/1/I)

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono для редактора, JetBrains Mono для терміналу", because Atkinson Hyperlegible Mono спеціально розроблений для людей із вадами зору і забезпечує чіткість схожих символів; JetBrains Mono обрано для терміналу оскільки підтримує weight 400, що дає тонший рядок ніж Menlo Regular.

### Consequences
* Good, because transcript фіксує очікувану користь: Atkinson Hyperlegible Mono дає ширші літери і кращу розрізнюваність символів при астигматизмі; JetBrains Mono з font_weight 400 прибирає відчуття «жирного» шрифту в терміналі.
* Bad, because transcript фіксує, що `buffer_font_weight: 400` для Menlo не давав видимого ефекту — Menlo не має проміжних ваг, тому попередня спроба полегшити шрифт провалилась.

## More Information
Файл налаштувань: `/Users/vitaliytv/.config/zed/settings.json`
```json
"buffer_font_family": "Atkinson Hyperlegible Mono",
"buffer_font_weight": 400,
"terminal": {
"font_size": 17.0,
"font_family": "JetBrains Mono",
"font_weight": 400
}
```
Встановлено через: `brew install --cask font-atkinson-hyperlegible-mono font-jetbrains-mono`

---

## ADR Зміна `ui_font_size` у Zed для вирівнювання розміру preview і панелі змін

## Context and Problem Statement
Markdown preview (колонка 3) і changes panel (колонка 4) у Zed відображали текст значно більше ніж редактор і термінал (`buffer_font_size: 17`, `terminal.font_size: 17.0`), оскільки обидві панелі використовують `ui_font_size` (за замовчуванням 21). Окремого налаштування тільки для markdown preview у Zed немає.

## Considered Options
* Залишити `ui_font_size: 21` — preview залишається великим
* Зменшити `ui_font_size: 14` — preview і весь UI стали надто дрібними
* Встановити `ui_font_size: 16` — компроміс між читабельністю UI і відповідністю розміру терміналу
* `Cmd -` у фокусі preview — тимчасовий зум, не зберігається між сесіями

## Decision Outcome
Chosen option: "`ui_font_size: 16`", because значення 14 виявилось надто малим (весь UI — sidebar, таби — зменшився надмірно), а 16 дає прийнятний баланс між preview і загальним UI.

### Consequences
* Good, because transcript фіксує очікувану користь: колонки 3 і 4 стають менш диспропорційно великими відносно редактора і терміналу.
* Bad, because `ui_font_size` впливає на весь UI (sidebar, таби, панелі), а не тільки на preview — ізольованого налаштування для markdown preview у Zed через `settings.json` не існує.

## More Information
Файл налаштувань: `/Users/vitaliytv/.config/zed/settings.json`
Зміна: `"ui_font_size": 21` → `"ui_font_size": 16`
Термінал залишився незачепленим — він використовує власний `terminal.font_size: 17.0`.
