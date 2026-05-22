---
session: f52457cf-7c94-4e13-b7b8-51c75ac7cb9b
captured: 2026-05-22T09:45:57+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/f52457cf-7c94-4e13-b7b8-51c75ac7cb9b.jsonl
---

## ADR Новий скіл `n-start-check` для smoke-перевірки воркспейсів bun-монорепо

## Context and Problem Statement
У bun-монорепо не було автоматизованого способу перевірити, чи кожен воркспейс взагалі запускається. Потрібен скіл, який обходить усі воркспейси зі `start`-скриптом і фіксує результат — без ручного втручання.

## Considered Options
* Новий скіл `start-check` у `npm/skills/start-check/` за наявним паттерном пакета `@nitra/cursor`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Новий скіл `start-check` у `npm/skills/start-check/`", because це відповідає наявній структурі пакета (кожен скіл — `SKILL.md` + `auto.md`), автодетект через `auto.md: [bun]` відповідає паттерну `taze`.

### Consequences
* Good, because transcript фіксує очікувану користь: скіл виявив, що `npm/start` є мутаційним CLI, і правила відкату захистили репо від побічних ефектів прогону.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файли: `npm/skills/start-check/SKILL.md`, `npm/skills/start-check/auto.md`, `.cursor/skills/n-start-check/SKILL.md`
- `auto.md` містить `[bun]` — скіл активується в bun-монорепо автоматично (такий самий механізм, як у `taze`)
- Таймаут реалізовано через `perl -e 'alarm shift; exec @ARGV' 12 bun run start` — `CODE=142` (`128+14`, SIGALRM) означає, що dev-сервер дожив до кінця grace-периоду → OK; `CODE=0` — CLI завершився сам → OK; інше → FAIL
- Крок 5 скіла: перед кожним прогоном знімок `git status --porcelain > /tmp/n-start-check.before`; після — diff зі знімком, нові untracked-файли видаляються, новозмінені tracked-файли відкочуються через `git checkout`, те що було брудним до прогону — не чіпається
- `SKIP` лишився тільки для воркспейсів без `start`-скрипта взагалі
- `SIGALRM` додано до `.cspell.json`

---

## ADR Механізм таймауту для smoke-перевірки `start`-скриптів через `perl alarm`

## Context and Problem Statement
macOS не має `timeout` як стандартної утиліти. Потрібен портабельний спосіб обмежити час виконання `start`-скрипта з коректною передачею сигналу та однозначним кодом виходу.

## Considered Options
* `perl -e 'alarm shift; exec @ARGV' 12 bun run start`
* Фоновий процес (`&`) + `sleep` + `kill` (початкова реалізація в скілі)

## Decision Outcome
Chosen option: "`perl -e 'alarm shift; exec @ARGV'`", because користувач явно запропонував цей підхід як кращий: `exec` зберігає PID процесу, SIGALRM б'є по справжньому процесі, немає ручного юглінгу PID/`kill -0`/`wait`, код виходу `142` сам класифікує результат.

### Consequences
* Good, because transcript фіксує очікувану користь: `CODE=142` чітко відрізняє живий dev-сервер від краху; orphan-процесів після прогону не лишається (підтверджено `lsof -ti tcp:5173`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `perl -e 'alarm shift; exec @ARGV' 12 bun run start > /tmp/n-start-check.log 2>&1`
- Інтерпретація коду виходу: `142` = дожив до таймауту (dev-сервер → OK), `0` = завершився сам (CLI → OK), інше = FAIL
- Перший варіант (фоновий процес) прибрано з `SKILL.md` після заміни на `perl`
