---
type: JS Module
title: path-scope.mjs
resource: npm/scripts/lib/lint-surface/path-scope.mjs
docgen:
  crc: 40697c53
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.94
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл звужує `n-rules lint --path <dir>` до каталогу всередині вже вибраного кореня прогону, не змінюючи сам root і не підміняючи правила з `.n-rules.json`. Результат передається у `buildPlan` як `explicitFiles` — тим самим шляхом, що вже живить `hook --post-tool-use`/`--stop`. Два режими збору: дефолтний `--path` — **перетин** піддерева з git-дельтою vs merge-base (сервіс-орієнтований CI-канон: перевіряються лише змінені файли сервісу); `--path --full` — всі файли піддерева (історична поведінка, full-scope concerns при збігу glob ідуть whole-repo).

## Поведінка

1. Обидва збирачі відхиляють шлях, якщо він веде поза межі кореня (traversal через `..`, абсолютний шлях назовні) або не є каталогом; порожній результат — валідний, не помилка.
2. `collectPathScopedChangedFiles` рахує git-дельту vs merge-base (`main` → `origin/main` або явний `baseRef` із `--base`) і лишає тільки файли під `--path`-каталогом, мінус `.n-rules.json:ignore`. Якщо база не резолвиться — повертає `baseResolved: false` без обчислення дельти: caller робить fail-open fallback на повне піддерево (мовчазного скіпу не існує).
3. `collectPathScopedFiles` збирає всі файли піддерева, поважаючи `.gitignore` і `.n-rules.json:ignore` кореня.
4. Обидва повертають відсортовані posix-відносні від `cwd` шляхи.

## Публічний API

- collectPathScopedChangedFiles — перетин git-дельти з піддеревом `--path`: `{ files, baseResolved }`; опція `baseRef` — явна база (`--base <ref>`)
- collectPathScopedFiles — всі файли піддерева `--path` (режим `--full`)
- resolveAndAssertPathDir — резолв і валідація `--path` (усередині `cwd`, існує, каталог); спільний вхід обох збирачів

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
