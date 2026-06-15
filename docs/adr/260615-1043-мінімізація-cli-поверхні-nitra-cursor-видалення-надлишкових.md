---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-15T10:43:46+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR Мінімізація CLI-поверхні `@nitra/cursor`: видалення надлишкових точок входу

## Context and Problem Statement
CLI `npm/bin/n-cursor.js` містив `lint-ci` як чистий аліас `lint --read-only --full` та `doc-files <sub>` як deprecated-аліас із 0 живих callerів. Разом із застарілим enum `quick|ci` у `npm/schemas/rule-meta.json` (реальні значення — `per-file|full`) це збільшувало поверхню без функціональної користі.

## Considered Options
* Видалити надлишкові команди та оновити схему enum
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити надлишкові команди та оновити схему enum", because мінімальна поверхня CLI — явна ціль сесії; `lint-ci` не зветься ні в реальних workflow, ні в кореневому `package.json`; `doc-files <sub>` не має живих callerів після міграції до `lint-doc-files`/`fix-doc-files`.

### Consequences
* Good, because transcript фіксує очікувану користь: менше команд → менше поверхні для підтримки; `node --check` і `vitest` (131/131) пройшли після видалення.
* Bad, because зміна є breaking → changeset `major` (`npm/.changes/260615-0638.md`); існуючі інсталяції, що кличуть `lint-ci` або `doc-files scan|check|gen|stamp` напряму, отримають помилку.

## More Information
Змінені файли: `npm/bin/n-cursor.js` (`case 'lint-ci'`, `case 'doc-files'`, шапка, `default`-список), `npm/schemas/rule-meta.json` (enum + опис), `npm/rules/js-lint-ci/js-lint-ci.mdc` (description, тіло). Changeset: `npm/.changes/260615-0638.md` (`bump: major, section: Removed`). LEGACY-маркер `doc-files check` в `sync-claude-config.mjs` лишається для cleanup старих інсталяцій.

---

## ADR Opportunistic LLM-fix tier як уніфікований патерн для lint-правил

## Context and Problem Statement
Lint-правило `doc-files` детектувало застарілість документації, але у fix-by-default режимі лише друкувало список і перекидало користувача на `fix-doc-files`. Оркестратор `runLint` не мав жодного механізму для opportunistic-автофіксу через локальну LLM, хоча `text/lint/cspell-fix.mjs` вже реалізував схожу ідею (whole-file apply). Два підходи розходились у деталях (env-var, preflight, circuit-breaker, форма outcome).

## Considered Options
* Opportunistic LLM-fix у lint-кроці: detect → omlx up → fix; omlx down → skip+exit 1 (гейт тримається)
* Додати `--doc-files` флаг до `lint` (спеціалькейсити одне правило)
* Перенести генерацію в `lint --full` безумовно
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Opportunistic LLM-fix у lint-кроці: detect → omlx up → fix; omlx down → skip+exit 1", because `--doc-files` флаг збільшив би поверхню; безумовна генерація зламала б детермінованість `--read-only` (CI). Opportunistic-підхід зберігає гейт (omlx down → стейл → exit 1) і не вносить зовнішньої залежності у CI.

### Consequences
* Good, because transcript фіксує очікувану користь: lint-крок doc-files тепер автоматично регенерує застарілі доки у fix-by-default, нічого не роблячи в `--read-only`/CI; тести 131/131.
* Bad, because lint-крок стає side-effecting (залежить від omlx); юніт-тести детектора втратили герметичність без `{readOnly:true}` — їх перероблено на явний `readOnly`-прапор + mock-wrapper генерації.

