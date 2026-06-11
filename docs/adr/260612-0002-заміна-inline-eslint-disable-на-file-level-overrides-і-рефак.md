---
session: dcbd14cd-85ea-4d0d-9118-6a0f6fc7c58a
captured: 2026-06-12T00:02:49+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/dcbd14cd-85ea-4d0d-9118-6a0f6fc7c58a.jsonl
---

Чисто — жодне з наших правил більше не спрацьовує.

**Підсумок зроблених змін:**

1. **`doc-files/js/docgen-scan.mjs`** і **`doc-aggregate/js/docgen-scan.mjs`** — `import path from 'node:path'` → іменовані імпорти (`join, dirname, ...`), прибрано `unicorn/import-style` коментар

2. **25+ `npm/rules/*/fix.mjs`** — `process.exit(await runRuleCli(...))` → `process.exitCode = await runRuleCli(...)`, прибрано всі `n/no-process-exit` inline коментарі

3. **`eslint.config.js`** — додано 6 file-level overrides для правил, де inline-дисабл є технічно виправданим (signal handler в `with-lock.mjs`, dynamic `import()` у whitelist-контексті, hardcoded IP в k8s тестах, HTTP URL у hasura тестах, slow-regex у capacitor, non-literal regexp у package_structure)

4. **`manifests.mjs:4860`** — виправлено pre-existing `sonarjs/no-redundant-jump` (зайвий `return` після `try/catch`)

---

## ADR: Заміна inline `eslint-disable` на file-level overrides і рефакторинг

## Context and Problem Statement
Кодова база `@nitra/cursor` містила ~50 рядків `// eslint-disable-next-line` у JS/MJS файлах. Більшість з них пригнічувала легітимні архітектурні паттерни, не пояснюючи причину виключення у конфігурації.

## Considered Options
* Залишити inline коментарі
* Перенести в `eslint.config.js` file-level overrides + виправити першопричину де можливо
* Патчити `@nitra/eslint-config` глобально

## Decision Outcome
Chosen option: "Перенести в `eslint.config.js` + виправити де можливо", because inline disable без глобального контексту ховає намір; file-level override документує паттерн централізовано, а реальні проблеми (`unicorn/import-style`, `n/no-process-exit`) усуваються структурно.

### Consequences
* Good, because `process.exit()` → `process.exitCode =` усуває ризик обрізання stdout-буфера в CI при pipe.
* Bad, because `eslint.config.js` отримав нові override-блоки, які потребують підтримки при зміні структури директорій.

## More Information
Змінені файли: `eslint.config.js`, `npm/skills/doc-files/js/docgen-scan.mjs`, `npm/skills/doc-aggregate/js/docgen-scan.mjs`, `npm/rules/*/fix.mjs` (25+ файлів), `npm/scripts/utils/with-lock.mjs`. Правило `unicorn/import-style` для `node:path` вимагає named imports згідно `@nitra/eslint-config/index.js:306`.

---

Тепер ця документація готова для запису в ADR. Зафіксувати зміни в git?
