---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T11:22:17+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
superseded_by: 20260523-114913-перенесення-single-rule-сканерів-з-scripts-utils-у-rules-fix.md
---

> **Superseded by [20260523-114913-перенесення-single-rule-сканерів-з-scripts-utils-у-rules-fix.md](./20260523-114913-перенесення-single-rule-сканерів-з-scripts-utils-у-rules-fix.md)** — повніший аналіз показав, що canonical-файли мають єдиного консьюмера (js-lint), і конвенція проєкту вимагає тримати такі модулі поряд із check'ом правила.

## ADR Розміщення canonical-конфігів у `npm/scripts/utils/`

## Context and Problem Statement
Виникло питання: чому `knip-canonical.json` зберігається в `npm/scripts/utils/`, а не в директорії темплейтів відповідного правила `js-lint`. Дослідження контексту показало, що аналогічний патерн вже застосований до `oxlint-canonical.json` та `oxlint-canonical-skeleton.json`.

## Considered Options
* Зберігати canonical-файли в `npm/scripts/utils/` (поточний стан)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Зберігати canonical-файли в `npm/scripts/utils/`", because всі аналогічні canonical-конфіги (`oxlint-canonical.json`, `oxlint-canonical-skeleton.json`) вже розташовані там само; директорій `templates` в `npm/` не існує; файли є спільним ресурсом (referenced з `.mdc`-правил, `check.mjs`, rebuild-скриптів), а не артефактом конкретного правила.

### Consequences
* Good, because єдине місце для всіх canonical baseline-конфігів: `knip-canonical.json`, `oxlint-canonical.json`, `oxlint-canonical-skeleton.json` — спрощує навігацію та rebuild-скрипти (наприклад, `rebuild-oxlint-canonical.mjs`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли, що підтверджують рішення:
- `npm/scripts/utils/knip-canonical.json` — canonical baseline для `knip.json` у проєктах
- `npm/scripts/utils/oxlint-canonical.json`, `oxlint-canonical-skeleton.json` — аналоги для oxlint
- `npm/scripts/utils/rebuild-oxlint-canonical.mjs` — rebuild-скрипт, що живе поруч з canonical-файлами
- Споживачі: `.cursor/rules/n-js-lint.mdc` (рядок 89), `npm/rules/js-lint/js-lint.mdc`, `npm/rules/js-lint/fix/tooling/check.mjs`
