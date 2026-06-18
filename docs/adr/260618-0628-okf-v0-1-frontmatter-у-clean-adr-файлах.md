---
session: d5fd1451-6223-4192-be09-6f02329c9fc1
captured: 2026-06-18T06:28:15+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d5fd1451-6223-4192-be09-6f02329c9fc1.jsonl
---

## ADR OKF v0.1 frontmatter у clean ADR-файлах

## Context and Problem Statement

ADR-файли після нормалізації (`normalize-decisions.sh`, `normalize-pipeline.mjs`) не мали YAML frontmatter. OKF v0.1 (https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) вимагає від кожного `.md`-файлу валідного YAML frontmatter із непорожнім полем `type`. Без цього файли `docs/adr/` не відповідають специфікації OKF.

## Considered Options

* Мінімальний OKF frontmatter: тільки `type: ADR` + `title:`
* Розширений OKF frontmatter: `type`, `title`, `description`, `tags: [adr]`, `timestamp`
* Не додавати frontmatter (лишитись з чистим MADR v4 minimal)

## Decision Outcome

Chosen option: "Мінімальний OKF frontmatter: тільки `type: ADR` + `title:`", because `type` — єдине обов'язкове поле OKF; `title` залишили як рекомендоване; `description`, `tags`, `timestamp` явно прибрали — надлишкова метадата, яка не несе додаткової цінності для цього каталогу. `# ADR: <заголовок>` heading у тілі файлу прибраний як дублювання `title:` у frontmatter.

### Consequences

* Good, because transcript фіксує очікувану користь: всі 300 clean ADR-ів тепер відповідають OKF §9 Conformance; `validateMadr()` перевіряє `type: ADR` замість відхиляти будь-який frontmatter; тести `normalize-pipeline.test.mjs` проходять 14/14.
* Bad, because `# ADR: title` heading прибраний з тіла — тіло тепер починається з `**Status:**` / `**Дата:**`, що відхиляється від канонічного MADR v4, де H1 є першим рядком.

## More Information

Змінені файли:
- `npm/scripts/lib/adr/normalize-pipeline.mjs` — `GEN_SYS` промпт і `validateMadr()`
- `npm/.claude-template/hooks/normalize-decisions.sh` — `PROMPT_HEADER`, shell-fallback у `rewrite`
- `.claude/hooks/normalize-decisions.sh` — ті ж зміни у project copy
- `npm/rules/adr/adr.mdc` та `.cursor/rules/n-adr.mdc` — опис "Clean" стану
- `npm/scripts/lib/adr/tests/normalize-pipeline.test.mjs` — fixture `good` оновлено

Міграційний скрипт `/tmp/adr-okf-migrate.sh` обробив 300 clean ADR-ів: файли без frontmatter отримали повний OKF блок; файли з частковим frontmatter — доданий рядок `type: ADR`. Наступним кроком `tags: [adr]` та `timestamp:` прибрані з усіх файлів (`remaining tags/timestamp: 0`). `description:` також прибрана як надлишкова.
