---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T10:18:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

Файл порожній — фоновий скрипт не дав виводу (ймовірно, через відсутність прав до worktree-файлу у `/tmp`). Але це кінець сесії, а не кінець моєї роботи — задача запиту — це аналіз трейнскрипту для ADR.

---

## ADR Видалення надлишкових CLI-точок входу (`lint-ci`, `doc-files <sub>`)

## Context and Problem Statement
Аудит CLI `@nitra/cursor` показав дві зайві команди: `lint-ci` — чистий аліас `lint --read-only --full` без живих callerів у CI чи скриптах; `doc-files <sub>` (`scan|check|gen|stamp`) — deprecated-аліас, що делегує у `lint-doc-files`/`fix-doc-files`, доданий як міграційне вікно і теж без живих callerів. Ціль — мінімальна поверхня.

## Considered Options
* Видалити обидва аліаси (breaking → major)
* Залишити аліаси до наступного явного major
* Перетворити `lint-ci` на флаг `lint --doc-files` (обговорювалося)

## Decision Outcome
Chosen option: "Видалити обидва аліаси", because обидва мали нуль живих callerів у реальній проводці (hook-маркер, root `package.json`, тести), а тримати deprecated-шар без caller'ів прямо суперечить меті мінімальної поверхні. Зниження ускладнення > зворотня сумісність у відсутності споживачів.

### Consequences
* Good, because transcript фіксує очікувану користь: чистий диспетч у `bin/n-cursor.js`, читабельна шапка CLI, відсутність дублювання семантики `lint --read-only --full`.
* Bad, because видалення публічних команд — breaking change: changeset `bump: major` (`npm/.changes/260615-0638.md`), реліз `@nitra/cursor@11.0.0`.

## More Information
- Видалено: `case 'lint-ci'` та `case 'doc-files'` у `npm/bin/n-cursor.js`; рядки шапки; `lint-ci` з `default`-помилки.
- Паралельно виправлено: `npm/schemas/rule-meta.json` — enum `["quick","ci"]` → `["per-file","full"]` (відповідає реальним значенням `parseRuleLintSpec`); `npm/rules/js-lint-ci/js-lint-ci.mdc` — посилання `lint-ci` → `lint --full`.
- `LEGACY_DOC_FILES_HOOK_COMMAND_MARKER` (для cleanup старих інсталяцій) лишений у `sync-claude-config.mjs` — він не є CLI-точкою входу, а маркером для cleanup.

---

## ADR Opportunistic LLM-fix tier у lint-кроці (doc-files як референс)

## Context and Problem Statement
Lint-крок правила `doc-files` (`npm/rules/doc-files/js/lint.mjs`) був detect-only навіть у fix-by-default режимі: він виводив stale-список і делегував генерацію у `fix-doc-files`. Решта lint-правил у fix-by-default реально правлять файли (oxlint `--fix`, конформність-конвергенція). Ціль — зробити `doc-files` повноправним учасником fix-by-default, щоб він став референсом для наступних LLM-сумісних правил.

## Considered Options
* Opportunistic fix: omlx up → генерує; omlx down → skip + exit 1 (report)
* Безумовна генерація (без omlx-preflight) — відхилено, бо без omlx = краш замість «доки застаріли»
* Залишити detect-only — не задовольняє мету

## Decision Outcome
Chosen option: "Opportunistic fix з omlx-preflight", because це єдиний варіант, який зберігає гейт чесним (omlx down → exit 1, не false-green) і при цьому робить lint самодостатнім коли модель доступна.

### Consequences
* Good, because transcript фіксує очікувану користь: lint-крок у fix-by-default тепер самостійно регенерує застарілі доки через `runGenerationBatch`; виклик `fix-doc-files` потрібен лише для явних форсованих прогонів (`--limit/--from/--overwrite/--retry-degraded/--stamp`).
* Bad, because lint-крок стає side-effecting і зчепленим з omlx-інфрою; юніт-тести детектора втратили герметичність — довелося переписати detect-тести на `{readOnly:true}` та додати mock-wrapper для gating-тестів.

## More Information
- `npm/rules/doc-files/js/docgen-files-batch.mjs`: `preflightProblem` і ядро `runGenerationBatch` **експортовані** (раніше приватні).
- `npm/rules/doc-files/js/lint.mjs`: новий контракт `lint(files, cwd, {readOnly})` — lazy-import генерації (detect/readOnly-шлях не тягне omlx).
- `npm/rules/doc-files/meta.json`: додано `"llmFix": true` як opt-in декларація.
- `npm/schemas/rule-meta.json`: нова властивість `llmFix` (boolean, з застереженням «не для логічних лінтерів»).
- Тести: `npm/rules/doc-files/js/tests/lint.test.mjs` переписано; знайдено quirk `vi.fn`+`mockReset` із замоканим dynamic-import — вирішено стабільним wrapper'ом із мутабельним `state.impl`.
- Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.
- Changeset: `npm/.changes/260615-0907.md` (`bump: minor`, Changed).

---

## ADR Уніфікована LLM-fix абстракція і єдиний knob моделі

## Context and Problem Statement
У codebase співіснували дві незалежні реалізації opportunistic LLM-fix: `docgen-files-batch.mjs` (форма «регенерація артефакту», `N_LOCAL_MIN_MODEL`) і `text/lint/cspell-fix.mjs` (форма «патч знахідок», `N_CURSOR_FIX_MODEL`, без preflight і circuit-breaker). Обидві роблять те саме — preflight omlx, батч, circuit-breaker, звіт — але розійшлися в деталях, зокрема у змінній моделі та наявності fast-fail.

## Considered Options
* Одна уніфікована абстракція: спільне ядро оркестрації + per-rule стратегія (`fixOne`)
* Дві легітимно різні форми без уніфікації (generate vs patch залишаються окремо)
* Перенести LLM-фікс у головний `lint` безумовно — відхилено, бо ламає детермінованість

## Decision Outcome
Chosen option: "Одна уніфікована абстракція", because користувач явно вирішив: спільне оркестраційне ядро (`lib/llm.mjs` або новий `lib/llm-fix.mjs`) + per-rule стратегія (`fixOne`); `N_LOCAL_MIN_MODEL` — єдиний knob (не `N_CURSOR_FIX_MODEL`); opt-in через `meta.json: llmFix:true` для всіх правил; cspell підтягується під preflight і circuit-breaker.

### Consequences
* Good, because transcript фіксує очікувану користь: усунення двох розбіжних knob'ів моделі, консистентний fast-fail і circuit-breaker для всіх LLM-fix правил.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — реалізація C-кроку (кодування ядра та міграція cspell) виходить за межі сесії; рішення зафіксоване, але код ще не написаний.

## More Information
- Дизайн визначений у `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.
- Експеримент запущено у `git worktree add -b exp/cspell-fix .worktrees/cspell-exp HEAD`, проте завершення сесії відбулося до отримання результатів.
- cspell на репо: 1406 знахідок, 292 унікальних файли; більшість — валідні укр-слова/тех-терміни (`аддонів`, `chdir`, `pgdump` тощо), а не одруки → LLM-fix для cspell ефективний лише у quick-scope (змінені файли), не у full-scope.
- Тріаж безпеки зафіксований у спеці: контент-лінтери (`doc-files`, `cspell`) — `llmFix:true` допустимо; логічні лінтери (oxlint, eslint) — заборонено, LLM-правка коду може змінити поведінку.
