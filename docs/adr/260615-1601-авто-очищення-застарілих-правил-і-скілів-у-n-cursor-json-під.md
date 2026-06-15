---
session: db494459-ac55-4cb8-8b42-b0365f52f004
captured: 2026-06-15T16:01:53+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/db494459-ac55-4cb8-8b42-b0365f52f004.jsonl
---

## ADR Авто-очищення застарілих правил і скілів у `.n-cursor.json` під час sync

## Context and Problem Statement
При виконанні `npx @nitra/cursor` (sync) записи у `rules` та `skills` в `.n-cursor.json`, яких більше немає в поточній версії bundled-пакету, спричиняли помилки (`EISDIR`, "Немає каталогу в пакеті", "Немає файлу … Оновіть @nitra/cursor або приберіть…") замість автоматичного видалення. Користувач мусив вручну правити `.n-cursor.json` після кожного оновлення пакету, де окремі rules/skills зникли або перейменувались.

## Considered Options
* Додати pruning-логіку в `mergeConfigWithAutoDetected` у `scripts/auto-rules.mjs`, передаючи множини доступних bundled-назв
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати pruning-логіку в `mergeConfigWithAutoDetected`", because функція вже є єдиним місцем злиття конфігу й автодетекту, вже exported і покрита тестами — розширення її підписом `availableRules`/`availableSkills` не потребувало нового шару в bin.

### Consequences
* Good, because transcript фіксує очікувану користь: sync більше не падає на відсутніх entries — вони мовчки видаляються; 51 тест пройшов після змін, ESLint — без помилок.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `scripts/auto-rules.mjs` (розширено підпис `mergeConfigWithAutoDetected`), `bin/n-cursor.js` (передача `availableRules`/`availableSkills` та логування pruned entries), `scripts/tests/auto-rules.test.mjs` (нові тести pruning), `scripts/docs/auto-rules.md` (оновлено CRC: `d50b922f`), `bin/docs/n-cursor.md` (оновлено опис `normalizeConfigWithAutoRules`).
- CRC перераховувався через `rules/doc-files/js/docgen-crc.mjs` → `crc32(readFileSync("scripts/auto-rules.mjs"))` після кожної зміни source-файлу.
- Тести запускались командою: `npx vitest run scripts/tests/auto-rules.test.mjs`.
