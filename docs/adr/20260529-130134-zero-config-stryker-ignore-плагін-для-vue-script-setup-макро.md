---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-29T13:01:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

## ADR Zero-config Stryker `Ignore`-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
У репозиторіях-споживачах із Vue 3 + Quasar та `<script setup>` `bun run coverage` падав з помилкою `[@vue/compiler-sfc] defineProps() in <script setup> cannot reference locally declared variables` — Stryker мутував аргументи `defineProps`/`defineEmits` тощо, вставляючи локальні змінні у місці, де Vue compiler забороняє будь-який не-compile-time вираз. Без плагіна єдиний workaround — `// Stryker disable next-line` у кожному SFC.

## Considered Options
* Автоматичне постачання Stryker `Ignore`-плагіна через концерн `stryker_config` при виявленні `.vue` у jsRoot
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Автоматичне постачання Stryker `Ignore`-плагіна через концерн `stryker_config`", because концерн уже керує `stryker.config.mjs` у кожному JS-root і дотримання zero-config-принципу (`@nitra/cursor`) вимагає щоб поява `.vue`-файлів автоматично активувала відповідний baseline + plugin.

### Consequences
* Good, because transcript фіксує очікувану користь: jsRoot без `.vue` отримує дефолтний baseline без `plugins`/`ignorers` — backward-compat збережено; `ensureBaselineFile` (`stryker_config.mjs:42-49`) залишається idempotent.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нові файли: `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs` (value-plugin `strykerPlugins`, `shouldIgnore` для `{defineProps,defineEmits,defineModel,defineSlots,defineExpose,defineOptions}`), `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs` (`plugins: ['@stryker-mutator/vitest-runner','./stryker-vue-macros-ignorer.mjs']`, `ignorers: ['vue-macros']`).
- Зміна: `npm/rules/test/js/stryker_config.mjs` — `hasVueFiles(jsRoot)` через `node:fs/promises#glob` на `src/**/*.vue` (skip `node_modules`/`dist`/`reports`).
- `rules/test/test.mdc` + дзеркало `.cursor/rules/n-test.mdc` оновлено до версії 2.6 з підсекцією "Vue SFC".
- `@stryker-mutator/api` не потрібен — плагін є plain-object `{ strykerPlugins }`, сумісним із `plugin-loader.js`.

---

## ADR Стратегія detection Vue-файлів у jsRoot

## Context and Problem Statement
Концерн `stryker_config` мав розрізнити jsRoot із Vue SFC (`<script setup>`) і без, щоб скопіювати правильний baseline. Потрібен надійний і швидкий спосіб перевірити наявність `.vue` без завантаження вмісту файлів.

## Considered Options
* `node:fs/promises#glob` на `src/**/*.vue` з виключеннями `node_modules`/`dist`/`reports`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`node:fs/promises#glob` на `src/**/*.vue` з виключеннями", because це нативний Bun/Node API без зайніх залежностей; exclude-патерни `node_modules`/`dist`/`reports` запобігають хибним спрацьованням на скопійовані артефакти.

### Consequences
* Good, because transcript фіксує очікувану користь: idempotency збережена — якщо `.vue` знайдено, копіюється vue-baseline; якщо ні — дефолтний; повторний запуск не перетирає.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізовано у `npm/rules/test/js/stryker_config.mjs` функцією `hasVueFiles(jsRoot)`.

---

## ADR Розширення `mutate`-whitelist Stryker з оркестратора на весь production-код

## Context and Problem Statement
`npm/stryker.config.mjs` мав тимчасове обмеження `mutate: ['rules/test/coverage/coverage.mjs']` (один файл-orchestrator). Mutation score рахувався лише для нього, вся логіка `rules/*/lib/*.mjs`, `rules/*/js/*.mjs`, `scripts/**/*.mjs`, `bin/**/*.{js,mjs}` залишалась поза мутаційним покриттям.

