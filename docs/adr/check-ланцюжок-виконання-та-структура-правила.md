---
type: ADR
title: "Ланцюжок виконання правил @nitra/cursor check та мінімальна структура правила"
---

# Ланцюжок виконання правил @nitra/cursor check та мінімальна структура правила

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

В архітектурі `@nitra/cursor` є CLI-команда `npx @nitra/cursor check`, яку запускає скіл `/n-fix`. Виникла потреба зрозуміти повний ланцюжок виконання — від CLI до Rego-поліс — та визначити мінімальну обов'язкову структуру нового правила.

## Рішення/Процедура/Факт

**Ланцюжок виконання:**

1. `/n-fix` (skill) → `npx @nitra/cursor check` → `npm/bin/n-cursor.js` → `runChecks()`.
2. `discoverCheckScripts()` сканує `npm/rules/*/js/check.mjs` — правило потрапляє в список лише якщо цей файл існує.
3. `discoverCheckRulesFromAgentsMd()` фільтрує список через `AGENTS.md` проєкту, не через `.n-cursor.json`. Якщо правило не згадане в `AGENTS.md`, воно не запускається навіть за наявності у `.n-cursor.json`.
4. Для кожного id виконується `import('npm/rules/<id>/js/check.mjs').check()` — послідовно.
5. Усередині `check.mjs`: JS-обгортка → `runConftestBatch()` → `spawnSync('conftest', ['test', ...files, '-p', policyAbs, '--namespace', ns, '--output', 'json'])` → parse JSON → `fail(msg)`.
6. Rego-deny-правила живуть у `npm/rules/<id>/policy/<name>/<name>.rego`, пакет `<id>.<name>`, gate за `input.kind`.

**Мінімальна структура нового pure-Rego правила:**

```
npm/rules/<id>/
├── <id>.mdc
├── auto.md            (опційно)
├── js/
│   ├── check.mjs      ← обов'язковий (тонкий orchestrator)
│   └── check.test.mjs
└── policy/
    └── <name>/
        ├── <name>.rego
        └── <name>_test.rego
```

`check.mjs` залишається мінімальним: gating (чи правило застосовне), `existsSync` для кожного target-файлу, один виклик `runConftestBatch` на кожен `policy/<name>/`. Батч файлів одного типу (наприклад, усі `HealthCheckPolicy`-YAML) передається одним масивом. Пакет Rego-файлу: `<id>.<name>`, синтаксис: `import rego.v1`, `deny contains msg if { ... }` з gate за `input.kind`.

## Обґрунтування

Така архітектура дозволяє JS вирішувати cross-file логіку (readdir, glob, gating), а Rego — перевіряти per-document структуру. `js/check.mjs` є єдиною обов'язковою точкою входу: без неї `discoverCheckScripts()` не включає правило в `available` і CLI його не запускає.

## Розглянуті альтернативи

Pure-Rego без JS-обгортки — неможливо в поточній архітектурі CLI: `discoverCheckScripts()` вимагає наявності `js/check.mjs`. Підхід із декларативним `target.json` для усунення цього обмеження описано в окремому ADR `rego-target-json-декларативний-контракт.md`.

## Зачіпає

`npm/bin/n-cursor.js` (`discoverCheckScripts`, `runChecks`, `discoverCheckRulesFromAgentsMd`), `npm/scripts/utils/run-conftest-batch.mjs`, `npm/rules/*/js/check.mjs`, `npm/rules/*/policy/**/*.rego`

## Update 2026-05-15

### Фільтрація правил через `AGENTS.md`, а не `.n-cursor.json`

Критичний інваріант: `discoverCheckRulesFromAgentsMd(available)` читає кореневий `AGENTS.md`, виловлює `rules/<id>.mdc`-посилання і фільтрує по `available` — це фактичний список правил для прогону. Якщо `AGENTS.md` не пересинхронізований після додавання правила у `.n-cursor.json` — `check` правило **не запустить** без жодного повідомлення про помилку.

Роздільність відповідальності: `.n-cursor.json` — конфіг для синхронізатора; `AGENTS.md` — декларація активних правил для агентів і CLI. Ця конвенція гарантує, що те, що задокументовано для агентів, і те, що перевіряється CLI, завжди збігається.

**Повний ланцюжок виконання:**
1. `/n-fix` skill → `npx @nitra/cursor check`
2. `npm/bin/n-cursor.js` → `runChecks([])`: `discoverCheckScripts()` сканує `rules/*/js/check.mjs`; `discoverCheckRulesFromAgentsMd(available)` фільтрує по `AGENTS.md`.
3. Для кожного правила: `await import('rules/<id>/js/check.mjs').check()`.
4. `check.mjs` → self-guard по `.n-cursor.json:rules` → JS-перевірки і `runConftestBatch`.
5. `runConftestBatch` → `spawnSync('conftest', ['test', ...files, '-p', policyAbs, '--namespace', ns, '--output', 'json'])` → парсинг `deny`-повідомлень → `fail(msg)`.

**Зачіпає:** `npm/bin/n-cursor.js` (`discoverCheckScripts`, `discoverCheckRulesFromAgentsMd`, `runChecks`), `npm/scripts/utils/run-conftest-batch.mjs`, `npm/rules/*/js/check.mjs`
