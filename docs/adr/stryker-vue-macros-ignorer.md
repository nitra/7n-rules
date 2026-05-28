# Stryker `Ignore`-плагін для Vue `<script setup>` макросів

**Status:** Accepted
**Date:** 2026-05-28

## Контекст

У репозиторії-споживачі `ai` (`gt/` — Vue 3 + Quasar, `<script setup>`) `bun run coverage` падав на етапі Stryker `dry-run`: інструментер обгортав аргументи виклику `defineProps`/`defineEmits` у coverage-тернарник (`stryMutAct_9fa48("…") ? {} : (stryCov_9fa48("…"), { … })`), а `@vue/compiler-sfc` відмовлявся компілювати SFC з `defineProps() in <script setup> cannot reference locally declared variables`. Макроси Vue вимагають статично-аналізованих аргументів на етапі compile-sfc — будь-яка обгортка ламає компіляцію.

Альтернатива «boilerplate `// Stryker disable next-line` у кожному SFC» не масштабується і вимагає ручної підтримки в кожному консьюмер-репо. Концерн `stryker_config` правила `test` уже централізовано постачає `stryker.config.mjs` у кожен JS-root — логічно розширити цей канал, щоб zero-config закривав Vue-кейс.

## Рішення/Процедура/Факт

Новий локальний Stryker `Ignore`-плагін `vue-macros` живе у `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs`: експортує `strykerPlugins: [{kind: 'Ignore', name: 'vue-macros', value: {shouldIgnore}}]` — формат, який очікує `@stryker-mutator/core/.../plugin-loader.js` (без імпорту `@stryker-mutator/api`, бо API-обгортки `declareValuePlugin` потрібні лише для type-checking). `shouldIgnore(path)` повертає non-empty message для `CallExpression`, де `path.node.callee` — `Identifier` з ім'ям у наборі `{defineProps, defineEmits, defineModel, defineSlots, defineExpose, defineOptions}`.

Поряд із плагіном — vue-варіант baseline `stryker.config.vue.baseline.mjs` із явним `plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']` і `ignorers: ['vue-macros']`. `@stryker-mutator/vitest-runner` доводиться додавати у `plugins` явно, бо ручний `plugins`-масив затирає Stryker-default discovery.

Концерн `stryker_config` (`npm/rules/test/js/stryker_config.mjs`) детектить `.vue` під `<jsRoot>/src/**` через `node:fs/promises#glob` зі `exclude: ['**/node_modules/**', '**/dist/**', '**/reports/**']` — і у jsRoot з SFC ставить vue-варіант baseline + копіює плагін поряд (через спільний `ensureBaselineFile` — idempotent). JS-root без `.vue` отримує дефолтний baseline без `plugins`/`ignorers` (backward-compat).

Тести: `+5` сценаріїв у `npm/rules/test/js/tests/stryker_config.test.mjs` (detection happy path, no-vue → дефолт, mixed monorepo `gt/`+`cli/`, `.vue` лише у `node_modules` — НЕ тригерить, idempotency для обох vue-файлів) + новий `npm/rules/test/js/tests/stryker-vue-macros-ignorer.test.mjs` (6 макросів, non-macro callee, non-CallExpression, MemberExpression callee, anonymous callee). `rules/test/test.mdc` 2.5 → 2.6 із новою підсекцією "Vue SFC (`<script setup>` macros)". Версія `@nitra/cursor`: 1.28.7 → 1.28.8.

## Обґрунтування

Detection-scope `<jsRoot>/src/**/*.vue` повторює Stryker mutate-defaults для `src/` — гарантує, що vue-варіант вмикається тільки коли вихідний код містить SFC, а не коли `.vue` випадково потрапив у `node_modules` через transitive deps. Idempotency через `ensureBaselineFile` зберігає ручні налаштування користувача: якщо хтось додав свої `plugins`/`ignorers` — концерн не перетирає. Плагін як value-plugin (а не class-plugin) — нульова залежність від `@stryker-mutator/api` і `typed-inject`, оскільки `shouldIgnore` не потребує DI.

## Розглянуті альтернативи

- Boilerplate `// Stryker disable next-line` у кожному SFC — не масштабується, ручна підтримка в кожному консьюмер-репо.
- Виключити `**/*.vue` зі `mutate`-патернів Stryker — втрачаємо мутаційне покриття business-логіки у SFC `<script>`-блоках.
- Імпортувати `declareValuePlugin` з `@stryker-mutator/api` — додає peer/dev залежність у кожен консьюмер; для value-plugin без DI це непотрібно (об'єктний літерал працює так само, plugin-loader перевіряє лише `module.strykerPlugins` як масив).

## Зачіпає

`npm/rules/test/js/stryker_config.mjs`, `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs`, `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs`, `npm/rules/test/js/tests/stryker_config.test.mjs`, `npm/rules/test/js/tests/stryker-vue-macros-ignorer.test.mjs`, `npm/rules/test/test.mdc`, `.cursor/rules/n-test.mdc`, `npm/package.json`, `npm/CHANGELOG.md`.
