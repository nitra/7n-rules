---
type: JS Module
title: tooling.mjs
resource: npm/rules/graphql/js/tooling.mjs
docgen:
  crc: f4c453ac
  score: 100
---

Визначає ім'я файлу конфігурації (`GRAPHQL_RC_FILENAME` = ".graphqlrc.yml") та обов'язкове розширення VS Code (`REQUIRED_GRAPHQL_VSCODE_EXTENSION` = "graphql.vscode-graphql"). Перевіряє наявність конфігурації в `extensions.json` (конфігурація, на яку спирається код) та підтверджує необхідність розширення для роботи з GraphQL (graphql.mdc).

## Поведінка

GRAPHQL_RC_FILENAME: Повертає ім'я файлу конфігурації GraphQL.
REQUIRED_GRAPHQL_VSCODE_EXTENSION: Повертає ім'я розширення VS Code, необхідне для GraphQL.
check: Перевіряє наявність `gql` tagged template у джерелах. Якщо знайдено, вимагає наявності `.graphqlrc.yml` та валідує `.vscode/extensions.json` щодо `graphql.vscode-graphql` (graphql.mdc).

## Публічний API

GRAPHQL_RC_FILENAME — вказує на файл конфігурації GraphQL у корені проєкту (graphql.mdc).
REQUIRED_GRAPHQL_VSCODE_EXTENSION — вимагає встановлення розширення `graphql.vscode-graphql` для роботи з graphql.mdc.
check — перевіряє наявність файлу `.graphqlrc.yml` та розширення `graphql.vscode-graphql` при використанні тегів GraphQL.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
