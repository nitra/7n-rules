---
type: JS Module
title: run-detectors.mjs
resource: npm/scripts/lib/lint-surface/run-detectors.mjs
docgen:
  crc: e24c747b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
---

## Огляд

Detect-only оркестратор unified lint surface (`n-rules lint --no-fix`).

Discovery → scope-selection → `lint(ctx)` per concern → нормалізовані violations.
Без мутацій, без LLM. Fix-pipeline (T0 + ladder) обгортає цей модуль і споживає
його violations; сам detect ніколи не пише в дерево.

## Поведінка

DEFAULT_RULES_DIR надає вбудований корінь із правил у випадку відсутності вказівок користувача.

buildDetectPlan будує упорядкований план прогону, що є спільним джерелом для режиму виявлення та конвеєра виправлень.

loadEnabledLintRules виконує пошук для споживачів поза конвеєром виявлення/виправлення, повертаючи концерни та множину активних правил на основі `.n-rules.json`.

computeActiveDomains визначає статус домену (rule-id) для заданого файлового набору, що є єдиним джерелом правди для сценаріїв `ci plan`.

detectAll запускає прохід виявлення, повертаючи зібрані порушення, код виходу та список виконаних ентрі, де відсутній параметр, що визначає базову точку дельти.

## Публічний API

- DEFAULT_RULES_DIR — Цей файл: npm/scripts/lib/lint-surface/run-detectors.mjs → PACKAGE_ROOT = npm (4 dirname угору).
- buildDetectPlan — Будує план прогону для заданих опцій (discovery + scope-table).
Спільне джерело для detect-only і fix-pipeline.
- loadEnabledLintRules — Discovery-фасад для споживачів поза detect/fix-конвеєром (`ci plan`):
concerns за rule-id (ядро + плагіни, capability-фільтр) і set активних правил.
- computeActiveDomains — Активність доменів (rule-id) для заданого файлового набору — єдине джерело
правди для `ci plan`: домен «активний», якщо хоч один його **per-file**
concern тригериться на цих файлах (та сама таблиця `planConcernForDelta`,
що й `lint <domain> --path` → «plan сказав true» ⇔ «lint щось запустить»,
тепер порт у `rules_core::lint_plan` — glob-збіг рахує native
`matchLintGlobs`, єдине джерело правди по обидва боки, doc-комент модуля
`rules_core::lint_plan`). Правила без жодного per-file concern не
потрапляють у результат (їхні full-scope перевірки — справа `--repo-wide`).
- detectAll — Запускає detect-only прохід. Повертає всі violations і похідний exitCode.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/run-detectors.test.mjs` (detectAll — exit codes; detectAll — scoping) — clean → exit 0; violations → exit 1, ruleId/concernId домішані з ctx; detector кидає → exit 2; невалідний violation (без reason) → exit 2; absolute file-path відхиляється → exit 2; ще 16

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