## More Information
Реалізація: `npm/rules/doc-files/js/lint.mjs` (новий контракт `lint(files, cwd, {readOnly})`), `npm/rules/doc-files/js/docgen-files-batch.mjs` (витяг `runGenerationBatch`, export `preflightProblem`). Opt-in прапор: `npm/rules/doc-files/meta.json` → `llmFix: true`; схема: `npm/schemas/rule-meta.json` + нове поле `llmFix`. Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`. Changeset: `npm/.changes/260615-0907.md` (`bump: minor, section: Changed`). Три інваріанти: (1) preflight лише коли є stale; (2) omlx down → exit 1; (3) `--read-only` → лише detect.

---

## ADR Єдиний knob `N_LOCAL_MIN_MODEL` і opt-in `llmFix: true` для LLM-fix-рівня

## Context and Problem Statement
Наявний `cspell-fix.mjs` використовував `N_CURSOR_FIX_MODEL`, тоді як нова реалізація doc-files — `N_LOCAL_MIN_MODEL`. Два різних env-var для одного tier'у ускладнюють конфігурацію. Паралельно в схемі не було механізму opt-in, який дозволяв би оркестратору знати, чи підтримує правило LLM-fix.

## Considered Options
* `N_LOCAL_MIN_MODEL` як єдиний env-var + `llmFix: true` у `meta.json`
* Різні env-var на кожну форму fix (`N_CURSOR_FIX_MODEL` для patching, `N_LOCAL_MIN_MODEL` для generation)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`N_LOCAL_MIN_MODEL` як єдиний env-var + `llmFix: true` у `meta.json`", because один knob для всіх форм LLM-fix спрощує налаштування; `llmFix: boolean` у `meta.json` — декларативний механізм discoverability (не неявне захоплення), консистентний із наявним полем `lint`.

### Consequences
* Good, because transcript фіксує очікувану користь: один env-var → простіша конфігурація; `meta.json: llmFix:true` дає оркестратору явну точку для тріажу.
* Bad, because `N_CURSOR_FIX_MODEL` у `cspell-fix.mjs` стає stale (потребує заміни на уніфіковане ядро у наступному кроці реалізації).

## More Information
`N_LOCAL_MIN_MODEL` визначений через `~/.zshenv` (значення `omlx/gemma-4-e4b-it-OptiQ-4bit`). Схема `npm/schemas/rule-meta.json` оновлена з новим полем `llmFix: boolean`.

---

## ADR cspell-стратегія: classify+dict-suggest замість whole-file patch

## Context and Problem Statement
Наявний `npm/rules/text/lint/cspell-fix.mjs` у fix-режимі шле весь файл + знахідки в LLM і очікує повернення цілого файлу як JSON (`llmLintFix`). Емпіричний експеримент у worktree `.worktrees/cspell-exp` виявив: 1406 знахідок / 292 файли в репо, ~90% — валідні укр/тех-слова (кандидати в словник, не одруки); `llmLintFix` дав timeout (120с, curl exit 28) та parse error на реальних файлах. Класифікатор (compact-list prompt) відпрацював коректно, хоча виявив 1 шкідливу класифікацію (`аутейдж`→`аудит`) з 19 слів.

## Considered Options
* (a) Зберегти whole-file apply (`llmLintFix`) під спільне ядро
* (b) classify+dict-suggest: класифікація unknownWords → авто-дописувати валідні у `.cspell.json` customWords
* (c) Залишити detect-only (baseline, нуль автоматизації)

## Decision Outcome
Chosen option: "(b) classify+dict-suggest — авто-дописувати валідні слова у `.cspell.json`", because (a) операційно зламаний на реальних файлах (timeout/parse-fail підтверджено); реальний ремедіейшн для цього репо — доповнення словника, а не мутація коду; (b) безпечніший (не мутує джерело), відповідає природі знахідок.

### Consequences
* Good, because transcript фіксує очікувану користь: prompt легкий (~30 tokens per batch), без timeout-ризику; авто-дописування `.cspell.json` — цільова дія для ~90% знахідок.
* Bad, because 1 шкідлива класифікація на 19 слів (експеримент) → пропозиції потрібні у diff-рев'ю перед комітом; авто-apply без перевірки ризикований.

## More Information
Експеримент: worktree `exp/cspell-fix` (від HEAD `726b0857`), скрипт `/tmp/exp-cspell.mjs`, модель `omlx/gemma-4-e4b-it-OptiQ-4bit`. Файли тесту: `npm/scripts/lib/worktree-notice.mjs` (25 findings, timeout у (a)), `npm/rules/doc-files/js/docgen-gen.mjs` (timeout у (a)). Цільовий файл словника: `.cspell.json` (поле `customWords`). Наявний `cspell-fix.mjs` підлягає заміні в наступному кроці реалізації C.

---

## ADR Уніфікована LLM-fix абстракція: спільне ядро + дві outcome-форми стратегій

## Context and Problem Statement
Після реалізації opportunistic-fix у doc-files (форма «регенерація артефакту») і емпіричного спростування whole-file patch у cspell (форма «classify+suggest») виявилось, що обидва підходи мають спільну оркестраційну інфраструктуру (preflight, маршрут моделі, circuit-breaker, cap, loop, звіт) і різняться лише у `fixOne(target)`.

## Considered Options
* Монолітна функція «генерує-і-патчить» (одна реалізація для всіх)
* Спільне ядро `llmFixBatch(targets, strategy)` + per-rule стратегія (`fixOne`)

## Decision Outcome
Chosen option: "Спільне ядро `llmFixBatch` + per-rule стратегія `fixOne`", because монолітна функція не покриває дві принципово різні операції (регенерація артефакту vs класифікація+словник); стратегія дозволяє кожному правилу мати власну форму outcome без дублювання оркестраційної інфраструктури.

### Consequences
* Good, because transcript фіксує очікувану користь: preflight `N_LOCAL_MIN_MODEL`, circuit-breaker і cap стають спільними для doc-files і cspell; стратегії ізольовані й тестуються незалежно.
* Bad, because transcript не містить підтверджених негативних наслідків. (Реалізація `llmFixBatch` у `lib/llm.mjs` ще не виконана — це наступний крок після поточної сесії.)

## More Information
Форма 1 (apply, doc-files): `fixOne` = `extractFacts` → `callLlm` → CRC-stamp; prompt компактний (~300 tokens), outcome = новий артефакт. Форма 3 (suggest/dict-append, cspell): `fixOne` = compact-list → `callLlm` → append `customWords` у `.cspell.json`; prompt ~30 tokens, не мутує вихідний код. Форма 2 (whole-file patch, наявний `llmLintFix`) — визнана зламаною за результатами експерименту і не входить до уніфікованої абстракції. Тріаж безпеки (зафіксований у спеці): `llmFix: true` — лише content-лінтери (doc-files, cspell); логічні лінтери (eslint, oxlint) — поза scope, бо LLM-правка коду може змінити поведінку. Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.
