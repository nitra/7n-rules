# Rego-поліси (conftest) для валідації канонічних GitHub Actions workflow

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

`npm/scripts/check-ga.mjs` (~1 000 рядків JS) містить структурні перевірки канонічних `.github/workflows/*.yml` (concurrency, кроки, тригери тощо), які за природою є декларативними і важко читаються в imperative-стилі. Виникло питання, чи варто перенести ці перевірки до conftest (Open Policy Agent / Rego) для отримання коротшого й декларативного опису правил.

## Рішення

PoC-реалізація: перевірку `validateCleanGaWorkflows` (≈90 рядків JS) перенесено до `npm/policy/ga/clean-ga-workflows.rego`. У `npm/scripts/lint-ga.mjs` додано м'який крок `conftest test` — якщо бінарку `conftest` не встановлено, крок пропускається без помилки (graceful skip). Поле `files` у `npm/package.json` розширено на `policy/`.

## Обґрунтування

60–70% структурних перевірок (concurrency, порядок кроків, заборонені `uses`, канонічна схема workflow) природно виражаються в Rego коротше й читабельніше, ніж у JS. Решта перевірок (існування файлів через `existsSync`, `git ls-files`, preflight на бінарки в PATH) залишається в JS, бо conftest приймає лише input-документи, а не виконує операції з файловою системою. Підхід "soft step" обраний через те, що `conftest` не є обов'язковою залежністю `@nitra/cursor`: встановлено — запускається, відсутнє — мовчки пропускається.

## Розглянуті альтернативи

- Залишити все у `check-ga.mjs` — статус-кво, не скорочує JS-код.
- Повна міграція всіх перевірок до Rego — неможлива: file-existence, git-glob та binary-preflight перевірки у Rego не реалізовуються.
- Жорсткий крок conftest (exit 1 якщо не встановлено) — відхилено: збільшує обов'язкові залежності і ламає `npx @nitra/cursor lint-ga` у свіжих оточеннях.

## Зачіпає

`npm/policy/ga/clean-ga-workflows.rego` (новий файл), `npm/scripts/lint-ga.mjs` (новий soft-крок conftest), `npm/package.json` (поле `files` + версія), `npm/CHANGELOG.md`.
