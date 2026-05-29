---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-29T12:53:05+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

## ADR Stryker `Ignore`-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
У репозиторії-споживачі `ai` (`gt/` — Vue 3 + Quasar) `bun run coverage` завершувався compile-помилкою: Stryker інструментував виклики Vue compiler macros (`defineProps`, `defineEmits` тощо), і `@vue/compiler-sfc` відмовлявся компілювати мутований SFC. Єдиним обхідним шляхом без плагіна була ручна розстановка `// Stryker disable next-line` у кожному SFC.

## Considered Options
* Zero-config Stryker `Ignore`-плагін, що постачається концерном `stryker_config` — копіюється у jsRoot автоматично при виявленні `.vue`-файлів
* Ручні `// Stryker disable next-line` у кожному SFC
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Zero-config Stryker `Ignore`-плагін", because плагін усуває помилку без boilerplate у споживачах; концерн `stryker_config` вже відповідає за постачання `stryker.config.mjs` і є правильним місцем для поширення.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run coverage` у Vue-проєктах проходить без compile-помилки; `// Stryker disable next-line` у SFC більше не потрібні.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` — `PluginKind.Ignore` value-plugin `vue-macros`; `shouldIgnore(path)` повертає повідомлення, якщо `path.isCallExpression()` і `callee.name ∈ {defineProps, defineEmits, defineModel, defineSlots, defineExpose, defineOptions}`.
- `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` — Vue-варіант baseline: `plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']`, `ignorers: ['vue-macros']`.
- Detection: `stryker_config.mjs` перевіряє наявність `.vue`-файлів через `node:fs/promises#glob('src/**/*.vue')` у jsRoot (пропускаються `node_modules`/`dist`/`reports`).
- Backward-compat: jsRoot без `.vue` отримує стандартний `stryker.config.baseline.mjs` без `plugins`/`ignorers`.
- Реалізація плагіна — plain object literal (`{ strykerPlugins: [...] }`) без import `declareValuePlugin` з `@stryker-mutator/api`, за зразком `node_modules/@stryker-mutator/instrumenter/dist/src/frameworks/angular-ignorer.js`.
- Юніт-тести: `npm/rules/test/js/tests/stryker-vue-macros-ignorer.test.mjs` (6 macro + non-macro + non-Call + MemberExpression cases), `stryker_config.test.mjs` (+5 сценаріїв: detection, no-vue default, mixed monorepo, node_modules skip, idempotency).

---

## ADR Розширення `mutate`-scope Stryker на весь production-код

## Context and Problem Statement
`npm/stryker.config.mjs` містив явне обмеження `mutate: ['rules/test/coverage/coverage.mjs']` з коментарем «Тимчасово: тільки orchestrator для швидкої перевірки pipeline». Через це мутаційне тестування не охоплювало `rules/abie/lib/`, `rules/*/js/*.mjs`, `bin/`, `scripts/` та інший production-код, попри наявність юніт-тестів.

## Considered Options
* Розширити `mutate` на весь production-код (`scripts/**/*.mjs`, `rules/**/*.mjs`, `bin/**/*.{js,mjs}`) з виключенням тестових і data-директорій
* Залишити поточне обмеження до окремого завдання
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розширити `mutate` на весь production-код", because користувач явно ініціював зняття обмеження («знімаємо обмеження Stryker»); тимчасовий коментар у конфізі вже зафіксував намір розширення.

### Consequences
* Good, because transcript фіксує очікувану користь: mutation score тепер відображає реальний стан покриття всього production-коду, а не лише одного файлу-оркестратора.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — прогін `bun run coverage` із новим `mutate` ще виконується у фоні на момент завершення сесії.

## More Information
- `npm/stryker.config.mjs` — `mutate` тепер: `['scripts/**/*.mjs', 'rules/**/*.mjs', 'bin/**/*.{js,mjs}', '!**/tests/**', '!**/__fixtures__/**', '!**/fixtures/**', '!**/data/**', '!**/template/**', '!**/templates/**', 'rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs']`. Файл `stryker-vue-macros-ignorer.mjs` включений явним include попри виключення `data/` — це єдиний `data/`-файл із власними юніт-тестами.
- `npm/rules/js-lint/coverage/coverage.mjs:236` — `runStryker` замінено з `bunx @stryker-mutator/core` на `npx @stryker-mutator/core`: `bunx` створює ізольований temp-каталог без `@stryker-mutator/vitest-runner`, що призводило до `WARN Unknown stryker config option "vitest"` і `ERROR Could not…`.
- Версія `@nitra/cursor` 1.29.1 → 1.29.2; секція `### Changed` у `npm/CHANGELOG.md`.
