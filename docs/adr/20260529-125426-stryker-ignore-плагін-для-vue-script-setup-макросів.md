---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-29T12:54:26+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

## ADR Stryker Ignore-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
У Vue 3 + Quasar `<script setup>` компоненті Stryker інструментував `defineProps`/`defineEmits`/`defineModel` тощо, генеруючи код на кшталт `defineProps(stryMutAct_9fa48("827") ? {} : (stryCov_9fa48("827"), { … }))`, що призводило до помилки `[@vue/compiler-sfc] defineProps() in <script setup> cannot reference locally declared variables` та падіння `bun run coverage`. Обхідний варіант — вручну додавати `// Stryker disable next-line` у кожен SFC — не масштабується.

## Considered Options
* Стандартний Stryker Ignore-плагін (`PluginKind.Ignore`, value-plugin, duck-typed `strykerPlugins` масив без прямого `@stryker-mutator/api` імпорту) — поставляється `stryker_config`-концерном у JS-roots із `.vue`-файлами
* Ручні `// Stryker disable next-line` коментарі у кожному SFC

## Decision Outcome
Chosen option: "Стандартний Stryker Ignore-плагін", because zero-config підхід усуває boilerplate у кожному SFC; плагін реєструється автоматично через vue-варіант `stryker.config.mjs`-baseline, який `stryker_config`-концерн копіює лише у ті JS-roots, де `src/**/*.vue` знайдено (backward-compat: jsRoot без `.vue` отримує дефолтний baseline без `plugins`/`ignorers`).

### Consequences
* Good, because `bun run coverage` у Vue-воркспейсах більше не падає з compile-помилкою; видалення boilerplate `// Stryker disable next-line` з усіх SFC.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` — плагін: `shouldIgnore(path)` перевіряє `path.isCallExpression() && callee.name ∈ {defineProps, defineEmits, defineModel, defineSlots, defineExpose, defineOptions}`; не імпортує `@stryker-mutator/api` — `plugin-loader.js` читає масив `strykerPlugins` duck-типізовано.
- `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` — vue baseline із `plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']` та `ignorers: ['vue-macros']`.
- `npm/rules/test/js/stryker_config.mjs` — detection через `node:fs/promises glob('src/**/*.vue')`, skip `node_modules`/`dist`/`reports`; idempotency через існуючий `ensureBaselineFile` (`stryker_config.mjs:42-49`).
- Паттерн взятий з `@stryker-mutator/instrumenter/dist/src/frameworks/angular-ignorer.js` (кутовий ignorer для Angular-signals).

---

## ADR `npx` замість `bunx` для запуску `@stryker-mutator/core`

## Context and Problem Statement
`bunx @stryker-mutator/core run` встановлював Stryker у тимчасову директорію `/private/var/folders/…/T/bunx-501-@stryker-mutator/core@latest/` без плагіна `@stryker-mutator/vitest-runner`. Під час coverage-прогону Stryker не знаходив vitest-runner і завершувався з помилкою `Could not load plugin`.

## Considered Options
* `bunx @stryker-mutator/core run` — запуск через bun temporary install
* `npx @stryker-mutator/core run` — запуск через npm-кеш, що використовує hoisted `node_modules` кореня монорепо

## Decision Outcome
Chosen option: "`npx @stryker-mutator/core run`", because `bunx` ізолює залежності у fresh temp env і не бачить `@stryker-mutator/vitest-runner`, встановлений у кореневому `node_modules`; `npx` використовує той самий `node_modules`, де вже присутній vitest-runner.

### Consequences
* Good, because Stryker знаходить усі плагіни з кореневого `node_modules` (включно з `vitest-runner` та новим `vue-macros-ignorer`); coverage-прогін успішно завершується.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Зміна у `npm/rules/js-lint/coverage/coverage.mjs:runStryker()`: `spawnSync('bunx', ['@stryker-mutator/core', 'run'], …)` → `spawnSync('npx', ['@stryker-mutator/core', 'run'], …)`.
- Виявлено під час першого `bun run coverage` після знімання `mutate`-обмеження; помилка `Resolved, downloaded and extracted [320]` у логу свідчила про свіжу ізольовану установку bunx.
