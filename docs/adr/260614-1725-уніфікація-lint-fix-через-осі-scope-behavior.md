---
type: ADR
title: "Уніфікація lint/fix через осі scope і behavior"
description: Публічний CLI переводить fix/check-семантику в `lint` з незалежними режимами масштабу та read-only поведінки.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Публічний `n-cursor` мав кілька споріднених entry points (`fix`, `check`, `fix-run`, `lint`, `lint-text`) із різною семантикою автофіксу, read-only перевірки та conformance-рушія. Після появи потреби розрізняти масштаб перевірки (delta vs whole repo) і поведінку (автофікс vs тільки детект) ці entry points почали дублюватися й ускладнювати хуки, CI та skills.

Додатково conformance-рушій фізично лежав у `npm/skills/fix/js/`, хоча використовувався як бібліотечний компонент CLI, а PostToolUse-хук підтримував окрему таблицю file→rules routing.

## Considered Options

- Видалити публічні `fix`/`check`/`fix-run`, залишити `_fix-check`/`fix-t0` внутрішніми й зробити `lint` надмножиною через `--full`, `--read-only` і позиційні фільтри правил.
- Залишити `fix`/`check`/`fix-run` як публічні команди паралельно з `lint`.
- Зберегти PostToolUse routing через `routeFilePathToRules` / `ROUTES`.
- Один read-only виклик `_fix-check` для всіх активованих правил без routing.
- Перемістити conformance-рушій до `npm/scripts/lib/fix/`.
- Залишити рушій у `npm/skills/fix/js/` і не видаляти skill.
- Перемістити `scripts/lint-cli.mjs` до `rules/lint/js/orchestrate.mjs` і зареєструвати `rules/lint` як правило.
- Дозволити паралельність ESLint лише для диз'юнктних наборів файлів, серіалізуючи whole-tree прогони того самого корпусу.

## Decision Outcome

Chosen option: "зробити `lint` єдиним публічним entry point з осями `--full`, `--read-only` і фільтрами правил, перемістити conformance-рушій у бібліотечний шлях, спростити PostToolUse до одного read-only виклику та видалити `/n-fix`", because transcript фіксує, що `lint` стає надмножиною `fix`, зменшує кількість публічних команд і прибирає дублювання семантики між CLI, хуками та skills.

### Consequences

- Good, because `n-cursor lint [--full] [--read-only] [<rules...>]` покриває матрицю scope × behavior без множення команд.
- Good, because conformance-рушій винесено з skill-директорії до бібліотечного місця й можна видалити `/n-fix` без втрати логіки.
- Good, because PostToolUse-хук більше не підтримує таблицю `ROUTES` і залежність від `picomatch` для file→rules routing.
- Good, because CI lint-text/lint-style може використовувати read-only перевірки без мутації робочого дерева.
- Good, because transcript фіксує проходження тестів після ключових кроків: `Tests 2341 passed`, `post-tool-use-fix.test.mjs` — 11 passed, `conftest verify lint_text 5/5`, `lint_style_yml 4/4`.
- Bad, because видалення публічних `fix`/`check`/`fix-run` є breaking change для зовнішніх споживачів, які викликали ці команди напряму.
- Neutral, because `rules/lint/fix.mjs` зареєстровано як no-op для правила `lint`; transcript згадує потенційну неоднозначність, але не класифікує її як підтверджену проблему.

## More Information

- CLI: `npm/bin/n-cursor.js`.
- Оркестратор lint: `npm/scripts/lint-cli.mjs` → `npm/rules/lint/js/orchestrate.mjs`.
- Нове правило: `npm/rules/lint/meta.json`, `npm/rules/lint/fix.mjs`.
- Conformance-рушій: `npm/skills/fix/js/orchestrator.mjs`, `t0.mjs`, `llm-worker.mjs` → `npm/scripts/lib/fix/orchestrator.mjs`, `t0.mjs`, `llm-worker.mjs`.
- PostToolUse-хук: `npm/scripts/post-tool-use-fix.mjs`, `npm/scripts/tests/post-tool-use-fix.test.mjs`; видалено `routeFilePathToRules`, `ROUTES`, `picomatch`.
- Видалені публічні команди: `fix`, `check`, `fix-run`; внутрішні `_fix-check` і `fix-t0` збережені.
- Видалений skill: `npm/skills/fix/SKILL.md`, `npm/skills/fix/meta.json`, `.cursor/skills/n-fix/SKILL.md`, `.claude/commands/n-fix.md`.
- Хук `hk.pkl`: `fix changelog` замінено на `lint changelog`.
- CI read-only: `.github/workflows/lint-text.yml` використовує `n-cursor lint-text --read-only`, `.github/workflows/lint-style.yml` запускає `npx stylelint '**/*.{css,scss,vue}'` без `--fix`.
- Синхронні canon-точки CI: `rules/text/policy/lint_text/template/lint-text.yml.snippet.yml`, `rules/text/js/formatting.mjs`, `rules/text/policy/lint_text/lint_text_test.rego`, `rules/style-lint/policy/lint_style_yml/template/lint-style.yml.snippet.yml`, `rules/style-lint/policy/lint_style_yml/lint_style_yml_test.rego`, `.cursor/rules/n-text.mdc`.
- Паралельний ESLint: дозволено для диз'юнктних per-file наборів, whole-tree прогони того самого корпусу мають серіалізуватися.
- Гілка роботи: `claude/lint-fix-readonly-unification`; transcript фіксує скидання `main` до `origin/main` і подальший fast-forward merge.

## Update 2026-06-14

- CI-воркфлоу `lint-text.yml` і `lint-style.yml` переведено в read-only режим: `n-cursor lint-text --read-only` і `npx stylelint` без `--fix`.
- Канон синхронізовано в workflow snippets, Rego-тестах, JS-перевірках і `.cursor/rules/n-text.mdc`.
- Transcript фіксує коміт `11aa4f92` і проходження integration-тестів `checkText` та `checkStyleLint` після синхронного оновлення.

## Update 2026-06-14

- Чернетка деталізує кілька підрішень того самого рефакторингу: `lint --full` поглинає conformance-фазу, `lint` приймає фільтр правил замість колишнього `fix <rules>`, PostToolUse переходить на один read-only детект без file→rules routing.
- Додатково зафіксовано переміщення conformance-рушія з `npm/skills/fix/js/` до `npm/scripts/lib/fix/`, повне видалення `/n-fix`, ізоляцію роботи в feature-гілці `claude/lint-fix-readonly-unification` і релаксацію політики паралельного ESLint для диз'юнктних файлів.
- CI lint-text/lint-style read-only дублює окрему чернетку цього ж батчу й лишається частиною того самого наскрізного рішення.
