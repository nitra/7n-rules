---
type: ADR
title: "Lint fix default і read-only режим оркестратора"
description: Lint-оркестратор має мати ортогональні осі scope та behavior: за замовчуванням fix, а --read-only для detect-only без мутацій.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Існуючий lint-оркестратор розрізняв scope, але не мав єдиного режиму detect-only без мутацій файлів. Водночас існував окремий `n-cursor fix` з convergence-loop і check-gate. Потрібно було уніфікувати точки виклику так, щоб `lint` став єдиним оркестратором: за замовчуванням виправляє, а з `--read-only` лише детектує.

Також потрібно було узгодити scope-вісь із каноном changed-vs-origin / `--full` і визначити, що робити з LLM-ескалацією, правилами без lint-фази та попередньою забороною паралельного eslint/oxlint.

## Considered Options

- Додати `--read-only` до lint-оркестратора: default = fix, `--read-only` = detect-only.
- Зберегти окремий `n-cursor fix` як deprecation alias.
- Видалити `n-cursor fix` без alias.
- Використовувати omlx або прямі локальні виклики як основний LLM для fix-ескалації.
- Зберегти категорію `manual` для concerns без автофіксу.
- Автофіксувати всі concerns через Tier0 або Tier1+ LLM.
- Реалізувати lint лише для правил, які вже мали lint-фазу.
- Реалізувати lint для всіх правил.
- Залишити заборону паралельного eslint/oxlint.
- Зняти заборону для паралельних запусків по різних файлах.

## Decision Outcome

Chosen option: "Єдиний lint-оркестратор: fix default, `--read-only` detect-only, `--full` для scope", because transcript прямо фіксує семантику: `lint` за замовчуванням виправляє, `lint --read-only` лише детектує, `n-cursor fix` не потрібен як alias, а всі правила мають отримати lint-фазу.

### Consequences

- Good, because `--read-only` гарантує detect-only режим без мутацій файлів і підходить для CI та pre-commit.
- Good, because fix-режим повертає exit 1 лише на невиправних залишках після автофіксу, що підтримує локальний workflow.
- Good, because `n-cursor fix` видаляється без legacy alias, а convergence-loop стає engine lint fix-режиму.
- Good, because усі правила отримують єдину точку входу `lint(files, cwd, { readOnly })`.
- Bad, because transcript не містить підтверджених негативних наслідків видалення `n-cursor fix` для зовнішніх користувачів.
- Neutral, because transcript не містить підтвердження якості LLM-виправлень для security-findings або інших складних concerns.

## More Information

Transcript facts:

- Behavior axis: default fix / `--read-only` detect-only.
- Scope axis: default diff від origin / `--full` повний обхід.
- CI автоматично використовує read-only.
- Pre-commit hook використовує read-only.
- Контракт правила: `lint(files, cwd, { readOnly })`.
- Read-only інваріант: LLM не викликається, файли не змінюються.
- `n-cursor fix` видаляється без deprecation alias.
- `_fix-check --json` переходить у `lint --read-only --json`.
- LLM-ескалація має використовувати omlx або прямі локальні виклики; cloud не є основним шляхом.
- Категорії `manual` немає: все фікситься через Tier0 або Tier1+ LLM.
- Правила без попередньої lint-фази: `n-adr`, `n-changelog`, `n-bun`, `n-feedback`, `n-vue`, `n-worktree` — також мають отримати lint.
- Заборону паралельного eslint/oxlint знято для паралельних запусків по різних файлах.
- Спека: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`.

## Update 2026-06-14

Зафіксовано додаткове правило для fix-режиму: conformance-concern-и не отримують `manual-only` винятків. У transcript розглядався варіант виділити `manual`-категорію, зокрема для `trufflehog`/security, але користувач ухвалив `R-1: все фіксимо`.

Наслідки:

* Good, because fix-режим має єдину модель без спеціальних manual-only винятків.
* Bad, because конкретні per-tool omlx-фіксери для `knip`, `jscpd`, `cspell`, `actionlint`, `zizmor`, `v8r`, `regal`, `trufflehog` у transcript позначені як follow-up, а не як реалізована частина.

Джерело: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`, таблиця стратегій Tier0/Tier1+/never.

## Update 2026-06-14

Пізніша реалізація розширила початкове рішення про fix/read-only до повної двовісної моделі lint-оркестратора:

* scope: `per-file` із базою origin за замовчуванням або `--full` для whole-repo прогону;
* behavior: fix-by-default або `--read-only` для detect-only без мутацій;
* CI виражається як `n-cursor lint --read-only --full`, без окремого `--ci`;
* словник `meta.json:lint` hard-renamed з `quick|ci` на `per-file|full`;
* контракт rule-адаптерів розширено до `lint(files, cwd, { readOnly })`.

Додатково `lint --full` поглинув conformance-фазу старого `n-cursor fix`: після лінтер-фази запускається conformance для whole-repo concerns. Публічні команди `fix`, `check`, `fix-run` видалені, а рушій перенесено з `npm/skills/fix/js/` у `npm/scripts/lib/fix/`. `_fix-check` і `fix-t0` лишилися внутрішніми фазами.

PostToolUse-хук спрощено: замість routing-таблиці файл→правила використовується один read-only виклик усіх активованих правил. Роутинг визнано зайвим, бо read-only detect не запускає LLM і не мутує дерево.

