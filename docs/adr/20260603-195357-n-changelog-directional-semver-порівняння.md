# n-changelog: directional semver-порівняння у consistency check

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement

Pre-commit хук `npm-changelog` (`npm/rules/changelog/js/consistency.mjs`) порівнював `version` у `package.json` з опублікованою версією у реєстрі через оператор `!==` — без урахування напрямку. Після CI-релізу `@nitra/cursor@3.20.0` (коміт `fa06a6c5`) локальна гілка, яку ще не підтягнули (`git pull`), мала `3.19.0` — менше опублікованої. Хук блокував коміт із повідомленням «ручний bump заборонено», хоча жодного ручного bump не було: локальна версія просто відставала від вже випущеного CI-релізу.

## Considered Options

* Directional semver-порівняння: `version > опублікованої` → fail; `version < опублікованої` → pass із підказкою «локаль відстала від реєстру».
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Directional semver-порівняння", because лише `version > опублікованої` (або git-бази) означає ручний bump поза CI; `version < опублікованої` означає, що локаль відстала від вже випущеного CI-релізу — `git push` все одно заблокується non-fast-forward, тому додатковий бар'єр у pre-commit зайвий.

### Consequences

* Good, because після фіксу прогін перевірки показує `✅ npm: version (3.19.0) позаду опублікованої (3.20.0) — локаль відстала від реєстру; це не ручний bump`; коміт більше не блокується без попереднього `git pull`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/rules/changelog/js/consistency.mjs` — хелпери `compareSemverCore`, `versionIsAhead`; патч застосовано до published-шляху та local-only git-base шляху.
- `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs` — 3 нових тест-кейси; 103/103 тестів пройшли після змін.
- Change-файл: `npm/.changes/1780505556620-0f7c17.md`.
- Відтворення помилки: `git show origin/main:npm/package.json` → `3.20.0` при локальній `3.19.0` (не підтягнута після CI-релізу).
