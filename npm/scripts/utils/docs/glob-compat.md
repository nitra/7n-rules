---
type: JS Module
title: glob-compat.mjs
resource: npm/scripts/utils/glob-compat.mjs
docgen:
  crc: a226a048
  model: manual
  tier: manual
  score: 100
---

## Огляд

Runtime-нейтральний glob-обхід для коду, що виконується і під Bun, і під Node. Потрібен, бо hook запускається через `npx` → Node, де глобал `Bun` не визначений (top-level `new Bun.Glob(...)` зривав import модуля-детектора), а прямий `node:fs/promises#glob` не працює на self-hosted Linux Bun 1.3.14, де Node-compat шим не надає export `glob`. Реалізація вибирається за середовищем виконання: `Bun.Glob` під Bun, `node:fs/promises#glob` під Node (гарантовано за `engines: node >=25`).

## Публічний API

- `scanGlob(pattern, cwd)` — async-генератор: ітерує відносні (до `cwd`) шляхи файлів, що відповідають glob-патерну (наприклад, `cf/*/package.json`).
- `hasIgnoredPathSegment(relPath, ignoredDirs)` — чи містить відносний шлях сегмент зі службових тек (наприклад, `node_modules`), які glob-обхід має ігнорувати; еквівалент ignore-патернів `**/<dir>/**` по кожній теці з `ignoredDirs`. Розділювачі `\` нормалізуються до `/`.

## Де використовується

- `npm/scripts/lib/workspaces.mjs` — розгортання workspace-патернів із `*`.
- `npm/scripts/utils/resolve-js-root.mjs` — резолв JS-roots за workspace-патернами.
- `npm/rules/changelog/lib/package-manifest.mjs` — пошук `pyproject.toml` по репо.
- `npm/rules/tauri/core_test_isolation/main.mjs` — glob-члени `[workspace] members` і обхід `**/*.rs`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Не фільтрує результати сам: ігнорування службових тек — відповідальність викликача (через `hasIgnoredPathSegment` або власні перевірки).
