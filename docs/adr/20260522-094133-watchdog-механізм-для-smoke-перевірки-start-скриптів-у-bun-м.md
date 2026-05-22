---
session: f52457cf-7c94-4e13-b7b8-51c75ac7cb9b
captured: 2026-05-22T09:41:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/f52457cf-7c94-4e13-b7b8-51c75ac7cb9b.jsonl
---

## ADR Watchdog-механізм для smoke-перевірки `start`-скриптів у bun-монорепо

## Context and Problem Statement
У bun-монорепо `start`-скрипт часто піднімає довгоживучий dev-сервер, який ніколи не завершується сам. Smoke-перевірка має зупинити процес після grace-period і визначити за кодом виходу, чи стартував застосунок без краху.

## Considered Options
* Фоновий процес (`&`) + `sleep 12` + `kill -0` / `kill $PID` + `wait`
* `perl -e 'alarm shift; exec @ARGV' 12 bun run start`

## Decision Outcome
Chosen option: "`perl -e 'alarm shift; exec @ARGV' 12 bun run start`", because `exec` зберігає той самий PID — SIGALRM б'є по справжньому процесі, а не по оболонці; немає ручного юглінгу PID; код виходу `142` (`128+14`) однозначно сигналізує «дожив до кінця grace-period».

### Consequences
* Good, because transcript фіксує очікувану користь: `CODE=142`, `VITE v8.0.10 ready in 355 ms` — сервер визнано запущеним без краху, orphan-процесів після прогону нема.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команда watchdog: `perl -e 'alarm shift; exec @ARGV' 12 bun run start > /tmp/n-start-check.log 2>&1`.
Класифікація коду виходу: `142` → dev-сервер OK; `0` → CLI-скрипт OK; інше → FAIL.
Файли: `npm/skills/start-check/SKILL.md`, `.cursor/skills/n-start-check/SKILL.md`.

---

## ADR Стратегія обробки мутаційних `start`-скриптів: git-знімок + rollback замість SKIP

## Context and Problem Statement
Під час першого прогону скіла `npm/start` виявився `bun ./bin/n-cursor.js` — CLI, що виконує повний sync: додав `devDependencies`, перезаписав `bun.lock`, створив `.cursor/`, `.claude/`, `.github/`, `AGENTS.md`, `CLAUDE.md`. Smoke-тест виконав деструктивну роботу замість пасивної перевірки.

## Considered Options
* Pre-flight: аналізувати команду `start`, пропускати (`SKIP`) воркспейси з мутаційним `start`
* Завжди запускати `start`, але фіксувати git-знімок до прогону й відкочувати побічні ефекти після

## Decision Outcome
Chosen option: "git-знімок + rollback", because користувач явно сказав «не скіпився запуск» — скіл має завжди прогонити `start`, не оцінюючи наміру команди.

### Consequences
* Good, because transcript фіксує очікувану користь: `start` виконується для кожного воркспейсу без винятків; `SKIP` вживається лише для воркспейсів без `scripts.start`.
* Bad, because transcript не містить підтверджених негативних наслідків; логіка відкату покладається на `git checkout -- <files>` і `rm -rf` для нових файлів, що потребує коректного стану git-індексу до прогону.

## More Information
Побічні ефекти першого прогону прибирались вручну: `rm -rf npm/.claude npm/.cursor npm/.github npm/.gitignore npm/.n-cursor.json npm/AGENTS.md npm/CLAUDE.md && git checkout -- npm/package.json bun.lock`.
Нова логіка у `SKILL.md` (крок 3): перед запуском зберегти `git status --porcelain` як базовий знімок; після зупинки процесу — відкотити лише нові зміни, що з'явилися під час прогону, не чіпаючи вже брудні файли (робота користувача).
Файли: `npm/skills/start-check/SKILL.md`, `.cursor/skills/n-start-check/SKILL.md`.
