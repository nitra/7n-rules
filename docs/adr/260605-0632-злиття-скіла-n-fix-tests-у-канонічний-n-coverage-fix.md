---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-05T06:32:00+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

## ADR Злиття скіла n-fix-tests у канонічний n-coverage-fix

## Context and Problem Statement
Два скіли — `n-coverage-fix` та `n-fix-tests` — мали ~95% дубльованого коду: той самий preflight-блок, промпт для Agent, Кроки 3–5 байт-у-байт. `n-fix-tests` відрізнявся лише точкою входу (очікував готовий `COVERAGE.md`) і детекцією команд з `package.json#scripts`. Дублювання означало два джерела правди: будь-яка правка мала робитись двічі й уже розійшлася (різні суфікси worktree, дрібні формулювання).

## Considered Options
* Видалити `n-fix-tests`, увібрати його унікальний функціонал у `n-coverage-fix`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `n-fix-tests`, увібрати функціонал у `n-coverage-fix`", because `n-fix-tests` є строгою підмножиною `n-coverage-fix` (~95% дубль) і зберігати два окремі скіли означало ризик дрейфу між двома файлами.

### Consequences
* Good, because `n-coverage-fix` тепер покриває обидва сценарії: «згенеруй `COVERAGE.md` і фіксь» та «фіксь по вже готовому звіту» — early-skip у Кроці 1, якщо звіт свіжий.
* Good, because детекція `test`/`coverage`-команд з `package.json#scripts` (унікальна перевага `n-fix-tests`) перенесена в `n-coverage-fix` — скіл більше не хардкодить `n-cursor coverage`/`bun test`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Джерело правди: `npm/skills/coverage-fix/SKILL.md` (тіло без worktree-преамбули; `.cursor/skills/n-coverage-fix/SKILL.md` — згенерована копія).
- Видалено через `git rm`: `npm/skills/fix-tests/`, `.cursor/skills/n-fix-tests/`, `.pi/skills/n-fix-tests/`, `.claude/commands/n-fix-tests.md`.
- Прибрано запис `"fix-tests"` з `.n-cursor.json#skills`.
- Рядки `n-fix-tests` видалено з `AGENTS.md`, `CLAUDE.md`; посилання `/n-fix-tests` → `/n-coverage-fix` оновлено в JSDoc `npm/rules/test/coverage/coverage.mjs` та назві тесту в `npm/rules/test/coverage/tests/coverage.test.mjs`.
- Change-файл: `npm/.changes/260604-1957.md` (Removed, minor).

---

## ADR CLI-екстрактор `n-cursor coverage-fix index|slice` — патерн «скрипт парсить, агент отримує зріз»

## Context and Problem Statement
`COVERAGE.md` у проєкті важить ~2.76 МБ (~700K токенів) і містить 122 групи вцілілих мутантів. `SKILL.md` `n-coverage-fix` давав агенту-оркестратору команду «прочитай `COVERAGE.md` і розбери JSON-масив» — це завантажувало весь документ у контекст LLM. Додатково: формат огорожі JSON-блоку нестабільний (oxfmt підвищує 3 бектики до 4, якщо вміст містить ` ``` `), що робило ручний розбір ненадійним.

## Considered Options
* Новий read-only CLI `n-cursor coverage-fix index` (компактний JSON-індекс груп) + `slice --file <path>` (самодостатній промпт для одного файлу)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "CLI-екстрактор `index|slice`", because детермінований парсинг виконується у скрипті за 0 LLM-токенів; агент-оркестратор отримує `index` (~7.4 КБ / ~2K токенів), субагент — `slice` (~10 КБ / ~3K токенів) замість 2.76 МБ (~700K токенів) повного `COVERAGE.md`.

### Consequences
* Good, because transcript фіксує заміряний виграш: `index` = 7.4 КБ (122 групи / 7982 мутанти) проти 2.76 МБ — ≈350× менше токенів для оркестратора.
* Good, because парсер коректно обробляє 3- і 4-бектикову огорожу — шукає закриття по `\n<fence>`, де `fence` визначається динамічно.
* Good, because патерн зафіксовано як стандарт для всіх фан-аут скілів проєкту (збережено в пам'яті `feedback_script_parses_agent_gets_slice`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Модуль: `npm/scripts/coverage-fix-extract.mjs`; exports: `parseSurvivedBlock`, `buildIndex`, `readSurvived`, `runCoverageFixCli`.
- `buildFixPrompt` у `npm/scripts/coverage-fix.mjs` виставлено як `export async function` для переви­користання.
- CLI dispatch: `case 'coverage-fix'` у `npm/bin/n-cursor.js` (read-only, не входить до `ROOT_GUARDED_COMMANDS`).
- Тести: `npm/scripts/tests/coverage-fix-extract.test.mjs` — 16 кейсів (3/4-бектики, невалідний JSON, не-масив, `index`/`slice` CLI, cwd-ін'єкція через `opts.cwd`).
- `SKILL.md` Кроки 2, 3, 5 переписано: `n-cursor coverage-fix index` замість прямого читання `COVERAGE.md`; `n-cursor coverage-fix slice --file <path>` у субагента; лічба `newCount` у Кроці 5 теж через `index`.
- Smoke-тест на реальному `COVERAGE.md`: `index` exit 0 (7428 байт, 122 групи), `slice --file npm/bin/rename-yaml-extensions.mjs` exit 0 (10146 байт).
- Change-файл: `npm/.changes/260604-2133.md` (Added, minor).
