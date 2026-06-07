---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:46:40+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора Zed з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і шукав шрифт для редактора Zed, де літери не були б "щільними" (cramped). Menlo, встановлений як `buffer_font_family`, має лише два варіанти ваги — Regular і Bold — і не забезпечує комфортного читання.

## Considered Options
* Atkinson Hyperlegible Mono
* JetBrains Mono
* Залишити Menlo

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono", because він розроблений Braille Institute спеціально для людей із порушеннями зору: широкі літери, чіткі розрізнення між схожими символами (0/O, l/1/I).

### Consequences
* Good, because transcript фіксує очікувану користь: шрифт встановлено і застосовано до `buffer_font_family` у `/Users/vitaliytv/.config/zed/settings.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Встановлення: `brew install --cask font-atkinson-hyperlegible-mono`. Параметр у `settings.json`: `"buffer_font_family": "Atkinson Hyperlegible Mono"`. JetBrains Mono також встановлено паралельно через `brew install --cask font-jetbrains-mono`.

---

## ADR Зміна шрифту терміналу Zed з Menlo на JetBrains Mono Thin

## Context and Problem Statement
Термінал Zed успадковував `buffer_font_family` (Menlo), і після заміни редаторного шрифту термінал теж перейшов на Atkinson Hyperlegible Mono. Користувач хотів повернути термінал до іншого шрифту та позбутись "жирності", яку давав JetBrains Mono Regular.

## Considered Options
* JetBrains Mono (Regular / weight 400)
* JetBrains Mono Thin (через назву сімейства)
* Menlo (повернення до початкового)

## Decision Outcome
Chosen option: "JetBrains Mono Thin", because варіант через `font_weight: 400` не давав видимого ефекту (Zed, мабуть, не підтримує `font_weight` для терміналу), тоді як пряма назва сімейства `"JetBrains Mono Thin"` зменшила вагу — користувач підтвердив "краще".

### Consequences
* Good, because transcript фіксує очікувану користь: видима "тонкість" шрифту в терміналі підтверджена користувачем.
* Bad, because спроба `font_weight: 400` виявилась марною — параметр не підтримується в секції `terminal` Zed, що з'ясовано методом проб.

## More Information
Фінальна конфігурація у `/Users/vitaliytv/.config/zed/settings.json`:
```json
"terminal": {
"font_size": 17.0,
"font_family": "JetBrains Mono Thin"
}
```
Проміжні спроби: `"font_family": "Menlo"` → `"JetBrains Mono"` + `"font_weight": 400` → `"JetBrains Mono Thin"`.

---

## ADR Відмова від ізольованого масштабування markdown preview у Zed

## Context and Problem Statement
Текст у markdown preview і панелі changes у Zed відображався значно більшим, ніж у терміналі. Потрібно було зменшити шрифт лише в цих двох панелях, не зачіпаючи інші колонки і термінал.

## Considered Options
* Зменшити `ui_font_size` (впливає на весь UI)
* Окреме налаштування markdown preview (аналог `markdown.preview.fontSize` у VS Code)
* `Cmd -` у фокусі preview-панелі (тимчасовий зум)

## Decision Outcome
Chosen option: "Відкат `ui_font_size` до 21 і прийняття обмеження", because Zed не має окремого параметра для preview: `ui_font_size` змінює всі 4 колонки UI одночасно, а термінал залишається незалежним. Спроби 14 і 16 робили колонки 1 і 2 некомфортними.

### Consequences
* Good, because transcript фіксує очікувану користь: колонки 1 і 2 повернулися до прийнятного стану після реверту.
* Bad, because preview і changes panel залишились із великим шрифтом — ізольоване рішення недоступне через `settings.json`.

## More Information
Перевірені значення `ui_font_size`: 14 (задрібно для колонок 1–2), 16 (гірше колонки 1–2), 21 (фінальне). Тимчасовий workaround: `Cmd -` у фокусі preview. Помилкова перша спроба змінити `markdown.preview.fontSize` у Cursor (`/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json`) — до з'ясування що preview відкрито в Zed.

---

## ADR Зниження ваги UI-шрифту Zed через `ui_font_weight: 300`

## Context and Problem Statement
Після зміни `buffer_font_family` і налаштувань терміналу шрифт у file tree (sidebar) та інших UI-елементах залишався візуально "жирним". Користувач попросив зробити його тонішим.

## Considered Options
* Додати `ui_font_weight: 300`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `ui_font_weight: 300`", because це єдиний параметр Zed, що дозволяє впливати на вагу шрифту UI-елементів без зміни `ui_font_family`.

### Consequences
* Good, because Neutral, because transcript не містить підтвердження наслідку — сесія завершилась після застосування зміни без фінального відгуку користувача.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальний рядок у `/Users/vitaliytv/.config/zed/settings.json`: `"ui_font_weight": 300`. Попередній `buffer_font_weight` змінено з 500 на 400, але зміна не дала видимого результату через відсутність проміжних вагових варіантів у Menlo.
