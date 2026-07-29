---
type: JS Module
title: js-collector.mjs
resource: plugins/lang-js/coverage-provider/js-collector.mjs
docgen:
  crc: 3c452712
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 55
---

## Огляд

JS/TS coverage + mutation-testing колектор: збирає метрики покриття
(`vitest run --coverage`) і мутаційного тестування (Stryker з vitest-runner + perTest).
Історія: жив у `@nitra/cursor` як rule-провайдер, потім (2026-07-10) — вбудований
collector `@7n/test coverage`; після влиття `@7n/test` (spec 2026-07-22) — ядро
coverage-провайдера плагіна `@7n/rules-lang-js` (концерн `coverage` правила `test`).

## Публічний API

- scopeToRoot — Звужує список змінених файлів (relative до cwd) до тих, що лежать під `jsRoot`,
мають JS/TS-розширення, і рібейзить їх відносно `jsRoot`.
- scopeToStorybookRoot — Звужує список змінених файлів до тих, що стосуються Storybook-покриття
(`.vue`-компоненти + `*.stories.*`) під `jsRoot`, рібейзить відносно `jsRoot`.
Окремий від `scopeToRoot`: `.vue`/`*.stories.*` НЕ йдуть у Stryker `--mutate`
(JS-мутація для Vue поза скоупом), тож не змішуємо scope-и.
- detect — Чи колектор застосовний у поточному cwd. Активується, коли `vitest`
декларовано хоча б в одному JS-root АБО у кореневому `package.json`
(workspace-проєкт із hoisted node_modules — типовий патерн bun monorepo).
Інакше silent skip із hint у stderr (одноразово).
- extractFirstTestBlock — Витягує перший `it(` або `test(` блок з вмісту тест-файлу.
Відстежує глибину `{}` для коректного завершення.
- findExampleTest — Шукає тест-файл для заданого source-файлу і повертає перший тест-блок як приклад стилю.
Кандидати: `<base>.test.js`, `<base>.test.mjs`, `<dir>/tests/<name>.test.js`.
- parseStrykerReport — Парс Stryker mutation.json: Killed+Timeout → caught; Survived+NoCoverage → до total.
Compile/Runtime помилки виключаються з total.
Survived мутанти групуються по файлах з exampleTest.
- verifyScopedMutationBatch — Один cache-independent scoped Stryker-прогін після agent test-write. Він бере
consumer config за основу, але пише report у тимчасову директорію й примусово
вимикає incremental, тому не читає та не змінює consumer `incremental.json`.
Кожен target мусить бути знайдений у свіжому report; batch приймається лише коли
хоча б один target став Killed або Timeout.
- defaultRunner — Дефолтний spawn-runner колектора (vitest/bun/Stryker/Storybook-прогони).
Експортується для повторного використання делта-виміром (per-file.mjs) та інʼєкцій у тестах.
- collect — Збирає JS-метрики покриття + мутаційного тестування, і окремо — Storybook-покриття
(Vue/React/... компоненти зі сторі, `collectStorybookForRoot`). У monorepo ітерує усі
JS-roots з `resolveAllJsRoots()` (включно з glob-патернами `cf/*`), для кожного root-а
запускає обидва виміри незалежно й сумує lcov/mutation окремо через `buildAreaRow`.
Workspaces без тестів (JS) або без Storybook-конфігурації/сторі пропускаються по
кожному виміру окремо (root може дати лише JS-рядок, лише Storybook-рядок, обидва
або жодного). Якщо і JS, і Storybook відсутні всюди — повертає `[]`.
Шляхи у `survived` рібейзяться відносно `cwd`, щоб `coverage-fix.mjs`
знаходив джерела через `join(projectRoot, file)`.

Changed-режим (`opts.changedFiles` задано): JS-вимір отримує лише змінені JS-файли
root-а (`scopeToRoot`), Storybook-вимір — лише змінені `.vue`/`*.stories.*`
(`scopeToStorybookRoot`); кожен вимір пропускається незалежно, якщо relevant-змін
нема. Якщо змін нема ніде — повертає `[]` без error-логу (оркестратор трактує
порожній changed-scope як pass).

## Сценарії використання

- `plugins/lang-js/coverage-provider/tests/js-collector.test.mjs` (js coverage detect(); js coverage collect()) — повертає true коли vitest у devDependencies; повертає true коли vitest у workspace-пакеті; повертає true коли vitest у кореневому package.json, відсутній у workspace (hoisted bun monorepo); повертає true коли vitest у (звичайних) dependencies; повертає false коли vitest відсутній; ще 59

## Гарантії поведінки

- Кешує результати в межах одного прогону.
