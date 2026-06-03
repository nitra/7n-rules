---
session: 2384f9e3-23ee-4352-81e6-6eed553c34d8
captured: 2026-06-03T19:53:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/2384f9e3-23ee-4352-81e6-6eed553c34d8.jsonl
---

## ADR Жорсткий root-guard для деструктивних CLI-команд `@nitra/cursor`

## Context and Problem Statement
Прямий виклик `bun npm/bin/n-cursor.js` (без `bun run start`) успадковує `cwd` місця виклику. Дефолтний sync і сабкоманди `fix`, `lint`, `coverage`, `change`, `release` записують `.cursor/`, `.claude/`, `CLAUDE.md`, `.n-cursor.json` і виконують `bun install` у `cwd()` — якщо `cwd` є піддиректорією git-репо, артефакти потрапляють не туди. Попередніх програмних перевірок не існувало.

## Considered Options
* Жорсткий програмний guard у диспетчері `bin/n-cursor.js` через `git rev-parse --show-toplevel`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Жорсткий програмний guard у диспетчері", because перевірка на рівні LLM-інструкцій (soft-preflight) не є надійним захистом — агент може її пропустити. Guard реалізовано у `npm/scripts/lib/assert-project-root.mjs` (`assertCwdIsProjectRoot`) і викликається до перших мутацій для набору `ROOT_GUARDED_COMMANDS` = `{default-sync, fix, check, lint, coverage, change, release}`. Поза git-репо (toplevel невідомий) — guard пропускається, щоб не ламати легітимні сценарії. Read-only та `--root`-команди не зачіпаються.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun ./n-cursor.js fix` з `npm/bin/` → `exit=1` з підказкою `cd <root>`, без жодних скаффолдованих файлів у піддиректорії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Ключові файли: `npm/scripts/lib/assert-project-root.mjs`, `npm/bin/n-cursor.js` (константа `ROOT_GUARDED_COMMANDS`, функція `describeRootGuardedAction`). Тест: `npm/scripts/lib/tests/assert-project-root.test.mjs` (3/3). Change-файл: `npm/.changes/1780502307466-1f274e.md`.

---

## ADR `requireRoot` як декларативний атрибут захисту в `meta.json` скіла

## Context and Problem Statement
Після реалізації CLI hard-guard постало питання: як позначити для людей і тулінгу, чи активовано root-захист для конкретного скіла, особливо для in-place скілів (`worktree: false`), що мутують проєкт у `cwd`. Раніше `worktree: true` неявно означало захист (через preflight), але для in-place скілів явного прапора не існувало.

## Considered Options
* Явний булевий атрибут `requireRoot` у `meta.json` + похідна функція `skillRequiresRoot(meta)`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Явний `requireRoot` у `meta.json`", because користувач запропонував «може логічно це винести також атрибутом у `meta.json`, щоб мати явний признак активовано захист чи ні». Похідна `skillRequiresRoot` = `worktree === true || requireRoot === true`: worktree-скіли захищені неявно (корінь worktree = toplevel), тому `requireRoot` для них надлишковий. Валідатор (`npm-module/js/skill_meta.mjs`) перевіряє: `requireRoot` — опційний boolean; комбінація `worktree: true + requireRoot: false` — fail як суперечність. Sync вшиває `injectRootNotice` у `SKILL.md` in-place скілів з `requireRoot: true`.

### Consequences
* Good, because transcript фіксує очікувану користь: явна декларативна ознака в одному місці (`meta.json`) дозволяє як тулінгу, так і людині однозначно встановити, чи захищений скіл.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lib/skill-meta.mjs` (функція `skillRequiresRoot`), `npm/scripts/lib/root-notice.mjs` (`injectRootNotice`), `npm/rules/npm-module/js/skill_meta.mjs` (валідація), `npm/scripts/lib/worktree-notice.mjs` (підсилений preflight). `meta.json` зміни: `start-check: requireRoot: true`; `llm-patch`, `publish-telegram`, `worktree`: `requireRoot: false`. Тести: `npm/scripts/lib/tests/root-notice.test.mjs`, `npm/rules/npm-module/js/tests/skill_meta.test.mjs`. Усього 599/599 тестів зелених після змін.

---

## ADR Directional-порівняння версій у `n-changelog` consistency check

## Context and Problem Statement
Pre-commit хук `npm-changelog` порівнював `version` у `package.json` з опублікованою версією через `!==` — без урахування напрямку. Після CI-релізу `@nitra/cursor@3.20.0` (коміт `fa06a6c5`) локальна гілка, ще не підтягнута (`git pull`), містила `3.19.0`, що менше опублікованої. Хук блокував коміт із повідомленням «ручний bump заборонено», хоча жодного ручного bump не було — версія просто відставала від CI-релізу.

## Considered Options
* Directional semver-порівняння: `version > опублікованої` → fail; `version < опублікованої` → pass із підказкою «локаль відстала»
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Directional semver-порівняння", because лише `version > опублікованої` (або git-бази) означає ручний bump поза CI; `version < опублікованої` означає, що локаль відстала від уже випущеного CI-релізу — `git push` все одно заблокується non-fast-forward, тому додатковий бар'єр у pre-commit зайвий.

### Consequences
* Good, because transcript фіксує очікувану користь: після фіксу реальний прогін перевірки показує `✅ npm: version (3.19.0) позаду опублікованої (3.20.0) — локаль відстала від реєстру; це не ручний bump`; коміт більше не блокується без `git pull`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/changelog/js/consistency.mjs` (хелпери `compareSemverCore`, `versionIsAhead`; патч у published-шляху та local-only git-base шляху). Тести: `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs` (3 нових кейси; 103/103 усього). Change-файл: `npm/.changes/1780505556620-0f7c17.md`. Відтворення: `git show origin/main:npm/package.json` → `3.20.0` при локальній `3.19.0`.
