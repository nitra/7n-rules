---
type: JS Module
title: main.mjs
resource: npm/rules/graphql/tooling/main.mjs
docgen:
  crc: d341d8e0
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл відповідає за перевірку наявності необхідних умов для використання GraphQL у проєкті. Він констатує, чи існує файл конфігурації за визначенням константи `GRAPHQL_RC_FILENAME` (".graphqlrc.yml"), і перевіряє, чи встановлене у VS Code необхідне розширення з ідентифікатором `REQUIRED_GRAPHQL_VSCODE_EXTENSION` ("graphql.vscode-graphql"), спираючись на конфігурацію `extensions.json`. При виявленні відсутності цих елементів, код ініціює повідомлення відповідно до маркерів (graphql.mdc), щоб повідомити про необхідність налаштування.

## Поведінка

GRAPHQL_RC_FILENAME: Позначає очікуваний файл конфігурації GraphQL у корені проєкту.
REQUIRED_GRAPHQL_VSCODE_EXTENSION: Вказує необхідне розширення VS Code для підтримки GraphQL.
main: Виконує повну перевірку конфігурації GraphQL, скануючи джерела на наявність GraphQL tagged template та валідуючи відповідність конфігурацій.

Поведінка:
GRAPHQL_RC_FILENAME — Позначає очікуваний файл конфігурації GraphQL у корені проєкту.
REQUIRED_GRAPHQL_VSCODE_EXTENSION — Вказує необхідне розширення VS Code для підтримки GraphQL.
main — Виконує повну перевірку конфігурації GraphQL, скануючи джерела на наявність GraphQL tagged template та валідуючи відповідність конфігурацій. При виявленні GraphQL tagged template повідомляє про необхідність наявності `.graphqlrc.yml` та перевіряє конфігурацію `extensions.json` відповідно до `graphql.mdc`.

## Публічний API

- GRAPHQL_RC_FILENAME — Вказує на очікуваний конфігураційний файл GraphQL у корені проєкту.
- REQUIRED_GRAPHQL_VSCODE_EXTENSION — Визначає необхідне розширення VS Code для роботи з GraphQL.
- main — Перевіряє наявність конфігурації `.graphqlrc.yml` та розширення `graphql.vscode-graphql`, якщо в коді є шаблони, марковані `gql`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
