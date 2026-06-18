---
type: ADR
title: "Виправлення stripJsonComments для glob-патернів у JSON"
---

# Виправлення stripJsonComments для glob-патернів у JSON

**Status:** Accepted
**Date:** 2026-05-18

## Context and Problem Statement

`stripJsonComments` у `npm/scripts/utils/template.mjs` видаляв `/* */` коментарі без розрізнення рядкових літералів. Glob-патерн `**/node_modules/**` у масиві `ignorePaths` файлу `.cspell.json.snippet.json` трактувався як відкриваючий `/*`, а `**/vscode-extension/**` — як закриваючий `*/`. Сім елементів масиву колапсували в один рядок, Rego-перевірка скаржилась на відсутність канонічних glob-ів у `.cspell.json` проєкту.

## Considered Options

- Regex з альтернативою для рядкових літералів: матчить спочатку `"..."` (пропускає вміст), потім `/* */` і `//` коментарі
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Regex з альтернативою для рядкових літералів", because вираз-альтернатива гарантує, що вміст у лапках пропускається нетропропуститим і лише справжні коментарі поза string-літералами видаляються; попередній regex без розрізнення контексту структурно не здатен правильно обробити JSON із glob-патернами в значеннях.

### Consequences

- Good, because усі 26 тестів у `npm/scripts/utils/template.test.mjs` проходять, включно з новим регресійним тестом для glob-патернів із `/*` і `*/`.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файл: `npm/scripts/utils/template.mjs`, функція `stripJsonComments`.
Регресійний тест: `npm/scripts/utils/template.test.mjs` — масив `ignorePaths` з елементами `**/node_modules/**`, `**/vscode-extension/**` тощо.
Реліз: `npm/package.json` 1.13.27 → 1.13.28, запис у `npm/CHANGELOG.md [1.13.28] - ### Fixed`.
