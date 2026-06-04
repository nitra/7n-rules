---
session: 4fcd6586-f372-4b12-9595-ba3be85a3b64
captured: 2026-06-04T10:40:55+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4fcd6586-f372-4b12-9595-ba3be85a3b64.jsonl
---

## ADR Повторна реалізація `captureOutput` — приховування sync-виводу CLI за відсутності помилок

## Context and Problem Statement

`@nitra/cursor` CLI під час синхронізації правил/skills/commands/pi-skills друкує потоки рядків `⬇ … ✅` і підсумки `🧩 Skills: N скопійовано, 0 з помилками` навіть за повністю успішного прогону. Раніше це вже було виправлено (сесія 1 червня), але той коміт загубився під час rebase/merge і в `main` (`3.21.0`) відсутній. Відновлення потрібно щоб скоротити «шумний» вивід до дієвої інформації.

## Considered Options

* Обгорнути кожен із чотирьох sync-блоків у helper `captureOutput(action)`, що буферизує stdout/console і скидає буфер лише при `fail > 0`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "`captureOutput` helper з умовним flush", because перший варіант точно відтворює логіку втраченого коміту (задокументована в двох існуючих ADR) і не змінює видиму поведінку при помилках.

### Consequences

* Good, because за успішного прогону весь вивід чотирьох блоків (рядки `⬇ … ✅`, підсумки `🧩/⌨️/🥧 N скопійовано, 0 з помилками`) прихований — термінал показує лише `✨ Готово`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінений файл: `npm/bin/n-cursor.js` — додано `async function captureOutput(action)` після `runSyncStep`; обгорнуто чотири кроки: блок правил (`syncManagedRuleFiles`), `syncSkills`, `syncCommands`, `syncPiSkills`.
- Removal-логи (`🧹 Видалено…`) лишено поза буфером — вони рідкісні та несуть корисну інформацію.
- Change-файл: `npm/.changes/1780558729600-5bcd82.md` (bump: patch, section: Changed).
- Коміт: `bb8208e7 fix(cli): ховати блоки sync-виводу (правила/Skills/Commands/Pi) за fail=0`, злито в `main` через fast-forward.
- Бранч базувався на застарілому коміті `a600242b` (v3.19.0) → перебазовано на `origin/main` (v3.21.0) перед комітом.
- Lint-перевірка: `bunx oxlint npm/bin/n-cursor.js`; попередні `switch-case-braces` помилки належать pre-existing коду з `origin/main`.
