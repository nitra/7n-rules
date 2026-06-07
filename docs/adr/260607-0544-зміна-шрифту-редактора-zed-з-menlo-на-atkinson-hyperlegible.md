---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:44:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

(summary of changes made to Zed font settings):
- `buffer_font_family`: **Atkinson Hyperlegible Mono** (editor)
- `terminal.font_family`: **JetBrains Mono Thin** (terminal)
- `buffer_font_weight`: 400
- `ui_font_size`: 21 (залишилась без змін)
---

## ADR Зміна шрифту редактора Zed з Menlo на Atkinson Hyperlegible Mono

## Context and Problem Statement
Користувач має астигматизм і потребує шрифту з чіткими, широкими літерами для роботи в редакторі Zed. Шрифт Menlo не підтримує проміжних вагів (лише Regular і Bold), тому зменшити "жирність" тексту було неможливо. Також розглядалась можливість зменшити розмір шрифту у markdown preview-панелі без впливу на весь UI.

## Considered Options
* Залишити Menlo, змінити `buffer_font_weight`
* Встановити Atkinson Hyperlegible Mono (buffer) + JetBrains Mono Thin (terminal)
* Встановити JetBrains Mono для всіх панелей
* Зменшити `ui_font_size` для preview-панелі

## Decision Outcome
Chosen option: "Atkinson Hyperlegible Mono для редактора, JetBrains Mono Thin для терміналу", because Atkinson Hyperlegible Mono розроблений Braille Institute спеціально для слабкого зору (широкі літери, чіткі розрізнення між схожими символами), а JetBrains Mono підтримує variable weights — варіант Thin прибрав небажану жирність у терміналі, яку Menlo не міг усунути.

### Consequences
* Good, because transcript фіксує очікувану користь: зменшено жирність терміналу через `JetBrains Mono Thin`; редактор отримав шрифт з кращою розбірливістю для астигматизму.
* Bad, because markdown preview і changes panel залишились без змін — у Zed немає окремого налаштування розміру шрифту для цих панелей; `ui_font_size` контролює весь UI разом, тому ізолювати preview неможливо через `settings.json`.

## More Information
Змінені налаштування у `/Users/vitaliytv/.config/zed/settings.json`:
- `buffer_font_family`: `"Atkinson Hyperlegible Mono"` (замість `"Menlo"`)
- `terminal.font_family`: `"JetBrains Mono Thin"` (замість `"Menlo"`)
- `buffer_font_weight`: `400` (замість `500`)
- `ui_font_size`: повернуто до `21` після спроб `14` та `16`

Встановлено через Homebrew:
```sh
brew install --cask font-atkinson-hyperlegible-mono
brew install --cask font-jetbrains-mono
```
