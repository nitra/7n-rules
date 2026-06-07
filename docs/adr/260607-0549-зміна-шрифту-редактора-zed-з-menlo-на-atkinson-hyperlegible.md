---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:49:48+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора Zed з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і попросив змінити шрифт редактора — літери у Menlo виглядають "щільними". Спочатку була спроба зменшити `buffer_font_weight: 500 → 400`, але Menlo підтримує лише Regular і Bold — проміжних варіантів немає, зміни не відображались.

## Considered Options
* Atkinson Hyperlegible Mono
* JetBrains Mono
* Залишити Menlo (status quo)

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono", because шрифт розроблений Braille Institute спеціально для слабкого зору: широкі літери, чітке розрізнення схожих символів (0/O, l/1/I). Обрано першим для тестування; JetBrains Mono встановлено паралельно як альтернативу.

### Consequences
* Good, because transcript фіксує очікувану користь: ширші літерні форми зменшують навантаження на зір при астигматизмі.
* Bad, because `buffer_font_family` змінює шрифт і в терміналі — термінал довелося явно зафіксувати окремим `terminal.font_family`.

## More Information
Файл: `/Users/vitaliytv/.config/zed/settings.json`
Ключ: `"buffer_font_family": "Atkinson Hyperlegible Mono"`
Встановлення: `brew install --cask font-atkinson-hyperlegible-mono`

---

## ADR Шрифт терміналу Zed — JetBrains Mono Thin через явну назву варіанта

## Context and Problem Statement
Після зміни `buffer_font_family` термінал перейшов на Atkinson Hyperlegible Mono (бо наслідує buffer за замовчуванням). Користувач хотів у терміналі легший шрифт — не жирний. Спроба `"font_weight": 400` у блоці `terminal` не дала ефекту (Zed не підтримує `font_weight` для терміналу).

## Considered Options
* `JetBrains Mono Thin` (назва варіанта як `font_family`)
* `font_weight: 400` у блоці `terminal` (спробовано — не спрацювало)
* Atkinson Hyperlegible Mono (той самий що й редактор)
* Menlo (попередній шрифт терміналу)

## Decision Outcome
Chosen option: "JetBrains Mono Thin через назву варіанта як font_family", because Zed ігнорує `terminal.font_weight`, але приймає повну назву варіанта в `terminal.font_family`; JetBrains Mono має окремі named variants (Thin, ExtraLight, Light, Regular тощо).

### Consequences
* Good, because transcript фіксує очікувану користь: після зміни на `"JetBrains Mono Thin"` користувач підтвердив "краще".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `/Users/vitaliytv/.config/zed/settings.json`, блок `terminal`:
```json
"terminal": {
"font_size": 17.0,
"font_family": "JetBrains Mono Thin"
}
```
Встановлення: `brew install --cask font-jetbrains-mono`
Доступні варіанти між Thin і Regular: `JetBrains Mono ExtraLight`, `JetBrains Mono Light`.

---

## ADR Відмова від ізольованого зменшення шрифту preview-панелі в Zed

## Context and Problem Statement
Користувач хотів зменшити шрифт лише у markdown preview та changes panel (колонки 3 і 4), щоб вони відповідали розміру терміналу, без впливу на sidebar і чат (колонки 1 і 2).

## Considered Options
* Зміна `ui_font_size` глобально (спробовано: 14, потім 16)
* `Cmd -` у фокусі preview-панелі (тимчасовий зум, не зберігається)
* Окреме налаштування для preview (не існує в Zed settings.json)

## Decision Outcome
Chosen option: "Повернути `ui_font_size: 21` і залишити preview без змін", because у Zed `ui_font_size` єдиний і впливає на всі 4 колонки одночасно; при зменшенні до 14 або 16 колонки 1 і 2 ставали незручно дрібними, а термінал не змінювався взагалі (він незалежний). Ізольованого налаштування для preview у `settings.json` не існує.

### Consequences
* Good, because sidebar і чат-колонки залишились на зручному розмірі 21px.
* Bad, because preview panel і changes panel залишаються з більшим шрифтом ніж термінал — вирівняти їх без CSS injection неможливо.

## More Information
Файл: `/Users/vitaliytv/.config/zed/settings.json`
Ключ: `"ui_font_size": 21`
Тимчасовий workaround: `Cmd -` у фокусі preview-вкладки (скидається при закритті вкладки).
Zed не підтримує custom CSS injection для markdown preview через `settings.json`.
