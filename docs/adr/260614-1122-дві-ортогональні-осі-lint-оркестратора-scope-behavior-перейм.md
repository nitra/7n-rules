---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T11:22:23+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Напишу ADR-и безпосередньо на основі транскрипту.

---

## ADR Дві ортогональні осі lint-оркестратора: scope × behavior + перейменування словника

## Context and Problem Statement
Наявний `lint`-оркестратор мав єдину вісь: `quick` (змінені файли) vs `ci` (весь репо), закодовану в `meta.json`. Не існувало способу запустити лінт у режимі лише-детектування без мутацій файлів — автофікс (oxlint `--fix`, stylelint `--fix`, markdownlint-cli2, shellcheck-patch, dotenv-linter fix) застосовувався завжди.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "дві незалежні осі scope та behavior", because user прямо продиктував: вісь scope = `per-file` (дельта vs origin) | `--full` (весь репо); вісь behavior = fix-by-default | `--read-only` (лише детект). Словник `quick`→`per-file`, `ci`→`full` у `meta.json`.

### Consequences
* Good, because `--read-only` гарантує нуль мутацій і детермінований вивід — безпечний для pre-commit-хука й CI; `lint` без прапорів залишається зручним локально (фіксить і виходить).
* Good, because дельта vs origin як default scope зберігає швидкість локального прогону; `--full` явно вмикає важкі whole-repo аналізатори (jscpd/knip).
* Bad, because transcript не містить підтверджених негативних наслідків; ламаюча зміна `meta.json` словника потребує оновлення всіх 8 файлів.

