---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/js/eslint/main.mjs
docgen:
  crc: fd74e843
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`lint` формує read-only lint-поверхню для JS-коду проєкту на основі `oxlint` і `eslint`: `filterJsFiles` відсіює не-JS файли, `toViolation` нормалізує знайдені порушення, а `lint` зводить результат у спільний звіт. Окреме виправлення через `oxlint --fix` і `eslint --fix` винесене в `fix-eslint.mjs` і не входить до detector-логіки. Файл не виконує власних операцій запису.

## Поведінка

`lint` спочатку відсіює не-JS файли через `filterJsFiles`, а далі працює лише з JS-подібним набором. Для кожного запуску збираються результати з двох read-only джерел: eslint і oxlint; обидва під час аналізу ігнорують worktree-checkout копії репозиторію. Якщо аналіз йде по конкретних файлах, `lint` звіряє знахідки з доданими рядками й розділяє їх на introduced та pre-existing, щоб помилки в новому коді йшли як error, а вже існуючі — як warn. Якщо файл не потрапляє в JS-набір, `lint` повертає порожній результат без звернення до лінтерів.

`toViolation` приводить знайдену проблему до спільного формату, зберігаючи прив’язку до файлу в межах поточного робочого каталогу та нормалізуючи шлях для подальшого показу в результаті `lint`. Комбінація `filterJsFiles`, збору знахідок і `toViolation` формує єдиний потік: від початкового списку файлів до уніфікованого переліку порушень із рівнем важливості, придатним для read-only detector-поверхні.

## Публічний API

- toViolation — Finding → LintViolation.
- lint — Detector js/eslint: per-file (classify introduced/pre-existing).
- filterJsFiles — відбирає лише JavaScript-файли, які потрібно враховувати для подальшої обробки.

## Сценарії використання

- `plugins/lang-js/rules/js/eslint/tests/main.test.mjs` (toViolation; filterJsFiles) — відносний finding.file (oxlint-стиль) → relative без; абсолютний finding.file (eslint API) → relative проти cwd; лишає лише js-подібні розширення; порожній вхід → порожній вихід; files із непорожнім списком → аналіз лише цих файлів; ще 3
- `plugins/lang-js/rules/js/tests/main.test.mjs` (filterJsFiles) — лишає лише js-подібні розширення; порожній вхід → порожньо

## Гарантії поведінки

- Власних операцій запису у файлі немає; виклики імпортованих модулів можуть писати.
