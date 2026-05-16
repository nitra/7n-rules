---
session: 0850a6f9-4567-482d-8da2-2fe965458fbc
captured: 2026-05-16T15:47:24+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/0850a6f9-4567-482d-8da2-2fe965458fbc.jsonl
---

## ADR Правило `adr` переведено з opt-in у always-on

**Контекст:** Правило `adr` (автоматичний збір ADR/Runbook/Knowledge-чернеток через Stop-хук) до цього вмикалось виключно вручну — додаванням `"adr"` у масив `rules` файлу `.n-cursor.json`. Виникла потреба, щоб правило було активне в усіх проєктах без жодних ручних дій.

**Рішення/Процедура/Факт:** До `npm/scripts/auto-rules.mjs` додано `addRule('adr')` без умови (поряд з `addRule('text')`), а `'adr'` вставлено в `AUTO_RULE_ORDER` на своє алфавітне місце. Створено `npm/rules/adr/auto.md` з вмістом `завжди` — конвенційний маркер для завжди-увімкнених правил (аналогічно `rules/text/auto.md`). Текст у `npm/rules/adr/adr.mdc` оновлено: «вмикається вручну» → «увімкнене за замовчуванням; вимикається через `disable-rules: ["adr"]`». Коментар у `sync-claude-config.mjs` приведено у відповідність. Тести у `auto-rules.test.mjs` оновлено: `'adr'` додано до `ALL_RULES` і до expected-масиву результату. Версія пакету: `1.11.15` → `1.11.16`, запис у `CHANGELOG.md` додано.

**Обґрунтування:** ADR-хук корисний у будь-якому проєкті, де використовується Claude Code — немає сенсу вимагати від кожної команди ручного підключення. Патерн `auto.md` з вмістом `завжди` вже реалізований для правила `text` і є стандартним механізмом у цьому пакеті. Явний `"adr"` у `.n-cursor.json` залишається валідним завдяки дедуплікації при merge, тобто зворотна сумісність не порушується.

**Розглянуті альтернативи:** Не обговорювались. Єдиний підхід — використати вже існуючий механізм `auto.md: завжди`, аналогічний правилу `text`.

**Зачіпає:** `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-rules.test.mjs`, `npm/rules/adr/auto.md` (новий файл), `npm/rules/adr/adr.mdc`, `npm/scripts/sync-claude-config.mjs`, `npm/package.json` (version bump), `npm/CHANGELOG.md`.
