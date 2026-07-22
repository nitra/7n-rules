---
type: JS Module
title: run-detectors.mjs
resource: npm/scripts/lib/lint-surface/run-detectors.mjs
docgen:
  crc: a0f45fc3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл є детектором для уніфікованої поверхні лінту, який сканує код без внесення змін. Він виконує процес вибору області перевірки (`scope-selection`), збирає всі виявлені порушення (`normalized violations`) для кожного аспекту (`concern`) відповідно до конфігурації `.n-rules.json`. Цей компонент працює у режимі `Detect-only`, тобто він не вносить жодних мутацій і не використовує LLM. Порушення передаються до пайплайну виправлення (Fix-pipeline) для подальшої обробки.

## Поведінка

Поведінка
DEFAULT_RULES_DIR визначає шлях до стандартної директорії з правилами.
buildDetectPlan створює впорядкований план прогону лінтера, збираючи всі відповідні концерни та визначаючи область їх сканування.
detectAll виконує прохід лінтера у режим детекції, збираючи всі виявлені порушення та повертаючи код виходу.

**Внутрішній паралелізм (ADR 260716-1354-внутрішній-паралелізм-lint-оркестратора).** `detectAll` читає `N_RULES_LINT_CONCURRENCY` (дефолт `1` — production-паралелізм ще не пройшов benchmark-gates ADR): за замовчуванням план виконується повністю послідовно (`detectPlanSequentially`), спостережувано ідентично до-ADR поведінці. При `concurrency > 1` план ділиться на два лейни через `blocking-inventory.mjs` (`isSerialLane`) і виконується через `scheduler.mjs` (`runPlanConcurrently`, `detectPlanConcurrently`): parallel lane — доведені non-blocking concern-и, bounded pool до `concurrency`; serial lane — решта, строго послідовно. Перший `DetectorError` (будь-який лейн) зупиняє нові старти, `AbortController` сигналізує вже запущеним async-детекторам (`ctx.signal`), а вже завершені concern-и лишаються в результаті — `exitCode 2` пріоритетний над частковими violations. Фінальний масив violations завжди стабільно сортується за `(ruleId, concernId, file, data.line, reason)` — незалежно від порядку завершення (`sortViolations`), навіть при `concurrency=1`.

## Публічний API

* DEFAULT_RULES_DIR — Містить набір стандартних правил для перевірок.
* buildDetectPlan — Створює план виконання перевірок, охоплюючи визначені області.
* detectAll — Виконує повний прохід пошуку проблем і повертає всі виявлені порушення та код виходу.
* loadEnabledLintRules — Discovery-фасад для споживачів поза detect/fix-конвеєром (`ci plan`): concerns за rule-id + set активних правил.
* computeActiveDomains — Активність доменів для файлового набору (лише per-file concerns) — єдине джерело правди для `ci plan`: «plan сказав true» ⇔ «lint щось запустить».

**Осі плану (сервіс-канон):** scoped + explicit files (`lint js --path <dir>`) → лише per-file concerns названих правил × перетин; `pathMode` (дефолтний `--path`) → full-scope concerns виключені з delta-плану; `repoWide` (`--repo-wide`) → ЛИШЕ full-scope concerns enabled-правил, whole-repo (окремий CI-workflow, не гейтить деплой).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).

**Multi-dir (плагіни):** `effectiveRulesDirs` додає rules-каталоги плагінів з `.n-rules.json` (hot-path: без install, quiet); `readLintConcernsByRuleMulti` зливає концерни за іменем (перший власник виграє) — плагін може додавати концерни до правила ядра (mixin).

**Capability-гейт:** `filterByCapabilities` відкидає концерни з незадоволеним `requires.capability` (capabilities надають встановлені плагіни через маніфест `n-rules.capabilities`; явний `opts.capabilities` у тестах перекриває резолв).

**Warning про rule-id без concern-ів:** якщо rule-id з `.n-rules.json#rules` не має жодного concern-а серед усіх `rulesDirs` (ядро + плагіни) — `console.error` попереджає про можливий дрейф конфігу (типово: правило переїхало в плагін, якого консюмер не підключив у `plugins[]`). Rule-id з існуючим каталогом, але без `concern.json` (документаційні правила на кшталт `feedback`), warning не тригерить.
