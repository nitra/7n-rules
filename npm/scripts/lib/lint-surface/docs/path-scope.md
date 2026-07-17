---
type: JS Module
title: path-scope.mjs
resource: npm/scripts/lib/lint-surface/path-scope.mjs
docgen:
  crc: 0971e78e
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.94
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл звужує `n-rules lint --path <dir>` до каталогу всередині вже вибраного кореня прогону, не змінюючи сам root і не підміняючи правила з `.n-rules.json`. Він збирає всі файли під заданою піддиректорією та передає їх у `buildPlan` як `explicitFiles`, тим самим шляхом, що вже живить `hook --post-tool-use`/`--stop`; per-file concerns фільтруються за цими файлами, а `full`-scope concerns запускаються при збігу glob і все одно проходять whole-repo.

## Поведінка

1. `collectPathScopedFiles` приймає корінь прогону та значення `--path`, звужує область lint до каталогу всередині цього кореня й не змінює сам корінь прогону.
2. `collectPathScopedFiles` відхиляє шлях, якщо він веде поза межі кореня або не є каталогом.
3. `collectPathScopedFiles` збирає всі файли в межах вказаного каталогу, відсікаючи виключення з кореневих ignore-налаштувань і `.gitignore`-поведінки, а порожній каталог вважає валідним порожнім результатом.
4. `collectPathScopedFiles` повертає відсортований список шляхів відносно кореня прогону у форматі, придатному для передачі в `buildPlan` як `explicitFiles`.

## Публічний API

- collectPathScopedFiles — збирає posix-відносні від `cwd` шляхи всіх файлів у каталозі з `--path`, з урахуванням `.gitignore` і `.n-rules.json:ignore` у корені; порожній каталог повертає порожній набір без помилки

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
