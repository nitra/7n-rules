---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-28T16:34:04+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

The work is complete. Here's a summary of changes in this transcript:

1. **New files added:**
- `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` — the Stryker Ignore plugin
- `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` — Vue-specific baseline config
- `npm/rules/test/js/tests/stryker-vue-macros-ignorer.test.mjs` — plugin unit tests
- `docs/adr/stryker-vue-macros-ignorer.md` — ADR

2. **Updated files:**
- `npm/rules/test/js/stryker_config.mjs` — Vue detection + conditional copy logic
- `npm/rules/test/js/tests/stryker_config.test.mjs` — added vue/mixed-monorepo/idempotency tests
- `npm/rules/test/test.mdc` + mirror `.cursor/rules/n-test.mdc` — Vue SFC subsection
- `npm/package.json` — bumped to 1.28.8
- `npm/CHANGELOG.md` — feature entry added

---

## ADR Stryker Ignore-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
У репозиторії-споживачі `ai` (`gt/` — Vue 3 + Quasar, `<script setup>`) команда `bun run coverage` завершувалася compile-помилкою `[@vue/compiler-sfc] defineProps() in <script setup> cannot reference locally declared variables` — Stryker інструментував виклики макросів і додавав до їх аргументів локальні змінні, що є синтаксично недозволеним у `<script setup>`. Без плагіна єдиним виходом був ручний `// Stryker disable next-line` boilerplate у кожному SFC.

## Considered Options
* Stryker `Ignore`-плагін (`PluginKind.Ignore`), що перехоплює `CallExpression` з іменем каллі з множини Vue-макросів і повертає рядок-причину ігнорування
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Stryker `Ignore`-плагін `vue-macros`", because він є стандартним розширенням Stryker API (аналогічно Angular-ignorer у `@stryker-mutator/instrumenter`) і усуває boilerplate без змін у коді споживача.

Концерн `stryker_config` у `@nitra/cursor` автоматично детектує `.vue`-файли у `jsRoot` (`<jsRoot>/src/**/*.vue`), копіює `stryker.config.vue.baseline.mjs` та `stryker-vue-macros-ignorer.mjs` у jsRoot, і реєструє плагін у базовому `stryker.config.mjs`. JS-roots без `.vue` отримують незмінний baseline без `plugins`/`ignorers` (backward-compat).

### Consequences
* Good, because transcript фіксує очікувану користь: compile-помилка Stryker на `.vue` зникає без ручного boilerplate у SFC-файлах споживача.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий плагін: `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` — `shouldIgnore(path)` повертає рядок коли `path.isCallExpression()` і `callee.name ∈ {defineProps, defineEmits, defineModel, defineSlots, defineExpose, defineOptions}`
- Vue baseline: `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` — додає `plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']` та `ignorers: ['vue-macros']`
- Detection логіка: `npm/rules/test/js/stryker_config.mjs` — glob `<jsRoot>/src/**/*.vue`, skip `node_modules`/`dist`/`reports`
- Документація: `npm/rules/test/test.mdc` v2.6 — підсекція "Vue SFC" у налаштуваннях mutation-testing
- Тести: 27 passed у `stryker_config.test.mjs` + `stryker-vue-macros-ignorer.test.mjs`
- Архітектурний патерн `PluginKind.Ignore` підтверджено через `@stryker-mutator/instrumenter/dist/src/frameworks/angular-ignorer.js`
- Версія `@nitra/cursor` bumped `1.28.7` → `1.28.8`
