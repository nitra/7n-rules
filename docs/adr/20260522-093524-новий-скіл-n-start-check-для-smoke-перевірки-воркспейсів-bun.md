---
session: f52457cf-7c94-4e13-b7b8-51c75ac7cb9b
captured: 2026-05-22T09:35:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/f52457cf-7c94-4e13-b7b8-51c75ac7cb9b.jsonl
---

## ADR Новий скіл `n-start-check` для smoke-перевірки воркспейсів bun-монорепо

## Context and Problem Statement
У bun-монорепо не було автоматизованого способу перевірити, чи взагалі запускається кожен воркспейс. Потрібен скіл, який обходить всі воркспейси зі `start`-скриптом, запускає його й фіксує результат без зупинки на помилці.

## Considered Options
* Новий скіл `start-check` у `npm/skills/start-check/` за тим самим шаблоном (`SKILL.md` + `auto.md`), що й `taze`, `adr-normalize`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Новий скіл `start-check`", because структура пакета `@nitra/cursor` передбачає окрему директорію `npm/skills/<id>/` для кожного скіла; нова директорія `npm/skills/start-check/` з `SKILL.md` + `auto.md` ([bun]) відповідає цьому шаблону й автоматично видна в `n-cursor skill list` та тестах `auto-skills`.

### Consequences
* Good, because transcript фіксує очікувану користь: скіл видно в `node npm/bin/n-cursor.js skill list`, існуючі тести `auto-skills.test.mjs` / `skills-cli.test.mjs` проходять (19 pass, 0 fail) без жодних змін.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/start-check/SKILL.md` — інструкція скіла
- `npm/skills/start-check/auto.md` — умова активації `[bun]`
- `npm/scripts/auto-skills.test.mjs` — тест, що фіксує перелік скілів (ALL_SKILLS)
- Команда перевірки: `node npm/bin/n-cursor.js skill list`

---

## ADR `perl` + `alarm` як watchdog для обмеження часу запуску `start`

## Context and Problem Statement
Потрібно запустити `start`-скрипт воркспейсу на обмежений час (grace-період), щоб перевірити, чи dev-сервер стартує без негайного краху. macOS не має стандартної утиліти `timeout`.

## Considered Options
* Фоновий процес (`&`) + `sleep` + `kill -0` + ручний `kill`
* `perl -e 'alarm shift; exec @ARGV' 12 bun run start` — запропонований користувачем

## Decision Outcome
Chosen option: "`perl` + `alarm`", because `exec` зберігає той самий PID, тож SIGALRM б'є по справжньому процесі (не по обгортці); немає ручного юглінгу PID; код виходу сам класифікує результат: `142` (`128+14`) — дожив до таймауту (dev-сервер стартував → OK), `0` — завершився чисто (CLI-скрипт → OK), інше — крах.

### Consequences
* Good, because transcript фіксує очікувану користь: `CODE=142`, лог містить `VITE v8.0.10 ready in 355 ms`, порт 5173 вільний після завершення (orphan-процесів нема).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда watchdog: `perl -e 'alarm shift; exec @ARGV' 12 bun run start > /tmp/n-start-check.log 2>&1`
- `SIGALRM` додано до `.cspell.json` (words)
- Прогін на `demo/`: `CODE=142`, `VITE v8.0.10 ready in 355 ms`, `Local: http://localhost:5173/`

---

## ADR Pre-flight класифікація `start`-скриптів перед запуском smoke-перевірки

## Context and Problem Statement
Під час smoke-перевірки `npm`-воркспейса скрипт `start: bun ./bin/n-cursor.js` виявився CLI з мутаційним ефектом: запуск виконав повний sync, створив `npm/.cursor/`, `npm/.claude/`, `npm/.github/`, `npm/AGENTS.md`, `npm/CLAUDE.md`, `npm/.n-cursor.json`, додав devDependency і переписав `bun.lock`. Запуск наосліп будь-якого `start`-скрипта може зіпсувати репозиторій.

## Considered Options
* Запускати всі `start`-скрипти без аналізу їх змісту
* Pre-flight крок: читати команду `start`, класифікувати як «запуск сервера» або «CLI з мутаційним ефектом», другий тип — `SKIP`

## Decision Outcome
Chosen option: "Pre-flight класифікація `start`-скриптів", because blind-запуск `bun ./bin/n-cursor.js` у `npm/` під час smoke-перевірки виконав деструктивний sync, і transcript підтверджує: скіл мав повернути `SKIP` замість `OK` для такого воркспейсу.

### Consequences
* Good, because transcript фіксує очікувану користь: з новою логікою `npm` отримує `SKIP (start не піднімає сервер)` замість оманливого `OK`; побічні ефекти не виникають.
* Bad, because класифікація потребує евристики (аналіз рядка команди `start`), яка може дати хибнегативний результат для нестандартних імен серверів.

## More Information
- Виявлені артефакти після сліпого запуску: `npm/.cursor/`, `npm/.claude/`, `npm/.github/`, `npm/.gitignore`, `npm/.n-cursor.json`, `npm/AGENTS.md`, `npm/CLAUDE.md`; devDependency `@nitra/cursor: ^1.13.74` у `npm/package.json`; перезапис `bun.lock`
- Очищення: `rm -rf npm/.claude npm/.cursor npm/.github ...` + `git checkout -- npm/package.json bun.lock`
- Оновлений крок «3. Pre-flight» у `npm/skills/start-check/SKILL.md`
- `start: bun ./bin/n-cursor.js` у `npm/package.json` — staged-зміна, порушує конвенцію `start` як запуску застосунку
