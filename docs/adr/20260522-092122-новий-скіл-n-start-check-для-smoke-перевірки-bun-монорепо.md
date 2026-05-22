---
session: f52457cf-7c94-4e13-b7b8-51c75ac7cb9b
captured: 2026-05-22T09:21:22+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/f52457cf-7c94-4e13-b7b8-51c75ac7cb9b.jsonl
---

## ADR Новий скіл `n-start-check` для smoke-перевірки bun-монорепо

## Context and Problem Statement
У bun-монорепо немає автоматизованого способу переконатися, що кожен воркспейс здатний взагалі запуститися. Потрібен діагностичний скіл, який обходить усі воркспейси й виконує `start`-скрипт як smoke-перевірку.

## Considered Options
* Один новий скіл у `npm/skills/start-check/` — `SKILL.md` з інструкцією + `auto.md` з умовою активації
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Скіл у `npm/skills/start-check/`", because це відповідає наявній структурі пакета (`npm/skills/<id>/SKILL.md` + `auto.md`) і дозволяє автоактивуватися в bun-монорепо через умову `[bun]` в `auto.md` — так само як скіл `taze`.

### Consequences
* Good, because transcript фіксує очікувану користь: скіл видно в `n-cursor skill list` після запуску CLI, тести `auto-skills.test.mjs` та `skills-cli.test.mjs` проходять (19 pass, 0 fail) без будь-яких змін.
* Bad, because скіл з'являється у конкретному проєкті лише після наступного синку `n-cursor` — у `.cursor/skills/n-start-check/` він відсутній до синхронізації.

## More Information
- Створено: `npm/skills/start-check/SKILL.md`, `npm/skills/start-check/auto.md`
- Умова автоактивації: `[bun]` (аналогічно до `taze`)
- Перевірка: `node npm/bin/n-cursor.js skill list` показує `start-check`; `node npm/bin/n-cursor.js skill n-start-check` успішно збирає промпт
- Тести: `bun test npm/scripts/auto-skills.test.mjs npm/scripts/skills-cli.test.mjs`

---

## ADR `perl alarm` замість background-watchdog для таймауту `start`-скрипта

## Context and Problem Statement
macOS не має утиліти `timeout` у стандартній поставці. Для dev-серверів (довготривалі `start`-процеси) потрібно обмежити час виконання, щоб smoke-перевірка не зависла назавжди.

## Considered Options
* Background-процес + `sleep` + `kill` (початковий підхід у SKILL.md)
* `perl -e 'alarm shift; exec @ARGV' <N> <command>` — однорядковий таймаут через `alarm(2)`

## Decision Outcome
Chosen option: "`perl alarm`", because користувач явно запропонував цей підхід (навів приклад `perl -e 'alarm shift; exec @ARGV' 10 kubectl get pods -A`), а він є чистішим: `exec` зберігає PID процесу, тож `SIGALRM` потрапляє безпосередньо в цільовий процес, а код виходу `142` сам стає маркером «дожив до таймауту» без додаткового аналізу.

### Consequences
* Good, because transcript фіксує очікувану користь: однорядковий запис замість трирядкового watchdog-блоку; `exec` зберігає коректний PID; `SIGALRM` б'є по реальному процесі, а не по bash-обгортці.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Приклад із transcript: `perl -e 'alarm shift; exec @ARGV' 10 kubectl get pods -A`
- Змінено в `npm/skills/start-check/SKILL.md`: розділ з watchdog замінено на `perl alarm`-рядок
- Додано `SIGALRM` до `.cspell.json` (поле `words`) для уникнення помилок cspell на цьому ідентифікаторі
