---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/js/eslint/main.mjs
docgen:
  crc: 2af5dfb4
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

lint-поверхня для js/eslint працює як read-only detector: вона відбирає JS-файли, нормалізує знахідки через `toViolation` і повертає підсумок через `lint`. Це потрібно, щоб окремо фіксувати статичні проблеми без зміни коду; виправлення винесене в окремий T0 `fix-eslint.mjs`, а не в detector.

## Поведінка

lint-поверхня працює як read-only detector: `lint` відбирає JS-подібні файли через `filterJsFiles`, запускає статичну перевірку по всьому проєкту або лише по переданому набору, зводить результати з двох джерел і повертає лише нормалізовані порушення. Для повного проходу всі знахідки одразу стають помилками; для часткового — результати додатково розділяються на нові й уже наявні, щоб нові блокували зміни, а старі лишалися як warning. `toViolation` уніфікує формат виходу: зберігає прив’язку до файла відносно робочого каталогу, додає рядок і джерело інструмента та приводить повідомлення до спільного вигляду. Дані входять із файлового списку або з повного сканування дерева, а виходять лише як масив violations без жодних побічних змін.

## Публічний API

- toViolation — Finding → LintViolation.
- lint — Detector js/eslint: per-file (classify introduced/pre-existing) або full-project.
- filterJsFiles — відбирає лише JavaScript-файли з вхідного списку, щоб подальша обробка працювала тільки з релевантними файлами

## Сценарії використання

- `plugins/lang-js/rules/js/eslint/tests/fix-worker.test.mjs` (js/eslint fixWorker) — без violations.file → touchedFiles: [], runAgentFix не викликається; два файли, обидва успішні → runAgentFix викликається по разу на файл, targetFiles/caller коректні, touchedFiles з обох; два файли — обидва стартують одразу (пул ≥ 2),; черга з > MAX_PARALLEL_FILES: файл поза першою хвилею не стартує, якщо дедлайн уже настав; файл, що кидає виняток (не структурований error) — не валить решту пулу; ще 2
- `plugins/lang-js/rules/js/eslint/tests/main.test.mjs` (toViolation; filterJsFiles) — відносний finding.file (oxlint-стиль) → relative без; абсолютний finding.file (eslint API) → relative проти cwd; лишає лише js-подібні розширення; порожній вхід → порожній вихід; files === undefined → whole-project, oxlint + eslint через relative(cwd, resolve(cwd, …)); ще 3
- `plugins/lang-js/rules/js/tests/main.test.mjs` (filterJsFiles) — лишає лише js-подібні розширення; порожній вхід → порожньо

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
