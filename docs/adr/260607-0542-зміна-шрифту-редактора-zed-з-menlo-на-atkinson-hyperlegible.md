---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:42:34+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

## ADR Зміна шрифту редактора Zed з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і потребував шрифту з широкими літерами та чіткою розрізняльністю схожих символів (0/O, l/1/I). Поточний шрифт Menlo має лише два варіанти ваги (Regular і Bold), тому `buffer_font_weight: 500` не давав видимого ефекту.

## Considered Options
* Atkinson Hyperlegible Mono
* JetBrains Mono

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono", because він розроблений Braille Institute спеціально для слабкого зору — широкі літери, чіткі засічки між схожими символами, безкоштовний.

### Consequences
* Good, because transcript фіксує очікувану користь: шрифт встановлено через `brew install --cask font-atkinson-hyperlegible-mono` і застосовано як `"buffer_font_family": "Atkinson Hyperlegible Mono"` у `/Users/vitaliytv/.config/zed/settings.json`.
* Bad, because зміна `buffer_font_family` автоматично поширилась на термінал (Zed наслідує buffer-шрифт), що потребувало явного `"terminal.font_family"` для ізоляції.

## More Information
Файл: `/Users/vitaliytv/.config/zed/settings.json`. Встановлення: `brew install --cask font-atkinson-hyperlegible-mono`. Налаштування: `buffer_font_family`, `buffer_font_weight: 400`.

---

## ADR Явне задання шрифту терміналу Zed: JetBrains Mono з вагою 400

## Context and Problem Statement
Після зміни `buffer_font_family` на Atkinson Hyperlegible Mono термінал Zed автоматично успадкував новий шрифт. Користувач хотів повернути терміналу окремий шрифт і одночасно отримати підтримку змінної ваги (Menlo такої підтримки не має).

## Considered Options
* Повернути Menlo через явний `terminal.font_family`
* Встановити JetBrains Mono з `font_weight: 400`

## Decision Outcome
Chosen option: "JetBrains Mono з font_weight: 400", because JetBrains Mono підтримує проміжні ваги (на відміну від Menlo з лише Regular і Bold), що дозволяє зробити текст терміналу тонший без зміни шрифту редактора.

### Consequences
* Good, because transcript фіксує очікувану користь: термінал ізольований від `buffer_font_family` і отримав легшу вагу літер.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `/Users/vitaliytv/.config/zed/settings.json`. Встановлення: `brew install --cask font-jetbrains-mono`. Секція `"terminal"`: `font_family`, `font_size: 17.0`, `font_weight: 400`. Обидва шрифти встановлено одним кроком через Homebrew Cask.

---

## ADR Обмеження `ui_font_size` у Zed: неможливість ізолювати preview-панель

## Context and Problem Statement
Markdown preview у Zed відображав текст значно крупніший за термінал (session/captured frontmatter рендерився як звичайний текст). Виникла потреба зменшити шрифт лише у preview без змін у sidebar і chat-колонках.

## Considered Options
* Зменшити `ui_font_size` (глобально для всього UI)
* Ізолювати шрифт preview окремим налаштуванням

## Decision Outcome
Chosen option: "Залишити `ui_font_size: 21` без змін", because у Zed немає окремого налаштування для markdown preview — він використовує `ui_font_size`, і зміна цього параметра (тестувалось 14 і 16) одночасно впливає на sidebar, таби і chat-колонки, що погіршувало загальний баланс інтерфейсу.

### Consequences
* Good, because transcript фіксує очікувану користь: sidebar і chat залишились читабельними при поверненні до 21.
* Bad, because preview-панель і changes-panel залишаються крупнішими ніж термінал; CSS injection у Zed через `settings.json` не підтримується, тому ізольоване налаштування preview недоступне.

## More Information
Файл: `/Users/vitaliytv/.config/zed/settings.json`. Протестовані значення: `ui_font_size: 14` (задрібно для cols 1–2), `ui_font_size: 16` (також погіршило cols 1–2). Тимчасовий workaround — `Cmd -` у фокусі preview-панелі (скидається при закритті вкладки).
