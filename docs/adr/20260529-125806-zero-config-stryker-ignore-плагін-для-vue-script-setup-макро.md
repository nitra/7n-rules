---
session: 6232c81a-1593-4949-b586-6795ea308436
captured: 2026-05-29T12:58:06+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6232c81a-1593-4949-b586-6795ea308436.jsonl
---

## ADR Zero-config Stryker Ignore-плагін для Vue `<script setup>` макросів

## Context and Problem Statement
Stryker інструментує Vue `<script setup>` макроси (`defineProps`, `defineEmits`, `defineModel` тощо), вставляючи умовні вирази, які Vue SFC-компілятор відхиляє з помилкою «`defineProps()` in `<script setup>` cannot reference locally declared variables». Без плагіна єдиним обхідним шляхом є boilerplate `// Stryker disable next-line` у кожному SFC.

## Considered Options
* Zero-config Ignore-плагін, що поставляється concern-ом `stryker_config` автоматично для JS-roots із `.vue`-файлами
* Ручний `// Stryker disable next-line` у кожному SFC-файлі проєкту-споживача

## Decision Outcome
Chosen option: "Zero-config Ignore-плагін", because усуває необхідність boilerplate у споживачах та відповідає принципу zero-config `@nitra/cursor`.

### Consequences
* Good, because transcript фіксує очікувану користь: репо-споживач `ai` (`gt/`) отримує `stryker-vue-macros-ignorer.mjs` + vue-варіант `stryker.config.mjs` автоматично через `npx @nitra/cursor fix test`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові файли: `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs`, `npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs`. Логіка detection — `hasVueFiles(jsRoot)` через `node:fs/promises#glob` на `src/**/*.vue` (skip `node_modules`/`dist`/`reports`) у `npm/rules/test/js/stryker_config.mjs`. Idempotency гарантується наявною функцією `ensureBaselineFile` (`stryker_config.mjs:42-49`). Backward-compat: JS-roots без `.vue` продовжують отримувати дефолтний baseline без `plugins`/`ignorers`.

---

## ADR Реалізація Stryker Ignore-плагіна без імпорту `@stryker-mutator/api`

## Context and Problem Statement
Для реєстрації Stryker Ignore-плагіна документація пропонує `declareValuePlugin` з пакету `@stryker-mutator/api`. Однак `@stryker-mutator/api` не було в whitelist `bun.mdc` і потребувало б явного дозволу.

## Considered Options
* Використати `declareValuePlugin` / `declareClassPlugin` з `@stryker-mutator/api` і додати пакет у whitelist `bun.mdc`
* Повернути plain object `{ strykerPlugins: [{ kind: 'Ignore', name: '...', factory: ... }] }` без імпорту `@stryker-mutator/api`

## Decision Outcome
Chosen option: "plain object без імпорту `@stryker-mutator/api`", because аналіз `node_modules/@stryker-mutator/core/dist/src/di/plugin-loader.js` показав, що plugin-loader читає `module.strykerPlugins` через duck-typing — явна обгортка `declareValuePlugin` не потрібна; нова залежність whitelist не вносилась.

### Consequences
* Good, because transcript фіксує очікувану користь: пакет `@stryker-mutator/api` не додавався до whitelist `bun.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Підтвердження: `node_modules/@stryker-mutator/core/dist/src/di/plugin-loader.js:97` — `module.strykerPlugins`. Аналог з `@stryker-mutator/vitest-runner/dist/src/index.js` — теж plain-array `strykerPlugins`. Файл: `npm/rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs`.

---

## ADR Знято тимчасове обмеження `mutate` до одного файлу у `stryker.config.mjs`

## Context and Problem Statement
`npm/stryker.config.mjs` мав тимчасовий коментар «Тимчасово: тільки orchestrator для швидкої перевірки pipeline» і обмежував `mutate` до `['rules/test/coverage/coverage.mjs']`. Через це Stryker-мутації не покривали більшість production-коду (наприклад `rules/abie/lib/`, `rules/abie/js/` та всі інші concerns).

## Considered Options
* Залишити обмеження на один файл (швидкий прогон, але мутації не представницькі)
* Розширити `mutate` на весь production-код (`scripts/**/*.mjs`, `rules/**/*.mjs`, `bin/**/*.{js,mjs}`) з виключенням тестів, `data/`, `template(s)/`, `__fixtures__/`

## Decision Outcome
Chosen option: "Розширити `mutate`", because обмеження було явно позначено як тимчасове в коментарі, і мета зняття — отримати представницький mutation score по всіх concerns.

### Consequences
* Good, because transcript фіксує очікувану користь: Stryker тепер мутує весь production-код у `rules/`, `scripts/`, `bin/`.
* Bad, because transcript не містить підтверджених негативних наслідків (час прогону зросте пропорційно кількості мутантів).

## More Information
Зміна у `npm/stryker.config.mjs`. `stryker-vue-macros-ignorer.mjs` додано як explicit-include всередині виключеного каталогу `data/` — єдиний `data/`-файл із власними юніт-тестами.

---

## ADR `bunx` → `npx` для запуску `@stryker-mutator/core` у coverage.mjs

## Context and Problem Statement
`coverage.mjs:236` використовував `bunx @stryker-mutator/core run` для запуску Stryker. `bunx` встановлює пакет у ізольований тимчасовий каталог (`/private/var/folders/.../T/bunx-501-@stryker-mutator/core@latest/`) без `@stryker-mutator/vitest-runner`, що призводило до помилки «Unknown stryker config option `vitest`» і аварійного завершення.

## Considered Options
* `bunx @stryker-mutator/core run` (ізольоване бункс-середовище)
* `npx @stryker-mutator/core run` (резолвить через кореневий `node_modules/`, де присутній `@stryker-mutator/vitest-runner`)

## Decision Outcome
Chosen option: "`npx @stryker-mutator/core run`", because `npx` використовує кореневий `node_modules/.bin/stryker`, де вже встановлено `@stryker-mutator/vitest-runner@9.6.1`, тоді як `bunx` завжди качає свіжий пакет в ізольований temp-dir без peer-залежностей.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run coverage` (exit code 0) без помилки `vitest-runner not found`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміна у `npm/rules/js-lint/coverage/coverage.mjs:236`. Підтвердження: `ls /private/var/folders/.../T/bunx-501-@stryker-mutator/core@latest/node_modules/@stryker-mutator/` — там відсутній `vitest-runner`.
