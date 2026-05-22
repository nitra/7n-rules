---
session: f52457cf-7c94-4e13-b7b8-51c75ac7cb9b
captured: 2026-05-22T09:11:20+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/f52457cf-7c94-4e13-b7b8-51c75ac7cb9b.jsonl
---

## ADR Новий скіл `n-start-check` для smoke-перевірки воркспейсів bun-монорепо

## Context and Problem Statement
У bun-монорепо проектах не було автоматизованого способу перевірити, чи `start`-скрипт кожного воркспейсу взагалі запускається без негайного краші. Потрібен скіл, який обходить усі воркспейси й перевіряє їх запуск.

## Considered Options
* Створити новий скіл `start-check` у `npm/skills/start-check/` за існуючим патерном (`SKILL.md` + `auto.md`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Новий скіл `start-check` за існуючим патерном", because структура `npm/skills/<id>/SKILL.md` + `auto.md` вже використовується для всіх скілів (`abie-clean`, `taze`, `adr-normalize` тощо) і CLI `n-cursor.js skill list` підхоплює нові скіли автоматично.

### Consequences
* Good, because `node npm/bin/n-cursor.js skill list` одразу показав `start-check` у списку без жодних змін до реєстру чи конфігу.
* Good, because умова `[bun]` в `auto.md` забезпечує автоматичне включення скілу тільки в bun-проектах — так само як у `taze`.
* Good, because тести `auto-skills.test.mjs` (19 pass, 0 fail) не зламалися після додавання скілу — існуючий hardcoded список `ALL_SKILLS` в тестах не потребував оновлення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/start-check/SKILL.md` — інструкція скілу `n-start-check`
- `npm/skills/start-check/auto.md` — умова активації: `[bun]`
- Команда перевірки: `node npm/bin/n-cursor.js skill list`
- Команда тестів: `bun test npm/scripts/auto-skills.test.mjs npm/scripts/skills-cli.test.mjs`
- Після синку: `npx @nitra/cursor sync` або `bun run sync` — скіл з'явиться в `.n-cursor.json` цільових проєктів
