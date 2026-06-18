---
type: ADR
title: "Відновлення `captureOutput` для приховування sync-виводу CLI за відсутності помилок"
---

# Відновлення `captureOutput` для приховування sync-виводу CLI за відсутності помилок

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

`@nitra/cursor` CLI під час синхронізації правил/skills/commands/pi-skills друкує рядки `⬇ … ✅` і підсумки (`🧩 Skills`, `⌨️ Commands`, `🥧 Pi skills`) навіть за повністю успішного прогону. Реалізація вже існувала (сесія 2026-06-01, коміт `20a0e24`), але загубилась під час rebase/merge — `git log -S "captureOutput" --all -- npm/bin/n-cursor.js` повертає порожній результат. В `main` (версія 3.21.0) відсутня.

## Considered Options

* Обгорнути кожен sync-блок у helper `captureOutput(action)`, що буферизує stdout/console і скидає буфер лише при `fail > 0`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "`captureOutput` helper з умовним flush", because підхід точно відтворює логіку втраченого коміту, задокументовану у двох існуючих ADR від 2026-06-01, і не змінює видиму поведінку при помилках.

### Consequences

* Good, because за успішного прогону весь вивід чотирьох блоків (рядки `⬇ … ✅`, підсумки `🧩/⌨️/🥧 N скопійовано, 0 з помилками`) прихований — термінал показує лише `✨ Готово`.
* Neutral, because removal-логи (`🧹 Видалено…`) залишені поза буфером навмисно — вони рідкісні та несуть корисну інформацію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінений файл: `npm/bin/n-cursor.js` — `async function captureOutput(action)` після `runSyncStep`; обгорнуто: `syncManagedRuleFiles`, `syncSkills`, `syncCommands`, `syncPiSkills`.
- Перехоплення stdout: `process.stdout.write = (...args) => { buffer.push(...); ... }` (rest-параметри — уникнення `jsdoc/require-param` помилки oxlint).
- Change-файл: `npm/.changes/1780558729600-5bcd82.md` (patch, section: Changed).
- Коміт: `bb8208e7 fix(cli): ховати блоки sync-виводу (правила/Skills/Commands/Pi) за fail=0` (fast-forward в `main`).
- Базова гілка перебазована з `a600242b` (v3.19.0) на `origin/main` (v3.21.0) перед комітом.
- Попередня документація: `docs/adr/20260601-095434-n-cursor-cli-приховати-підсумки-без-помилок.md`.

## Update 2026-06-04

### Поширення `captureOutput` на блок синхронізації правил

Під час верифікації відновленого фіксу виявлено, що блок правил (`syncManagedRuleFiles`) також друкував `⬇ rule → … ✅` (~19 рядків) за повністю успішного прогону — ідентична проблема до блоків Skills/Commands/Pi. Рішення: обгорнути виклик `syncManagedRuleFiles` у `captureOutput` з тим самим критерієм (`failCount > 0` → flush буфера). Лог `removeOrphanManagedFiles` залишено поза буфером — він рідкісний і несе корисну інформацію. Smoke-прогон після зміни: вивід містить лише `📋 Правил до завантаження: N` і `✨ Готово`; рядки `⬇ rule → … ✅` відсутні. Change-файл `.changes/1780490107951-96db7d.md` розширено до «ховати блоки правил / 🧩 Skills / ⌨️ Commands / 🥧 Pi skills за fail=0».

## Update 2026-06-04

Повторна реалізація: коміт `20a0e24` із попередньої сесії загубився при rebase на `origin/main` — ADR-файли вціліли, код ні.

Додатково до попереднього кроку (правила/Skills/Commands/Pi, коміт `bb8208e7`) — коміт `fdcdf6ce` обгортає через `captureOutput` ще 4 sync-кроки: `setup-bun-deps`, `AGENTS`, `CLAUDE`, `Claude-конфіг`. Усього 8 sync-кроків приховані за успіху.

Вивід `npx @nitra/cursor` за успіху: `🔧` → `📌/📦` → `📋 N правил` → `✨ Готово: N завантажено, 0 з помилками`. Рядки `⬇ … ✅` і `📝 …` зʼявляються лише при `fail > 0` або throw.

Change-файли: `npm/.changes/1780558729600-5bcd82.md`, `npm/.changes/260604-1051.md` (`patch/Changed`). Push: `origin/main` → `fdcdf6ce`.
