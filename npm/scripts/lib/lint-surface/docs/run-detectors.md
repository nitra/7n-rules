---
type: JS Module
title: run-detectors.mjs
resource: npm/scripts/lib/lint-surface/run-detectors.mjs
docgen:
  crc: a057f918
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 70
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Detect-only оркестратор unified lint surface (`n-rules lint --no-fix`).

Discovery → scope-selection → `lint(ctx)` per concern → нормалізовані violations.
Без мутацій, без LLM. Fix-pipeline (T0 + ladder) обгортає цей модуль і споживає
його violations; сам detect ніколи не пише в дерево.

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

- `npm/scripts/lib/lint-surface/tests/run-detectors.test.mjs` (detectAll — exit codes; detectAll — scoping) — clean → exit 0; violations → exit 1, ruleId/concernId домішані з ctx; detector кидає → exit 2; невалідний violation (без reason) → exit 2; absolute file-path відхиляється → exit 2; ще 19

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
