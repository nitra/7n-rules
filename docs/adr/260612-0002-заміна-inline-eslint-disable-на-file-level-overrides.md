---
type: ADR
title: Заміна inline eslint-disable на file-level overrides
description: Inline eslint-disable коментарі прибираються через структурні виправлення та централізовані file-level overrides в eslint.config.js.
---

**Status:** Accepted
**Date:** 2026-06-12

## Context and Problem Statement

Кодова база `@nitra/cursor` містила приблизно 50 рядків `// eslint-disable-next-line` у JS/MJS файлах. Частина коментарів приховувала реальні проблеми, які можна виправити в коді, зокрема default-імпорт `node:path` попри вимогу `unicorn/import-style`, а частина пригнічувала повторювані архітектурні патерни без централізованого пояснення в конфігурації.

Потрібно було прибрати inline suppress-коментарі там, де це можливо, і залишити винятки у формі, яку видно на рівні конфігурації проєкту.

## Considered Options

- Залишити inline `eslint-disable` коментарі.
- Перенести виправдані винятки в `eslint.config.js` як file-level overrides і структурно виправити порушення там, де це можливо.
- Патчити `@nitra/eslint-config` глобально.

## Decision Outcome

Chosen option: "Перенести виправдані винятки в `eslint.config.js` як file-level overrides і структурно виправити порушення там, де це можливо", because transcript фіксує, що inline disable без глобального контексту ховає намір, тоді як file-level override документує повторюваний патерн централізовано, а порушення `unicorn/import-style` і `n/no-process-exit` можна усунути зміною коду.

### Consequences

- Good, because `doc-files/js/docgen-scan.mjs` і `doc-aggregate/js/docgen-scan.mjs` перейшли з `import path from 'node:path'` на named imports і більше не потребують `unicorn/import-style` suppress-коментаря.
- Good, because `process.exit(await runRuleCli(...))` у багатьох `npm/rules/*/fix.mjs` замінено на `process.exitCode = await runRuleCli(...)`, що прибирає `n/no-process-exit` і зменшує ризик обрізання stdout-буфера в CI при pipe.
- Good, because transcript фіксує, що після змін перевірки більше не спрацьовували на ці порушення.
- Bad, because `eslint.config.js` отримав нові override-блоки, які треба підтримувати при зміні структури директорій.
- Neutral, because глобальний патч у `@nitra/eslint-config` обговорювався як варіант, але transcript не містить підтвердження прийняття цього рішення.

## More Information

Змінені файли й області:

- `eslint.config.js` — додано file-level overrides для технічно виправданих повторюваних винятків.
- `npm/skills/doc-files/js/docgen-scan.mjs` — `node:path` переведено на named imports.
- `npm/skills/doc-aggregate/js/docgen-scan.mjs` — `node:path` переведено на named imports.
- `npm/rules/*/fix.mjs` — `process.exit()` замінено на `process.exitCode =` у CLI entry-points.
- `npm/scripts/utils/with-lock.mjs` — залишений патерн signal handler покривається override.
- `npm/rules/k8s/js/**`, `npm/rules/hasura/js/tests/**`, `npm/rules/capacitor/js/platforms.mjs`, `npm/rules/npm-module/js/package_structure.mjs` — приклади шляхів, для яких inline suppress замінено конфігураційними винятками.
- `manifests.mjs` — виправлено pre-existing `sonarjs/no-redundant-jump` через зайвий `return` після `try/catch`.

Правило `unicorn/import-style` для `node:path` налаштоване в `@nitra/eslint-config` з вимогою named imports.
