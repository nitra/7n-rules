---
session: da76262d-0d25-44b7-a2ee-c5b8e1b76064
captured: 2026-06-01T10:26:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/da76262d-0d25-44b7-a2ee-c5b8e1b76064.jsonl
---

Змінив `alwaysApply: true` → `alwaysApply: false` і виставив glob як у `js-lint`:

```
globs: "**/{.oxlintrc.json,eslint.config.js,.jscpd.json,knip.json,package.json},**/*.{js,mjs,cjs,jsx,ts,tsx}"
```

Тепер `js-lint-ci` прив'язується на ті самі тригери, що й `js-lint` — коли в контексті є JS-файли чи конфіги, а не на кожен контекст.

---

No response required from tool: no code or artifacts modified. Producing ADR only.

## ADR Glob-тригер для `js-lint-ci.mdc` замість `alwaysApply: true`

## Context and Problem Statement
Правило `npm/rules/js-lint-ci/js-lint-ci.mdc` використовувало `alwaysApply: true` з порожнім `globs`. Це робило правило видимим в **кожному** контексті Cursor-агента, навіть там, де JS відсутній — марна ін'єкція. При цьому власний `meta.json` вже мав JS-glob, ідентичний `js-lint`, що робило frontmatter суперечливим.

## Considered Options
* `alwaysApply: true` (порожній `globs`) — інжектити правило завжди
* Glob як у `js-lint` — прив'язати правило лише до JS-контекстів

## Decision Outcome
Chosen option: "Glob як у `js-lint`", because `js-lint` і `js-lint-ci` є сіблінгами з однаковими JS-тригерами; `alwaysApply: true` плутає scope інструмента (`jscpd`/`knip` сканують увесь репо) з тригером прив'язки правила (коли правило релевантне агенту). Відповідність з `meta.json` у цьому ж пакеті стала додатковим аргументом.

### Consequences
* Good, because правило більше не ін'єктується в контексти без JS, що зменшує зайвий шум у промптах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/rules/js-lint-ci/js-lint-ci.mdc` — `alwaysApply: true` → `alwaysApply: false`, `globs` встановлено як `"**/{.oxlintrc.json,eslint.config.js,.jscpd.json,knip.json,package.json},**/*.{js,mjs,cjs,jsx,ts,tsx}"`
- Еталон: `npm/rules/js-lint/js-lint.mdc` — той самий glob-рядок
- `npm/rules/js-lint-ci/meta.json` — `{ "auto": { "glob": ["**/*.mjs", ...] }, "lint": "ci" }` — вже містив JS-glob до зміни