## Considered Options
* Замінити жорсткий whitelist на broad glob `rules/**/*.mjs` + `scripts/**/*.mjs` + `bin/**/*.{js,mjs}` з виключеннями `tests/`, `data/`, `template(s)/`, `fixtures/`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Broad glob із виключеннями non-logic directories", because `data/` і `template(s)/` містять baseline-шаблони без бізнес-логіки — їх включення інфлюювало б survived-рейтинг; `fixtures/` і `tests/` Stryker і без того пропускає за іменем, але explicit exclude є документацією наміру. `stryker-vue-macros-ignorer.mjs` додано як окремий explicit-include — єдиний `data/`-файл із власними тестами.

### Consequences
* Good, because transcript фіксує очікувану користь: мутації тепер охоплюють `rules/abie/lib/*.mjs`, `rules/abie/js/*.mjs` та весь інший production-код, що мав unit-тести.
* Bad, because кількість мутантів зросла з ~141 до значно більшого числа — час прогону coverage збільшився.

## More Information
- Змінено `npm/stryker.config.mjs`, рядок з `mutate`.
- `npm/package.json` 1.29.2 → 1.29.3; `npm/CHANGELOG.md` оновлено.

---

## ADR `bunx` → `npx` для запуску `@stryker-mutator/core` у coverage-провайдері

## Context and Problem Statement
`runStryker` у `npm/rules/js-lint/coverage/coverage.mjs:236` викликав `bunx @stryker-mutator/core run`. `bunx` під час першого виклику ставить пакет у tmp-директорію (`/private/var/folders/.../bunx-501-@stryker-mutator/core@latest`) без `@stryker-mutator/vitest-runner` — Stryker падав з `StrykerError: Could not ...`.

## Considered Options
* `npx @stryker-mutator/core run` — `npx` резолвить пакет із `node_modules` поточного cwd (де `@stryker-mutator/vitest-runner` уже встановлено)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`npx @stryker-mutator/core run`", because `npx` шукає бінарник у `node_modules/.bin/` поточного cwd, а `@stryker-mutator/vitest-runner` уже присутній у `node_modules/@stryker-mutator/` кореня монорепо — плагін завантажується коректно.

### Consequences
* Good, because `npx` є стандартним способом запуску бінарників із `node_modules` без побічних ефектів tmp-ізоляції.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено `npm/rules/js-lint/coverage/coverage.mjs:236`: `spawnSync('bunx', …)` → `spawnSync('npx', …)`.

---

## ADR `test.skipIf(STRYKER_MUTATOR_WORKER)` для integration-тесту у mutation workers

## Context and Problem Statement
Після розширення `mutate`-glob Stryker почав мутувати файли, імпортовані `npm/tests/integration-repo-checks.test.mjs`. Worker-процеси Stryker виконують тест у sandboxed mid-flight середовищі, де `REPO_ROOT` вказує на tmp-sandbox, а не реальне дерево cursor — тест `check-* на реальному репозиторії` падав або давав false negatives.

## Considered Options
* `test.skipIf(process.env.STRYKER_MUTATOR_WORKER)` — пропустити весь тест-кейс якщо виконуємось у Stryker worker
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`test.skipIf(STRYKER_MUTATOR_WORKER)`", because integration-тест перевіряє реальне дерево репозиторію через `REPO_ROOT = join(TEST_DIR, '..', '..')` — у mutation sandbox цей шлях не є valid cursor-репо, і тест не може дати коректний результат.

### Consequences
* Good, because мутанти в orchestrator-коді (`integration-repo-checks.test.mjs`) коректно класифікуються: тест скіпнуто → survived, що є правильним сигналом для коду без unit-coverage.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено `npm/tests/integration-repo-checks.test.mjs`: `import { env } from 'node:process'`, `test.skipIf(env.STRYKER_MUTATOR_WORKER)(…)`.
- Стандарт: `STRYKER_MUTATOR_WORKER` встановлюється Stryker у `child-process-proxy.js:32`.
