# `isRunAsCli(metaUrl)` — параметр замість прямого `import.meta.url`

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

`isRunAsCli()` у `scripts/cli-entry.mjs` і `scripts/lib/run-rule-cli.mjs` порівнювала `import.meta.url` файлу, де функція **визначена**, а не файлу-caller'а. `import.meta` є лексично прив'язаним — у helper він завжди вказував на власний шлях. Через це ~40 callsites у `rules/<id>/fix.mjs`, `lint/*.mjs`, `bin/rename-yaml-extensions.mjs` завжди йшли в else-гілку і скрипти мовчки виходили з кодом 0.

## Considered Options

* Параметр `isRunAsCli(import.meta.url)` — caller передає свій `import.meta.url`; консолідація в один модуль, `run-rule-cli.mjs` робить re-export
* `import.meta.main` — bun-specific, несумісний з Node.js
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Параметр `isRunAsCli(import.meta.url)` з консолідацією", because user явно обрав «Консолідувати в одну реалізацію + параметр»; `import.meta.main` не підходить через Node.js несумісність; re-export зберігає існуючі import-шляхи без масового рефакторингу.

### Consequences

* Good, because `node rules/text/fix.mjs` виводить `🔍 fix text — перевірка правила` і повний звіт замість мовчазного виходу 0.
* Good, because `realpathSync` нормалізує symlink-шляхи (macOS `/tmp` ↔ `/private/tmp`).
* Bad, because ~40 callsites потребували масового оновлення через `sed`.
* Bad, because `realpathSync` додає залежність від FS для symlink-нормалізації.

## More Information

- `npm/scripts/cli-entry.mjs` — `isRunAsCli(metaUrl)` з `realpathSync`
- `npm/scripts/lib/run-rule-cli.mjs` — impl видалено, `export { isRunAsCli } from '../cli-entry.mjs'`
- 40 callsites: `sed -i '' 's/if (isRunAsCli())/if (isRunAsCli(import.meta.url))/g'`
- Нові тести: `npm/scripts/tests/fixtures/cli-entry-as-cli.mjs` + 3 кейси у `npm/scripts/tests/cli-entry.test.mjs`
- Пакет: `1.18.2`; Bun test: 1044 pass, 0 fail
