---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T11:37:45+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Запис заблокований дозволами. Ось усі чотири ADR-блоки готові до збереження:

---

## ADR Перейменування словника scope-осі lint: quick|ci → per-file|full + база origin

## Context and Problem Statement
Попередній словник `"quick"` / `"ci"` у `meta.json:lint` поєднував два різних поняття — область охоплення (змінені файли vs весь репо) і контекст виконання (CI vs локально). `effectiveCi`-хелпер додатково розгалужував логіку за середовищем. Це ускладнювало читання конфігурацій і додавало неявну залежність від контексту виклику.

## Considered Options
* Зберегти `"quick"` / `"ci"` із задокументованою семантикою
* Замінити на `"per-file"` / `"full"` із явним `--read-only --full` для CI

## Decision Outcome
Chosen option: `"per-file"` | `"full"` з diff-vs-origin дефолтом, because нові значення описують область охоплення напряму (по файлах дельти vs весь репо), усувають третій неявний контекст `effectiveCi`, а CI зводиться до прапорів `--read-only --full` без окремого коду розгалуження.

### Consequences
* Good, because `meta.json` тепер декларує лише область охоплення, а не контекст середовища — читабельніше і менш крихко.
* Good, because база дельти змінена з "файли у робочому дереві" на `origin` (merge-base), що дає стабільніший і передбачуваніший набір файлів при перевірці.
* Good, because CI-режим виражається композицією прапорів (`--read-only --full`), а не окремою гілкою логіки.
* Bad, because це breaking change: усі 8 `meta.json` і залежний код потребували одночасного оновлення; старі значення `"quick"` / `"ci"` більше не розпізнаються.

## More Information
Змінені файли: `npm/scripts/lib/rule-meta.mjs`, `npm/scripts/lint-cli.mjs`, `npm/rules/npm-module/js/rule_meta.mjs`, 8 × `meta.json` (doc-files→per-file, ga→full, js-lint-ci→full, js-lint→per-file, rego→full, security→per-file, style-lint→per-file, text→per-file), `npm/scripts/lib/tests/rule-meta.test.mjs`, `npm/scripts/tests/lint-cli.test.mjs`, `.cursor/rules/n-js-lint-ci.mdc`. Перейменування: `parseRuleLintPhase` → `parseRuleLintSpec`; `selectLintRules(meta, full)` замінює режимо-залежний селектор. Канонічний spec: `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`.

---

## ADR Вісь поведінки lint — fix-by-default / --read-only, контракт lint(files, cwd, {readOnly})

## Context and Problem Statement
Оркестратор `lint` мав єдиний режим роботи: автоматичне застосування виправлень. Потрібен детектуючий режим без мутацій файлів — зокрема для pre-commit hook, де швидкість і детермінованість критичні. Виникло питання, як розширити публічний контракт функції без порушення існуючої поведінки.

## Considered Options
* `--read-only` прапор — друга вісь ("поведінка"), ортогональна до scope (per-file/full); за замовчуванням fix, з прапором — тільки детект
* `--no-llm` прапор — відключення LLM-залежних правил окремо від мутацій
* `manual`-виключення для окремих правил (наприклад, trufflehog/security)

## Decision Outcome
Chosen option: "`--read-only` як ортогональна вісь поведінки", because всі наявні правила або вже є детект-only (security, js-lint-ci, doc-files, ga, rego), або автоматично виправляються (js-lint, style-lint, text) — ручних виключень не потрібно, а `--no-llm` є зайвим.

### Consequences
* Good, because pre-commit hook отримує швидкий, детермінований режим без жодних змін у файлах.
* Good, because контракт `lint(files, cwd, { readOnly })` залишається зворотно сумісним — старі виклики без третього аргументу продовжують працювати як fix-by-default.
* Bad, because три правила (js-lint, style-lint, text) вимагали явного gating-у на `readOnly === false` у шести файлах, що ускладнює їх внутрішню логіку.

## More Information
Змінені файли: `npm/rules/js-lint/js/lint.mjs`, `npm/rules/style-lint/js/lint.mjs`, `npm/rules/text/js/lint.mjs`, `npm/rules/text/lint/lint.mjs`, `npm/rules/text/lint/run-shellcheck.mjs`, `npm/rules/text/lint/run-dotenv-linter.mjs`. Новий тест перевіряє propagation `readOnly` через оркестратор. Pre-commit hook використовує виключно `--read-only`.

---

