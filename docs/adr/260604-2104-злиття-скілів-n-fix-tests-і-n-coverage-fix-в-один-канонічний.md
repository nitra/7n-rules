---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-04T21:04:37+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

## ADR Злиття скілів `n-fix-tests` і `n-coverage-fix` в один канонічний скіл

## Context and Problem Statement

Існували два скіли — `n-coverage-fix` і `n-fix-tests` — з метою підвищення mutation score. Аналіз показав ~95% дубляцію: однаковий preflight-блок, логіка диспатчу Agent, промпт і кроки 4–5. `n-fix-tests` відрізнявся лише точкою входу (стартував з готового `COVERAGE.md` замість генерації) і детекцією команд із `package.json#scripts`. Будь-яка зміна preflight/промпта потребувала синхронних правок в обох файлах — джерело дрейфу.

## Considered Options

* Лишити обидва скіли, усунути лише дублювання через спільний include/фрагмент
* Злити `n-fix-tests` у `n-coverage-fix` як канонічний, видалити `n-fix-tests`
* Зробити `n-fix-tests` тонким shim-аліасом без повного видалення

## Decision Outcome

Chosen option: "Злити `n-fix-tests` у `n-coverage-fix` як канонічний, видалити `n-fix-tests`", because `coverage-fix` був повнішим (ліміт 3 ітерацій, анти-паралель-блок із поясненням `incremental.json`/`mutation.json`, нотатки про Stryker incremental). Унікальну цінність `fix-tests` — детекцію `test`/`coverage`-команд із `package.json#scripts` і сценарій early-skip для готового `COVERAGE.md` — поглинуто в `coverage-fix`.

### Consequences

* Good, because transcript фіксує очікувану користь: одне джерело правди для `SKILL.md`, усуває ризик дрейфу між двома файлами при наступних правках preflight або промпта.
* Good, because один скіл тепер покриває обидва entry-point: «згенеруй `COVERAGE.md` і фіксь» та «фіксь по вже готовому звіту» — через early-skip у Кроці 1.
* Good, because команди `test`/`coverage` більше не хардкодяться: скіл читає `package.json#scripts` і адаптується до проєкту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Джерело правди — `npm/skills/coverage-fix/SKILL.md`; `.cursor/skills/n-coverage-fix/` і `.pi/skills/n-fix-tests/` — похідні копії, що генеруються синком. Дефолтний синк тягне опубліковану версію пакета, тому похідні оновлювалися вручну.
- Видалено через `git rm`: `npm/skills/fix-tests/`, `.cursor/skills/n-fix-tests/`, `.pi/skills/n-fix-tests/`, `.claude/commands/n-fix-tests.md`.
- `fix-tests` видалено з масиву `skills` у `.n-cursor.json`.
- Рядки `n-fix-tests` прибрано з `AGENTS.md` і `CLAUDE.md`.
- JSDoc у `npm/rules/test/coverage/coverage.mjs` і назва тесту в `coverage.test.mjs` оновлені `/n-fix-tests` → `/n-coverage-fix`.
- Change-файл: `npm/.changes/260604-1957.md` (`bump: minor`, `section: Removed`).
- Документація скіла: `docs/coverage-fix-skill.md`.
- 86 тестів `coverage.test.mjs` і 27 тестів `skills-cli`/`auto-skills` — зелені після змін.