## More Information
Змінені файли: `npm/scripts/lib/rule-meta.mjs` (`parseRuleLintSpec`), `npm/scripts/lint-cli.mjs` (`selectLintRules`, `runLint({full, readOnly})`), `npm/bin/n-cursor.js` (прапори `--full`/`--read-only`), `meta.json` у 8 правилах (doc-files→per-file, ga→full, js-lint-ci→full, js-lint→per-file, rego→full, security→per-file, style-lint→per-file, text→per-file). Контракт кожного `lint.mjs` розширено до `lint(files, cwd, { readOnly })`. Специфікації: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`, `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`.

---

## ADR Поглинання fix-двигуна в lint --full і повне видалення n-cursor fix без аліасів

## Context and Problem Statement
Існували дві паралельні підсистеми: `lint` (прогін зовнішніх лінтерів) і `fix` (convergence-loop + check-gate + Tier0→LLM для конформності конфігів/файлів/workflow). Це дублювало точки входу і вимагало від розробника знати, коли запускати `lint`, а коли `fix`.

## Considered Options
* `lint --full` стає надмножиною `fix`: конформність-фаза `fix.mjs run()` / convergence-loop запускається як ціла-репо фаза після лінтер-фази.
* Залишити `fix` як делегувальний аліас до наступного major — обговорювалось і явно відхилено user: "не потрібен цей аліас".

## Decision Outcome
Chosen option: "повне видалення `fix`/`check` без аліасів", because user підтвердив: "заміна `n-cursor fix` на цю реалізацію взагалі" і "зворотна сумісність не потрібна".

### Consequences
* Good, because єдина точка входу: `lint` (fix-by-default) і `lint --read-only`; не треба пам'ятати два окремих інструменти.
* Good, because transcript фіксує очікувану користь: конформність-фаза виконується лише з `--full`, тобто не уповільнює щоденний `lint` по дельті.
* Bad, because `_fix-check` і `fix-t0` (внутрішні підкоманди) і `skills/fix/js/orchestrator.mjs` лишилися dead-code — потребують окремого follow-up cleanup.
* Bad, because `runFixCommand` у `bin/n-cursor.js` — мертвий код до наступного коміту (не кличеться жодним case).

## More Information
Видалено: `case 'fix'` і `case 'check'` з `npm/bin/n-cursor.js`. `fix changelog` перейменовано на підкоманду `fix-changelog` (маршрутизує до `rules/changelog/js/autofix.mjs`). Скіл `.cursor/skills/n-fix/` видалено фізично. `CLAUDE.md` — запис `/n-fix` прибрано. `hk.pkl`: `n-cursor fix changelog` → `n-cursor fix-changelog`. `npm/scripts/post-tool-use-fix.mjs`: `args = ['fix', '--json', ...]` → `args = ['lint', '--read-only', '--json', ...]`. `npm/scripts/lib/timing-summary.mjs`: `TIMED_COMMANDS` — прибрано `'fix'`/`'check'`, додано `'_fix-check'`. Коміти `028d4bf0` і наступний.

---

## ADR CI-контекст схлопується в --read-only --full; усунення прапора --ci і хелпера effectiveCi

## Context and Problem Statement
Канонічна спека `2026-06-14-lint-rule-consolidation.md` визначала три контексти виконання (agent / CI / full) з хелпером `effectiveCi(rule) = rule.ci ?? rule.scope` і полем `meta.json:lint = {scope, ci}` для per-rule override CI-режиму. Це ускладнювало модель і конфліктувало з новою двовісною семантикою.

## Considered Options
* Залишити три контексти з `effectiveCi`-міксом (початковий варіант в `consolidation`-спеці).
* CI = `--read-only --full` без окремого прапора `--ci`.

## Decision Outcome
Chosen option: "CI = `--read-only --full`", because user підтвердив O-1: "замість `n-cursor lint --ci` — `n-cursor lint --read-only --full`", і погодився на трейдоф втрати per-file CI-оптимізації.

### Consequences
* Good, because модель спрощується: `meta.json:lint` — plain рядок `"per-file"|"full"`, хелпер `effectiveCi` і поле `{scope, ci}` усуваються.
* Good, because правило `security` спрощується з `ci`-only до `"per-file"` (lint по змінених файлах).
* Bad, because у CI важкі whole-repo аналізатори (jscpd/knip) вже не можна скопувати на per-file дельту — вони завжди full, але тепер і локально з `--full`; transcript фіксує цей трейдоф явно.

## More Information
Файл `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` — додано amendment-банер (§О-1/О-2), §5 «Два контексти» (замість трьох), §8 CLI таблиця, §9 GA (`n-cursor lint --read-only --full`), §11 тести, §12 semver→major. Контракт `js/lint.mjs` розширено до `lint(files, cwd, { readOnly })` (O-2).

---

## ADR omlx як Tier1+ LLM-ескалація замість хмари; зняття заборони паралельного eslint/oxlint на дизʼюнктних шардах

## Context and Problem Statement
Існуючий fix-двигун (`skills/fix/js/llm-worker.mjs`) ескалював до хмарних моделей (haiku→sonnet через `resolveModel`). Заборона в `CLAUDE.md`/`scripts.mdc` забороняла будь-яке паралельне виконання eslint/oxlint навіть по різних файлах, що обмежувало throughput.

## Considered Options
* Хмарні моделі (поточна поведінка).
* omlx (локальний MLX-сервер) через `lib/llm.mjs` → `callOmlx`; cloud лише як fallback у каскаді `resolveModel`.
* mimo code (згадано в спеці як альтернатива omlx).

## Decision Outcome
Chosen option: "omlx через `lib/llm.mjs`", because user прямо сказав: "LLM-ескалація — замість хмарних використовуємо omlx (або прямі виклики або mimo code)"; інфраструктура `callOmlx` вже існує в `npm/lib/llm.mjs` з підтримкою `omlx/<model>` маршруту; env-змінні `N_LOCAL_MIN_MODEL`/`N_LOCAL_AVG_MODEL` вже налаштовані (пам'ять: `omlx/gemma-4-e2b-it-4bit`). Паралельний eslint/oxlint знятий: "заборону паралельного eslint знімаємо — бо на паралельні запуски по різним файлам це ок".

### Consequences
* Good, because transcript фіксує очікувану користь: LLM-фікс без мережевих затримок і без хмарних витрат; детермінований локальний прогін.
* Good, because паралельний eslint по дизʼюнктних шардах збільшує throughput без конфліктів.
* Bad, because конкретні per-tool omlx-фіксери (knip, jscpd, cspell, actionlint, zizmor, v8r, regal, trufflehog) — окрема задача-наступник, явно відкладена в спеці; до її виконання detect-only інструменти не мають автофіксу в fix-режимі.
* Bad, because `CLAUDE.md` і `scripts.mdc` ще не оновлені (зняття заборони паралельного eslint заплановано як крок 6 в плані міграції, але не виконано в цій сесії).

## More Information
`npm/lib/llm.mjs` → `callOmlx` (прямий HTTP до локального MLX); `npm/lib/models.mjs` → `resolveModel(tier)` каскад. Env: `N_LOCAL_MIN_MODEL=omlx/mlx-community--gemma-4-e2b-it-4bit` у `~/.zshenv`. Специфікація: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md` §6 (omlx-ескалація) і §4 (стратегія автофіксу per-tool). Follow-up задача: реалізація per-tool omlx-фіксерів для detect-only інструментів.