## ADR lint --full поглинає fix-рушій; субкоманда fix видалена без аліасу

## Context and Problem Statement
`n-cursor` мав дві точки входу для авто-виправлення коду: `fix` (конвергентний цикл + Tier0 + LLM-ескалація) і `lint --full` (суворий статичний аналіз). Після додавання conformance-фази до `runLint` обидві команди почали перекривати одне одного за функціоналом, що породжувало дублювання логіки й потребу підтримки двох кодових шляхів.

## Considered Options
* Залишити `fix` як делегувальний аліас до `lint --full` до наступного major-релізу
* Видалити `fix` без будь-якого аліасу; `lint --full` стає єдиною точою входу

## Decision Outcome
Chosen option: "Видалити `fix` без аліасу", because аліас подовжував би підтримку застарілого API й вимагав би додаткового тестування двох шляхів; `lint --full` вже є строгим надмножинням старого `fix`, тому сумісний шим не дає реальної цінності.

### Consequences
* Good, because кодова база має єдиний конвергентний цикл виправлення під `lint --full`; хук `hk.pkl` і PostToolUse-хук спрощені до одного виклику `lint --read-only` / `lint changelog`.
* Good, because скіл `/n-fix` видалено; `/n-lint` стає єдиною точкою входу для автоматизації.
* Bad, because зовнішні скрипти чи CI, що викликали `fix` напряму, впадуть без попередження — без перехідного аліасу міграція є ламаючою зміною.

## More Information
Commits: `028d4bf0` (conformance phase у `runLint`) та `91eab517` (rule filter + перемикання `hk.pkl`). `npm/scripts/lint-cli.mjs` — conformance-фаза: `full === true && !ruleFilter` → запускає `fix.mjs run()` для кожного правила. `_fix-check` і `fix-t0` залишаються як внутрішні фази рушія (inline-переміщення до `rules/lint/js/` відкладено). Follow-up: per-tool LLM-фіксери для detect-only інструментів (knip, jscpd, cspell, actionlint, zizmor, v8r, regal, trufflehog). Специфікація: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`.

---

## ADR Локальний LLM через omlx замість хмари для Tier1+ виправлень

## Context and Problem Statement
Попередній дизайн надсилав Tier1+ LLM-запити напряму в хмарний API, що створювало залежність від мережі та збільшувало витрати. Проєкт вже має локальний MLX-сервер (`omlx`) і встановлену змінну середовища `N_LOCAL_MIN_MODEL`, тому хмара потрібна лише як резервний каскад, а не основний шлях.

## Considered Options
* `omlx` — локальний MLX inference сервер (прямий HTTP через `callOmlx`)
* `mimo code` — прямі CLI-виклики Mimo Code як альтернативний локальний рушій
* Хмарний LLM — попередній підхід, лишається як каскадний fallback

## Decision Outcome
Chosen option: "omlx як primary, хмара як каскадний fallback", because локальний сервер усуває мережеву залежність для типових запитів, а `resolveModel(tier)` у `models.mjs` автоматично перенаправляє запити через каскад (local → cloud) без змін у місцях виклику.

### Consequences
* Good, because `llm-worker.mjs` викликає `resolveModel('min'/'avg')` без змін — перенаправлення на omlx відбувається прозоро через таблицю тирів.
* Good, because зникає потреба у прапорці `--no-llm`; локальний шлях завжди доступний при запущеному omlx.
* Good, because паралельний eslint на непересічних файлових шардах тепер дозволений, що прискорює `--full`-прогони.
* Bad, because на машинах із 16 ГБ RAM підходить лише модель `mlx-community--gemma-4-e2b-it-4bit`; важчі моделі потребують примусового хмарного fallback.
* Bad, because якщо omlx не запущено і хмарні ключі відсутні, Tier1+ виправлення повністю недоступні.

## More Information
`npm/lib/llm.mjs` — `callLlm` / `callOmlx`, HTTP-клієнт до локального сервера. `npm/lib/models.mjs` — таблиця тирів і каскад `local → cloud`. `npm/skills/fix/js/llm-worker.mjs` — точка виклику `resolveModel('min'|'avg')`. `~/.zshenv`: `N_LOCAL_MIN_MODEL=omlx/mlx-community--gemma-4-e2b-it-4bit`. Правило R-2: важкі перевірки `jscpd`/`knip` — лише з `--full`. Правило R-4: check/policy обмежені зміненими файлами. Правило R-5: зворотна сумісність JSON-формату виводу не гарантується.
