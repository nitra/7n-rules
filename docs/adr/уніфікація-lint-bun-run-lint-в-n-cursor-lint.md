---
type: ADR
title: "Уніфікація lint-інфраструктури: прибирання кореневого bun run lint на користь n-cursor lint"
---

# Уніфікація lint-інфраструктури: прибирання кореневого bun run lint на користь n-cursor lint

**Status:** Accepted
**Date:** 2026-06-20

## Context and Problem Statement

У проєкті співіснували два механізми лінту: кореневий скрипт `bun run lint` (послідовний ланцюжок із 9 кроків у `package.json`) і `n-cursor lint` (data-driven оркестратор із `npm/rules/lint/js/orchestrate.mjs`, що читає `lint`-scope із `meta.json` кожного правила). Аналіз показав, що 7 із 9 кроків `bun run lint` вже покриті `n-cursor lint --full`; залишилися дві прогалини (python-правило та oxfmt) і зайві обгортки в `package.json`.

## Considered Options

* Влити `bun run lint` у `n-cursor lint` — видалити кореневий `"lint"` і зайві `"lint-*"` скрипти, інтегрувати python-правило, оновити skill `/n-lint`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Влити `bun run lint` у `n-cursor lint`", because `n-cursor lint --full` покриває всі потрібні правила після мінімальних змін; кореневий скрипт стає зайвою оберткою.

Конкретні зміни:
- `npm/rules/python/lint/lint.mjs` → новий адаптер `npm/rules/python/js/lint.mjs` (оркестратор шукає `<rule>/js/lint.mjs`, рядок 24 `orchestrate.mjs`)
- `npm/rules/python/meta.json`: додано `"lint": "full"`
- `package.json`: видалено `"lint"`, `"lint-doc-files"`, `"lint-js"`, `"lint-python"`, `"lint-rego"`, `"lint-security"`, `"lint-style"`
- `package.json`: залишено `"lint-ga"` (потрібен `lint-ga.yml`) і `"lint-text"` (потрібен `lint-text.yml`)
- `.cursor/skills/n-lint/SKILL.md`: замінено всі `bun run lint` → `n_cursor_npx lint --full`

CI-воркфлоу (`.github/workflows/lint-*.yml`) не зачіпаються — вони або викликають `bun run lint-ga` / `bun run lint-text` (які лишаються), або звертаються до інструментів напряму (`bunx oxlint`, `npx stylelint`, GH Action `trufflesecurity/trufflehog@main`).

### Consequences

* Good, because transcript фіксує очікувану користь: єдина точка запуску лінту (`n-cursor lint --full`), без дублювання логіки між `package.json` і `orchestrate.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/rules/lint/js/orchestrate.mjs:24` — `const lintPath = join(ruleDir, 'js', 'lint.mjs')`
- `npm/rules/lint/js/orchestrate.mjs:93` — `const code = await mod.lint(changed, cwd, { readOnly, llmFix })`
- `npm/bin/n-cursor.js:14-18` — документація флагів: `lint` (дельта, per-file), `lint --full` (весь репо, per-file + full), `lint --read-only --full` (CI)
- `.github/workflows/lint-ga.yml:42` — `run: bun run lint-ga`
- `.github/workflows/lint-text.yml:61` — `run: bun run lint-text`
