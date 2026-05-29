---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-29T11:13:50+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

## ADR Stryker `Ignore`-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
У репозиторії-споживачі `ai` (`gt/` — Vue 3 + Quasar) `bun run coverage` завершується compile-помилкою `[@vue/compiler-sfc] defineProps() in <script setup> cannot reference locally declared variables`, бо Stryker інструментує виклики макросів (`defineProps`, `defineEmits` тощо) і вставляє тернарні вирази з локальними змінними. Без плагіна — ручний `// Stryker disable next-line` у кожному SFC.

## Considered Options
* Zero-config Stryker `Ignore`-плагін, що постачається концерном `stryker_config` при виявленні `.vue`-файлів у jsRoot
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Zero-config Stryker `Ignore`-плагін", because задача вимагала прибрати boilerplate-коментарі з кожного SFC і централізувати обхід у `@nitra/cursor`-концерні `stryker_config`.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run coverage` у Vue-репозиторіях проходить без compile-помилки, і жодних ручних `Stryker disable`-коментарів у SFC не потрібно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` — value-plugin (`strykerPlugins` export), `shouldIgnore(path)` перевіряє `path.isCallExpression()` + `callee.name ∈ {defineProps, defineEmits, defineModel, defineSlots, defineExpose, defineOptions}`.
- `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` — vue-варіант baseline (додає `plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']` і `ignorers: ['vue-macros']`).
- `npm/rules/test/js/stryker_config.mjs` — `hasVueFiles(jsRoot)` через `node:fs/promises#glob` (`src/**/*.vue`, skip `node_modules`/`dist`/`reports`); vue baseline + plugin-файл копіюються через наявну `ensureBaselineFile` (ідемпотентно).
- Тест-файли: `npm/rules/test/js/tests/stryker-vue-macros-ignorer.test.mjs` (6 macro + non-macro + non-Call), `npm/rules/test/js/tests/stryker_config.test.mjs` (+5 сценаріїв).
- `@nitra/cursor` 1.28.7 → 1.28.8.

---

## ADR Реалізація `Ignore`-плагіна без імпорту `@stryker-mutator/api`

## Context and Problem Statement
Для реєстрації `Ignore`-плагіна у Stryker формально потрібен `declareValuePlugin` з `@stryker-mutator/api`. Завдання передбачало перевірку — і якщо явний імпорт потрібен, додати пакет до whitelist `bun.mdc`.

## Considered Options
* Plain object literal: файл експортує `strykerPlugins = [{ kind: 'Ignore', name: '...', factory: { shouldIgnore } }]` без `import` з `@stryker-mutator/api`
* Явний виклик `declareValuePlugin` з `import { declareValuePlugin, PluginKind } from '@stryker-mutator/api'`

## Decision Outcome
Chosen option: "Plain object literal без `@stryker-mutator/api`", because перевірка `plugin-loader.js` показала, що він читає `module.strykerPlugins` напряму і не вимагає обгортки `declareValuePlugin`; Angular Ignorer у тій же кодовій базі Stryker використовує аналогічний підхід — `@stryker-mutator/api` до whitelist не додавали.

### Consequences
* Good, because `bun.mdc`-whitelist не розширюється, залежність не додається.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Референс: `node_modules/@stryker-mutator/core/dist/src/di/plugin-loader.js:97` — `module.strykerPlugins`.
- Референс: `node_modules/@stryker-mutator/instrumenter/dist/src/frameworks/angular-ignorer.js` — аналогічний plain-object Ignorer без API-імпорту.
- Whitelist `bun.mdc` не змінювалася; `@stryker-mutator/vitest-runner` уже легалізовано раніше.
