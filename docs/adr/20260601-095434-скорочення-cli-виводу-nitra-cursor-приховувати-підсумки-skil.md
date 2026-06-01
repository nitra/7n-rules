---
session: 6022431a-756a-49cc-9926-a65d6eff12c2
captured: 2026-06-01T09:54:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6022431a-756a-49cc-9926-a65d6eff12c2.jsonl
---

## ADR Скорочення CLI-виводу `@nitra/cursor`: приховувати підсумки Skills/Commands без помилок

## Context and Problem Statement
`npx @nitra/cursor` виводить підсумкові рядки `🧩 Skills: N скопійовано, 0 з помилками` та `⌨️ Commands: N скопійовано, 0 з помилками` навіть у разі повністю успішного виконання. Ці рядки додають шум до виводу, не несучи корисної інформації для користувача.

## Considered Options
* Приховати секцію повністю, якщо `failCount === 0`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Приховати секцію повністю, якщо `failCount === 0`", because користувач явно попросив: "не відображались взагалі якщо там немає помилок".

### Consequences
* Good, because CLI-вивід стає лаконічнішим: підсумки Skills і Commands показуються лише тоді, коли потребують уваги.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни стосуються `npm/bin/n-cursor.js` — рядки ≈ 1358–1362 (блок `syncSkills`) і аналогічний блок для `Commands`. Логіка: якщо `failCount === 0`, `console.log` з підсумком не викликається. Тест-файли `npm/scripts/tests/auto-skills.test.mjs` і `sync-claude-config.test.mjs` можуть потребувати оновлення assertions на очікуваний вивід.
