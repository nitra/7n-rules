---
session: 5b1fe868-1645-45e6-a51c-526830d72c9a
captured: 2026-05-29T16:41:16+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/5b1fe868-1645-45e6-a51c-526830d72c9a.jsonl
---

## ADR Виправлення директиви `shellcheck source` для sourced-скриптів у hook-файлах

## Context and Problem Statement
`shellcheck` завалювався на SC1091 (info-level) при перевірці `.claude/hooks/capture-decisions.sh` та `.claude/hooks/normalize-decisions.sh`. Директива `# shellcheck source=npm/.claude-template/hooks/lib/tooling-only.sh` вказувала на абсолютний відносний шлях, недоступний shellcheck без прапора `-x`, а фінальний прогін у `run-shellcheck.mjs` запускається без `-x`. Будь-який ненульовий код із shellcheck у `runFinalShellcheck` призводить до падіння `lint-text`.

## Considered Options
* Замінити директиву на відносний `source=lib/tooling-only.sh` з додаванням `disable=SC1091` в тому самому рядку
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити директиву на відносний `source=lib/tooling-only.sh` з додаванням `disable=SC1091`", because відносний шлях узгоджений із фікстурою тесту `sync-claude-config.test.mjs` і працює як для темплейту, так і для проєктної копії під `-x`; `disable=SC1091` глушить info-рівень, коли shellcheck запускається без `-x`.

### Consequences
* Good, because `shellcheck` виходить з кодом `0` на всіх чотирьох hook-файлах після правки.
* Bad, because `disable=SC1091` приховує потенційні майбутні помилки sourcing у цих файлах.

## More Information
Змінено чотири файли:
- `.claude/hooks/capture-decisions.sh` (рядок 39)
- `.claude/hooks/normalize-decisions.sh` (рядок 44)
- `npm/.claude-template/hooks/capture-decisions.sh` (рядок 39)
- `npm/.claude-template/hooks/normalize-decisions.sh` (рядок 44)

Стара директива: `# shellcheck source=npm/.claude-template/hooks/lib/tooling-only.sh`
Нова директива: `# shellcheck source=lib/tooling-only.sh disable=SC1091`

Перевірку підтверджено командою: `shellcheck .claude/hooks/capture-decisions.sh .claude/hooks/normalize-decisions.sh npm/.claude-template/hooks/capture-decisions.sh npm/.claude-template/hooks/normalize-decisions.sh` → `exit: 0`
