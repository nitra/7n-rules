---
type: ADR
title: "Уніфікація lint: read-only, conformance і видалення fix"
description: Публічну поверхню перевірок уніфіковано навколо `n-cursor lint` з осями scope і behavior, а conformance-рушій винесено зі скіла fix.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Публічний CLI мав кілька близьких команд (`fix`, `check`, `fix-run`, `lint`) і окремий скіл `/n-fix`. Після появи read-only поведінки та потреби запускати conformance як частину повної перевірки ця поверхня стала дублюватися. Додатково conformance-рушій фізично лежав у `npm/skills/fix/js/`, хоча був бібліотечним компонентом для CLI та lint-оркестратора.

## Considered Options

- Залишити `fix`/`check`/`fix-run` публічними командами паралельно з `lint`.
- Використати одну команду `n-cursor lint` з незалежними ознаками `--full` і `--read-only` та позиційними фільтрами правил.
- Залишити `/n-fix` як alias або deprecated delegate до `/n-lint`.
- Повністю видалити `/n-fix` після перенесення рушія.
- Залишити conformance-рушій у `npm/skills/fix/js/`.
- Перемістити conformance-рушій до `npm/scripts/lib/fix/`.
- Зберегти PostToolUse file-routing через `ROUTES`/`routeFilePathToRules`.
- Замінити PostToolUse routing одним read-only викликом `_fix-check`.

## Decision Outcome

Chosen option: "Уніфікувати публічну поверхню навколо `n-cursor lint [--full] [--read-only] [<rules...>]`, перемістити рушій до `npm/scripts/lib/fix/` і видалити `/n-fix`", because transcript фіксує, що `lint` став надмножиною `fix`, `--full` може містити conformance-фазу, а скіл `/n-fix` після делегування не мав власної поведінки.

### Consequences

- Good, because одна команда `lint` покриває матрицю scope × behavior: delta/full і fix/read-only.
- Good, because `fix changelog` для хуків переноситься в `lint changelog` без введення нової підкоманди.
- Good, because conformance-рушій отримує стабільний бібліотечний дім у `npm/scripts/lib/fix/` і не залежить від життєвого циклу skill-директорії.
- Good, because PostToolUse-хук спрощується до одного read-only детекту без таблиці `ROUTES` і залежності від `picomatch`.
- Good, because CI lint-text/lint-style може працювати як read-only verifier без автофіксів у робочому дереві.
- Bad, because видалення публічних `fix`/`check`/`fix-run` є breaking change для зовнішніх споживачів, які викликали ці команди напряму.
- Neutral, because паралельний ESLint дозволено лише для дизʼюнктних наборів файлів; whole-tree прогони того самого корпусу треба серіалізувати.

## More Information

- Переміщені файли рушія: `npm/skills/fix/js/orchestrator.mjs`, `t0.mjs`, `llm-worker.mjs` → `npm/scripts/lib/fix/`.
- Оновлені споживачі: `npm/bin/n-cursor.js`, `npm/scripts/lint-cli.mjs` або подальший шлях оркестратора lint.
- Видалені публічні команди CLI: `fix`, `check`, `fix-run`; внутрішні `_fix-check` і `fix-t0` збережено.
- Видалені skill-шляхи: `npm/skills/fix/SKILL.md`, `npm/skills/fix/meta.json`, `.cursor/skills/n-fix/SKILL.md`, `.claude/commands/n-fix.md`.
- PostToolUse файли: `npm/scripts/post-tool-use-fix.mjs`, `npm/scripts/tests/post-tool-use-fix.test.mjs`.
- CI workflow зміни: `.github/workflows/lint-text.yml` використовує `n-cursor lint-text --read-only`; `.github/workflows/lint-style.yml` прибирає `--fix` зі `stylelint`.
- Canon-точки CI read-only: `npm/rules/text/policy/lint_text/template/lint-text.yml.snippet.yml`, `npm/rules/text/js/formatting.mjs`, `npm/rules/text/policy/lint_text/lint_text_test.rego`, `npm/rules/style-lint/policy/lint_style_yml/template/lint-style.yml.snippet.yml`, `npm/rules/style-lint/policy/lint_style_yml/lint_style_yml_test.rego`, `npm/rules/style-lint/style-lint.mdc`, `.cursor/rules/n-text.mdc`.

## Update 2026-06-14

CI-воркфлоу `lint-text.yml` і `lint-style.yml` переведено у read-only режим: `lint-text.yml` використовує `n-cursor lint-text --read-only`, а `lint-style.yml` запускає `npx stylelint` без `--fix`. Синхронно оновлено canon-точки: snippet-шаблони, Rego-тести, JS-перевірки та `.cursor/rules/n-text.mdc`. Transcript фіксує коміт `11aa4f92` і факт, що `n-cursor` доступний у CI як workspace-symlink без окремого встановлення.

## Update 2026-06-14

Драфт групує супутні рішення навколо уніфікації `lint`: дві незалежні осі `scope × behavior` (`--full`, `--read-only`), поглинання conformance-фази в `lint --full`, позиційні фільтри правил `n-cursor lint [--read-only] <rules...>`, спрощення PostToolUse до одного read-only детекту, переміщення conformance-рушія до `npm/scripts/lib/fix/`, видалення `/n-fix`, релаксацію паралельного ESLint для диз'юнктних файлів і read-only CI для `lint-text`/`lint-style`.
