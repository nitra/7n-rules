---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-29T13:06:55+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

## ADR Stryker `Ignore`-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
У Vue 3 + Quasar репозиторії-споживачі `ai` (`gt/`) `bun run coverage` падав під час Stryker-прогону: інструментатор мутував аргументи `defineProps(...)`, Vue compiler відхиляв змінені виклики з `Error: defineProps() in <script setup> cannot reference locally declared variables`. Єдиний workaround без плагіна — boilerplate `// Stryker disable next-line` у кожному SFC.

## Considered Options
* Нульо-конфігураційний Stryker `Ignore`-плагін (`stryker-vue-macros-ignorer.mjs`) в `stryker_config`-концерні
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "нульо-конфігураційний Stryker `Ignore`-плагін", because концерн `stryker_config` автоматично детектує `.vue`-файли через `src/**/*.vue` glob у jsRoot (skip `node_modules`/`dist`/`reports`) і копіює `stryker.config.vue.baseline.mjs` + `stryker-vue-macros-ignorer.mjs` поряд — споживач нічого не налаштовує вручну; idempotency `ensureBaselineFile` збережена.

### Consequences
* Good, because transcript фіксує очікувану користь: jsRoot без `.vue` отримує дефолтний baseline без `plugins`/`ignorers` (backward-compat).
* Good, because плагін реалізований як plain-object export (`strykerPlugins` array) без імпорту `@stryker-mutator/api` — відповідає патерну `@stryker-mutator/vitest-runner` і не потребує нового запису у whitelist `bun.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` — плагін; `shouldIgnore(path)` повертає рядок-повідомлення коли `path.isCallExpression()` і `callee.name ∈ {defineProps, defineEmits, defineModel, defineSlots, defineExpose, defineOptions}`.
* `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` — `plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']`, `ignorers: ['vue-macros']`.
* `npm/rules/test/js/stryker_config.mjs` — `hasVueFiles(jsRoot)` через `node:fs/promises` glob.
* Паттерн плагіну запозичений у `node_modules/@stryker-mutator/instrumenter/dist/src/frameworks/angular-ignorer.js`.

---

## ADR `npx` замість `bunx` для запуску Stryker

## Context and Problem Statement
`coverage.mjs:236` викликав Stryker через `bunx @stryker-mutator/core run`. `bunx` ізолює установку у тимчасовому каталозі `/private/var/folders/…/T/bunx-501-@stryker-mutator/core@latest/node_modules/@stryker-mutator/` — без `vitest-runner`. Stryker логував `WARN Unknown stryker config option "vitest"` і не знаходив test-runner плагін.

## Considered Options
* `npx @stryker-mutator/core run` (стандартний npm runner)
* `bunx @stryker-mutator/core run` (ізольований тимчасовий каталог)

## Decision Outcome
Chosen option: "`npx @stryker-mutator/core run`", because `npx` резолвить `@stryker-mutator/core` з кореневого `node_modules` монорепо, де вже встановлений `@stryker-mutator/vitest-runner`, — плагіни доступні через glob `@stryker-mutator/*` у `plugins` Stryker-конфігу.

### Consequences
* Good, because Stryker успішно завантажує vitest-runner та ignorer-плагін зі спільного `node_modules`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* `npm/rules/js-lint/coverage/coverage.mjs` — метод `runStryker`, рядок де замінено `bunx` → `npx`.
* Кореневий `node_modules/@stryker-mutator/` містить: `api`, `core`, `instrumenter`, `util`, `vitest-runner`.

---

## ADR Явний параметр `cwd` замість `process.cwd()` у `check`-функціях

## Context and Problem Statement
Концерни `stryker_config`, `cargo_mutants_config` (test rule) та `cargo_mutants_config` (tauri rule) читали `process.cwd()` всередині `check()`. Юніт-тести використовували `chdir()` для перемикання контексту. Stryker копіює тести у sandbox і запускає їх у тому самому process — `process.chdir` стає process-wide мутацією, що порушує `no-process-chdir.mjs` rule та може конкурувати між тест-worker-ами.

## Considered Options
* Передавати `cwd` як явний параметр у `check(cwd)`
* Залишити `process.cwd()` + `chdir` у тестах

## Decision Outcome
Chosen option: "явний параметр `cwd` у `check(cwd)`", because це усуває `chdir` з тестів і відповідає `no-process-chdir.mjs` rule (яка забороняє `process.chdir` у тестах).

### Consequences
* Good, because тести більше не є process-wide мутацією — Stryker-worker-и можуть запускати їх паралельно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* Змінені файли: `npm/rules/test/js/stryker_config.mjs`, `npm/rules/test/js/cargo_mutants_config.mjs`, `npm/rules/tauri/js/cargo_mutants_config.mjs` — `check()` → `check(cwd)`.
* Відповідні тести: `npm/rules/test/js/tests/stryker_config.test.mjs`, `npm/rules/test/js/tests/cargo_mutants_config.test.mjs`, `npm/rules/tauri/js/tests/cargo_mutants_config.test.mjs` — `runCheckIn` передає `dir` явно, `chdir` видалено.
* Rule: `npm/rules/test/js/no-process-chdir.mjs`.

---

## ADR `test.skipIf(STRYKER_MUTATOR_WORKER)` для важких інтеграційних тестів

## Context and Problem Statement
`npm/tests/integration-repo-checks.test.mjs` запускає повний набір `check-*` проти реального дерева репозиторію (subprocess-виклики shellcheck, opa, regal тощо). При розширенні `mutate` на весь production-код Stryker починає виконувати ці тести у sandbox-workers, що дає хибні failures (shlex-paths, відсутній реальний .git тощо) і значно уповільнює прогон.

## Considered Options
* `test.skipIf(env.STRYKER_MUTATOR_WORKER)` — пропускати тест у Stryker-workers
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`test.skipIf(env.STRYKER_MUTATOR_WORKER)`", because Stryker встановлює `STRYKER_MUTATOR_WORKER` у child-process env (`child-process-proxy.js:32`) — умова чітко розрізняє звичайний запуск від мутаційного sandbox.

### Consequences
* Good, because transcript фіксує очікувану користь: integration-тест пропускається в Stryker workers, mutation score рахується лише по unit-покритих функціях.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* `npm/tests/integration-repo-checks.test.mjs` — `import { env } from 'node:process'`; `test.skipIf(env.STRYKER_MUTATOR_WORKER)(...)`.
* `node_modules/@stryker-mutator/core/dist/src/child-proxy/child-process-proxy.js:32` — джерело env-змінної.
