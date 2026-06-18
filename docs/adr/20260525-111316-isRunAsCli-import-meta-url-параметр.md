---
type: ADR
title: "`isRunAsCli(metaUrl)` — параметр замість лексичного прив'язування `import.meta`"
---

# `isRunAsCli(metaUrl)` — параметр замість лексичного прив'язування `import.meta`

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

`isRunAsCli()` у `scripts/cli-entry.mjs` та `scripts/lib/run-rule-cli.mjs` порівнювала `import.meta.url` файла, де функція визначена, а не файла-caller'а. `import.meta` є лексично прив'язаним — у helper-функції він завжди вказує на власний шлях. Через це ~40 callsites у `rules/<id>/fix.mjs`, `lint/*.mjs`, `bin/rename-yaml-extensions.mjs` завжди отримували `false` і виходили мовчки з кодом 0.

## Considered Options

- Параметр `isRunAsCli(import.meta.url)` з консолідацією двох дублікатів; `run-rule-cli.mjs` робить re-export
- `import.meta.main` — bun-specific, несумісний з Node.js
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Параметр `isRunAsCli(import.meta.url)` з консолідацією", because user явно обрав цей варіант; re-export зберігає існуючі import-шляхи у callers без масового рефакторингу; `import.meta.main` не підходить через Node.js несумісність.

### Consequences

- Good, because `node rules/text/fix.mjs` виводить повний звіт замість мовчазного виходу 0.
- Good, because `realpathSync` нормалізує symlink-шляхи (macOS `/tmp` ↔ `/private/tmp`) — перевірено у `cli-entry.test.mjs`.
- Bad, because ~40 callsites потребували масового `sed`-оновлення.
- Bad, because `realpathSync` додає залежність від FS для symlink-нормалізації.

## More Information

- `npm/scripts/cli-entry.mjs` — `isRunAsCli(metaUrl)` з `realpathSync`
- `npm/scripts/lib/run-rule-cli.mjs` — impl видалено; `export { isRunAsCli } from '../cli-entry.mjs'`
- 40 callsites оновлено: `sed -i '' 's/if (isRunAsCli())/if (isRunAsCli(import.meta.url))/g'`
- Нові тести: `cli-entry-as-cli.mjs` (fixture) + 3 кейси у `cli-entry.test.mjs`
- Версія пакета: `1.18.2`; 1044 bun-тести pass
- Пов'язане рішення (та сама сесія): workflow bundling — bump + CHANGELOG мають комітитися в одному коміті з контентними змінами, щоб уникнути циклічної залежності з `npm-module/js/package_structure.mjs`