Окремо прийнято релаксацію заборони паралельного ESLint/oxlint: паралельні прогони дозволені для дизʼюнктних наборів файлів; whole-tree прогони того самого корпусу лишаються серіалізованими.

Для `lint-text` додано `--read-only`, який протягується через markdownlint/shellcheck/dotenv-linter і гейтить автофікси. Переведення CI workflows на цей прапор відкладено, бо `rules/text/js/formatting.mjs` на момент transcript енфорсив канон `bun run lint-text` без прапорців.

Факти реалізації з transcript:

* `npm/scripts/lib/rule-meta.mjs`: `parseRuleLintSpec`.
* `npm/scripts/lint-cli.mjs`: `selectLintRules`, `runLint`, conformance-фаза при `full`.
* `npm/bin/n-cursor.js`: dispatch `lint`, `--full`, `--read-only`, видалення `fix`/`check`/`fix-run`.
* `npm/scripts/post-tool-use-fix.mjs`: переписано на один read-only check без `ROUTES`.
* `hk.pkl`: `fix changelog` → `lint changelog`.
* `CLAUDE.md`, `npm/bin/n-cursor.js`, `npm/skills/lint/SKILL.md`: оновлено секцію про паралельний lint.
* `npm/rules/text/lint/lint.mjs`, `run-shellcheck.mjs`, `run-dotenv-linter.mjs`: підтримка `readOnly`.
* Коміти в transcript: `028d4bf0`, `91eab517`, `185cbeab`, `4ceb657e`, `60e6aaa3`.

Наслідки:

* Good, because одна команда `lint` покриває локальний fix, pre-commit detect і CI detect/full.
* Good, because видалення `fix` без alias прибирає deprecated публічний шлях.
* Good, because PostToolUse-хук стає простішим і не потребує підтримки routing-таблиці при додаванні правил.
* Bad, because це breaking change для зовнішніх викликів `n-cursor fix`, `n-cursor check`, `fix-run` і старих `meta.json:lint` значень `quick|ci`.
* Bad, because CI-follow-up для `lint-text --read-only` лишився відкритим через coupled canonical check у text-правилі.

Додатково зафіксовано рішення, що всі conformance-concern-и автофіксуються в fix-режимі без `manual-only` винятків. У transcript варіант з окремою `manual`-категорією для `trufflehog`/security був відхилений формулюванням користувача «все фіксимо».

PostToolUse-хук спрощується до одного read-only detect-виклику для всіх активованих правил замість таблиці routing file→rules, оскільки read-only режим не запускає дорогий fix+LLM цикл.

Додаткові факти з transcript:

- `lint --read-only` не мутує дерево і має повертати ненульовий exit на будь-яку знахідку.
- `lint --full` поглинає conformance-фазу старого `n-cursor fix`.
- `n-cursor fix` видаляється без deprecated alias.
- Tier1+ LLM-ескалація має йти через `omlx`/`lib/llm.mjs`, cloud лишається fallback у `resolveModel()`.

## Update 2026-06-14

Реалізаційні уточнення до уніфікації lint:

- `quick|ci` у `meta.json:lint` hard-renamed у `per-file|full`.
- `parseRuleLintPhase` перейменовано на `parseRuleLintSpec`.
- `lint --full` отримує conformance-фазу і стає функційною надмножиною старого `fix`.
- Додано фільтр правил `lint <rule>`, щоб `hk.pkl` міг замінити `fix changelog` на `lint changelog`.
- Публічні команди `fix`, `check`, `fix-run` видаляються, а рушій conformance переміщується з `npm/skills/fix/js/` у `npm/scripts/lib/fix/`.
- `_fix-check` і `fix-t0` лишаються внутрішніми фазами, їх інлайнинг відкладено.
- Заборона паралельного ESLint/oxlint релаксована: паралельні прогони дозволені для дизʼюнктних наборів файлів, whole-tree прогони того самого корпусу мають лишатися серіалізованими.

Transcript facts: згадані коміти `3a0b0ec4`, `028d4bf0`, `91eab517`, `185cbeab`, `4ceb657e`; live-перевірка `N_CURSOR_CHANGELOG_AUTOFIX=1 node npm/bin/n-cursor.js lint changelog` завершилась з кодом 0.

## Update 2026-06-14

Додано окреме уточнення для `lint-text`: підкоманда отримує `--read-only`, щоб markdownlint/shellcheck/dotenv-linter могли працювати у detect-only режимі без автофіксу. Прапор протягнуто через `runLintTextCli` → `runLintTextSteps` → `runShellcheckText` / `runDotenvLinter`.

Важливий transcript fact: спроба одразу перевести `lint-text.yml` і `lint-style.yml` на CI-read-only зламала `checkText`, бо `rules/text/js/formatting.mjs` енфорсить `bun run lint-text` без прапорців. Workflow-зміни відкочено, а оновлення канону `formatting.mjs` лишено follow-up.

Також зафіксовано фінальний стан реалізації:

- `fix`, `check`, `fix-run` видалені як публічні команди.
- `npm/skills/fix/js/{orchestrator,t0,llm-worker}.mjs` переміщено у `npm/scripts/lib/fix/`.
- PostToolUse-хук переписано на один read-only `_fix-check` для всіх активованих правил без `ROUTES` і `picomatch`.
- `CLAUDE.md`, `buildClaudeLintParallelismSectionLines()` і `npm/skills/lint/SKILL.md` синхронізовано з правилом: паралельний lint дозволений лише для дизʼюнктних наборів файлів.
