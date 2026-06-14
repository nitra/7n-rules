---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T13:14:53+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

(output was truncated)
---

## ADR CI lint-text/lint-style: read-only режим у CI

## Context and Problem Statement
CI-воркфлоу `lint-text.yml` і `lint-style.yml` мутували робоче дерево (markdownlint/shellcheck/dotenv з авто-фіксом та `stylelint --fix`). Це суперечить принципу read-only CI після того, як `lint --read-only` стало стандартним інструментом детекту порушень без мутацій.

## Considered Options
* Перейти на `n-cursor lint-text --read-only` та `npx stylelint` без `--fix` у CI, синхронно оновивши всі canon-точки
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Read-only CI через `n-cursor lint-text --read-only` і `npx stylelint` без `--fix`", because `n-cursor` є workspace-symlink на локальне джерело (доступний у CI без окремого кроку встановлення), а `lint-text --read-only` вже реалізований у `bin/n-cursor.js` після попереднього етапу рефакторингу; прибрання `--fix` зі `stylelint` відповідає тому ж принципу нуль-мутацій у CI.

### Consequences
* Good, because transcript фіксує очікувану користь: CI більше не мутує дерево; зміна `lint-text.yml` і `lint-style.yml` пройшла усі integration-тести (`checkText`, `checkStyleLint`) після синхронного оновлення канону.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `.github/workflows/lint-text.yml`, `.github/workflows/lint-style.yml`, `npm/rules/text/policy/lint_text/template/lint-text.yml.snippet.yml`, `npm/rules/text/js/formatting.mjs`, `npm/rules/text/policy/lint_text/lint_text_test.rego`, `npm/rules/style-lint/policy/lint_style_yml/template/lint-style.yml.snippet.yml`, `npm/rules/style-lint/policy/lint_style_yml/lint_style_yml_test.rego`, `npm/rules/style-lint/style-lint.mdc`, `.cursor/rules/n-text.mdc`. Коміт: `11aa4f92`. Канон-інваріант: дзеркало `.cursor/rules/n-text.mdc` регенеровано через `expectedMirrorContent` після зміни snippet.
