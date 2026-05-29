---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-29T13:06:37+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

---

## ADR Stryker `Ignore`-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
У репо-споживачі `ai` (`gt/` — Vue 3 + Quasar, `<script setup>`) `bun run coverage` завершувався compile-помилкою: Stryker мутував виклики `defineProps`, `defineEmits` та інших Vue SFC-макросів, підставляючи тернарний вираз, що порушував обмеження `@vue/compiler-sfc`. Без автоматичного рішення кожен SFC потребував ручного `// Stryker disable next-line`.

## Considered Options
* Автоматичний zero-config Stryker `Ignore`-плагін (`PluginKind.Ignore`) у `@nitra/cursor`, що реєструється через `stryker.config.vue.baseline.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Автоматичний zero-config Stryker `Ignore`-плагін", because концерн `stryker_config` вже постачає baseline-конфіг у JS-roots; додавання vue-варіанту baseline з `plugins`/`ignorers` та detection `.vue`-файлів у `src/**/*.vue` дозволяє повністю уникнути boilerplate у SFC без змін у споживачі.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run coverage` на repo `ai` (`gt/`) проходить без compile-помилки на `.vue`; JS-roots без `.vue` отримують дефолтний baseline без `plugins`/`ignorers` (backward-compat).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий файл `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` — value-plugin (об'єкт `{ strykerPlugins }`) без імпорту `@stryker-mutator/api`; `shouldIgnore(path)` перевіряє `path.isCallExpression()` і `callee.name ∈ {defineProps, defineEmits, defineModel, defineSlots, defineExpose, defineOptions}`.
- Новий файл `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` з `plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']` і `ignorers: ['vue-macros']`.
- `npm/rules/test/js/stryker_config.mjs` — додано `hasVueFiles(jsRoot)` через `node:fs/promises#glob` (`src/**/*.vue`, skip `node_modules`/`dist`/`reports`); при наявності `.vue` копіюється vue-варіант baseline + plugin-файл.
- `npm/rules/test/test.mdc` (version 2.5 → 2.6) — нова підсекція "Vue SFC" у розділі mutation-testing.
- Unit-тести: `npm/rules/test/js/tests/stryker-vue-macros-ignorer.test.mjs` (6 макросів, non-macro, non-Call, MemberExpression); `npm/rules/test/js/tests/stryker_config.test.mjs` — +5 сценаріїв (detection, no-vue default, mixed monorepo, node_modules skip, idempotency).
