---
session: 31bcf47f-efb3-4015-bd75-1a07def77614
captured: 2026-06-14T21:31:29+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/31bcf47f-efb3-4015-bd75-1a07def77614.jsonl
---

## ADR Дві незалежні осі виконання `n-cursor lint`

## Context and Problem Statement
Оркестратор `n-cursor lint` (`npm/rules/lint/js/orchestrate.mjs`) охоплює два принципово різні типи перевірок: запуск сторонніх лінтерів (eslint/stylelint/cspell/тощо) по файлах і конформність-перевірку правил пакета. Потрібно було визначити, яка з цих осей керується списком активних правил у `.n-cursor.json` користувача, а яка — ні.

## Considered Options
* Єдина фаза, де `.n-cursor.json` гейтить усе (і лінтери, і конформність)
* Дві незалежні осі: per-file лінтер-скан керується `meta.json` пакета; конформність-фаза — `.cursor/rules/*.mdc`, що синхронізуються з `.n-cursor.json`

## Decision Outcome
Chosen option: "Дві незалежні осі", because `selectLintRules` читає `meta.json` самого пакета (не `.n-cursor.json`), а конформність-фаза (`runFixCheck` / `runOrchestratorCli`) робить discovery через `listProjectRulesMdcFiles` → `.cursor/rules/*.mdc`, які генеруються `sync`'ом зі списку `rules` у `.n-cursor.json`.

### Consequences
* Good, because лінтери (eslint, stylelint тощо) завжди прогоняться по всьому доступному набору per-file правил пакета незалежно від того, що вписано у `.n-cursor.json` користувача — не виникає ситуації, де неактивоване правило дозволяє некоректний код.
* Bad, because поведінка неочевидна: при одному активному правилі у `.n-cursor.json` `lint` (без `--full`) все одно запускає повний лінтер-скан усіх per-file правил пакета (`doc-files`, `js-lint`, `security`, `style-lint`, `text`), що може здивувати розробника, який очікував «одне правило = одна перевірка».

## More Information
- Файл оркестратора: `npm/rules/lint/js/orchestrate.mjs` (141 рядок)
- Per-file правила беруться з `meta.json` пакета (`"lint": "per-file"`): `doc-files`, `js-lint`, `security`, `style-lint`, `text`; full-only: `ga`, `js-lint-ci`, `rego`
- Per-file `lint.mjs` (напр. `npm/rules/js-lint/js/lint.mjs`) не імпортує і не читає `.n-cursor.json` — підтверджено прямим переглядом коду
- Конформність-discovery: `npm/scripts/lib/discover-check-rules-from-cursor.mjs` + `npm/scripts/lib/list-project-rules-mdc.mjs`
- Конформність-фаза активується лише при `--full` (або `lint-ci` = `--read-only --full`)
- Схема конфігу: `.n-cursor.json` → поле `rules[]` → `sync` → `.cursor/rules/*.mdc` → discovery конформності

---

## ADR Fail-fast у per-file фазі `lint`

## Context and Problem Statement
При послідовному обході per-file правил (`doc-files`, `js-lint`, `security`, `style-lint`, `text`) треба визначити, чи продовжувати перевірку після першого ненульового exit-коду, чи зупинитися.

## Considered Options
* Fail-fast: перший ненульовий код зупиняє весь прогін
* Collect-all: зібрати всі результати, повернути єдиний звіт

## Decision Outcome
Chosen option: "Fail-fast", because в блок-схемі та коді `orchestrate.mjs` прямо зафіксовано: `code !== 0 → return code ❌ (fail-fast)` — наступні правила не запускаються.

### Consequences
* Good, because transcript фіксує очікувану користь: швидше завершення при першій помилці, менше зайвого шуму у виводі.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — невідомо, чи це заважає побачити решту порушень за один прогін.

## More Information
- Логіка fail-fast описана в `npm/rules/lint/js/orchestrate.mjs`
- Spec-посилання у JSDoc оркестратора: `2026-06-14-lint-rule-consolidation` і `2026-06-14-lint-orchestrator-fix-readonly-unification`
- Додаткової інформації в transcript не зафіксовано.
