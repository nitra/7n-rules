---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T10:47:12+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Продукую ADR-блоки безпосередньо з аналізу transcript:

---

## ADR Нова vocabulary scope-осі: `per-file` | `full` + дефолт diff-vs-origin

## Context and Problem Statement
Оркестратор `npm/scripts/lint-cli.mjs` використовував пару `"quick"` | `"ci"` у полі `meta.json.lint`, яка не відображала семантику scope та не мала diff-vs-origin базою за замовчуванням. Сесія визначала нову вісь scope як частину ширшого уніфікованого рефактора lint.

## Considered Options
* `"per-file"` | `"full"` (diff-vs-origin default, --full для повного репо)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: `"per-file"` | `"full"` з diff-vs-origin дефолтом, because семантика `"quick"` не точно описувала per-file scope, а CI більше не потребує окремого прапора — він складається з двох стандартних прапорів (`--read-only --full`). Канон зафіксовано в `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`.

### Consequences
* Good, because transcript фіксує очікувану користь: scope описується декларативно у `meta.json` без прихованої CI-семантики; `parseRuleLintSpec` замінює `parseRuleLintPhase` і перевіряється тестами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Перемаплені файли: `npm/rules/{doc-files,js-lint,style-lint,security}/meta.json` → `"per-file"`; `npm/rules/{ga,js-lint-ci,rego}/meta.json` → `"full"`; `npm/rules/text/meta.json` → `"per-file"`. Функція `parseRuleLintPhase` перейменована на `parseRuleLintSpec` у `npm/scripts/lib/rule-meta.mjs`. Оновлені тести: `npm/scripts/tests/lint-cli.test.mjs`, `npm/scripts/lib/tests/rule-meta.test.mjs`, `npm/rules/npm-module/js/tests/rule_meta.test.mjs`.

---

## ADR Вісь поведінки `fix` (default) / `--read-only` у lint-оркестраторі

## Context and Problem Statement
Усі lint-інструменти (oxlint, eslint, stylelint, ruff, markdownlint тощо) завжди викликались із `--fix`, навіть у CI, де мутація дерева неприйнятна. Для CI, pre-commit-хуків та інших detect-only сценаріїв потрібен режим, що лише виявляє проблеми без жодних змін.

## Considered Options
* `--read-only` прапор (detect-only, нуль мутацій, нуль LLM) проти `fix`-default (autofix + LLM-ескалація)
* `--check` / `--no-fix` / `--dry-run` як альтернативні назви прапора
* Інші варіанти не обговорювалися глибше.

## Decision Outcome
Chosen option: "`--read-only`" як назва прапора детект-режиму, because це узгоджується з формулюванням користувача і є семантично точним (на відміну від `--dry-run`, що може означати щось інше).

### Consequences
* Good, because transcript фіксує очікувану користь: `read-only` дає інваріант «git diff байт-у-байт незмінний»; `fix`-режим зручний локально (виправив і поїхав); CI форсує `--read-only --full` без окремого `--ci` прапора.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Контракт розширено: `lint(files, cwd)` → `lint(files, cwd, { readOnly })`. Змінені файли: `npm/rules/js-lint/js/lint.mjs`, `npm/rules/style-lint/js/lint.mjs`, `npm/rules/text/js/lint.mjs`, `npm/rules/text/lint/lint.mjs`, `npm/rules/text/lint/run-shellcheck.mjs`, `npm/rules/text/lint/run-dotenv-linter.mjs`, `npm/scripts/lint-cli.mjs`, `npm/bin/n-cursor.js`. Pre-commit хук: лише `--read-only`. CI: `n-cursor lint --read-only --full`.

---

## ADR Видалення `n-cursor fix` без аліаса: поглинання fix-двигуна у lint-оркестратор

## Context and Problem Statement
Існували два паралельних механізми: `lint` (зовнішні тули на код) і `n-cursor fix` (convergence-loop / check-gate / Tier0→LLM у `skills/fix/js/orchestrator.mjs` для конформності конфігів). При введенні fix-режиму в lint-оркестраторі постало питання, чи лишити `n-cursor fix` як делегувальний аліас.

## Considered Options
* Зберегти `n-cursor fix` як аліас до наступного major релізу
* Видалити `n-cursor fix` повністю без будь-яких аліасів

## Decision Outcome
Chosen option: "Видалити `n-cursor fix` повністю без аліасів", because користувач явно сказав «не потрібен цей аліас»; зворотна сумісність не потрібна; fix-двигун (convergence-loop / check-gate / Tier0→LLM) переноситься у lint як fix-режим, де `fix.mjs + check() + policy` стають concern-ами під єдиним контрактом `lint(files, cwd, { readOnly })`.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу для всіх перевірок і виправлень; усі правила (включно з тими, що раніше не мали lint-фази) охоплюються єдиним оркестратором.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видаляються: `n-cursor fix`, `fix-t0`, `_fix-check` команди та `skills/fix/js/orchestrator.mjs` (двигун переноситься). Concern-модель: `external-tool` / `check` / `policy`. Специфікація: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`. Усі правила (включно з `n-adr`, `n-changelog`, `n-bun` тощо) отримують lint-оркестрацію. Знахідки trufflehog/security: теж фіксяться (Tier1+ LLM), виключень `manual-only` нема.

---

## ADR LLM-ескалація Tier1+ через omlx замість хмарних моделей

## Context and Problem Statement
Наявний fix-двигун (`skills/fix/js/orchestrator.mjs`) використовував хмарні LLM-моделі через `pi` CLI (`resolveModel('min'→'avg')`) для Tier1+ autofix. У новому lint-оркестраторі LLM-ескалація потрібна для detect-only інструментів (knip, jscpd, cspell тощо), але хмара є повільною і залежною від мережі.

## Considered Options
* omlx (локальний MLX-сервер) як основний Tier1+, cloud як fallback
* `--no-llm` прапор для детермінованого локального fix без LLM
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "omlx як основний Tier1+, cloud як fallback у `resolveModel` cascade", because `npm/lib/llm.mjs` вже маршрутизує `omlx/<model>` → `callOmlx` (прямий HTTP) без зовнішніх залежностей; `--no-llm` відхилено («не потрібен»).

### Consequences
* Good, because transcript фіксує очікувану користь: локальний LLM зменшує залежність від мережі і вартість; cloud лишається фолбеком через наявний cascade в `resolveModel`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/lib/models.mjs` — `N_LOCAL_MIN_MODEL`, `N_LOCAL_MAX_MODEL` env-змінні (наприклад `omlx/mlx-community--gemma-4-e2b-it-4bit`). `npm/lib/llm.mjs` — `callOmlx` для прямого HTTP до MLX-сервера; або `mimo code` як альтернатива. Per-tool LLM-фіксери (knip, jscpd, cspell, actionlint тощо) — задача-наступник після реалізації основної спеки. Паралельний eslint/oxlint по диз'юнктних shard-ах дозволено (попередня безумовна заборона у `CLAUDE.md` та `.cursor/rules/scripts.mdc` знімається як частина major-міграції).
