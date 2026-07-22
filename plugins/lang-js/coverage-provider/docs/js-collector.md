---
type: JS Module
title: js-collector.mjs
resource: plugins/lang-js/coverage-provider/js-collector.mjs
docgen:
  crc: 686d2da0
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  issues: internal-name:collectStorybookForRoot,internal-name:buildAreaRow,anchor-miss:https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Збирає метрики coverage і mutation для JS/TS у спільний результат, щоб фіксувати стан тестового покриття та стійкість коду до мутацій в одному місці. Використовує `vitest run --coverage` і Stryker з `vitest-runner` та `perTest`, а також працює з кешуванням у межах прогону й може звертатися до мережі.

## Поведінка

collect спочатку звужує змінені файли до релевантного JS- або Storybook-скоупу, потім для кожного JS-root окремо вирішує, чи запускати повний або changed-режим, і вже після цього зводить coverage та mutation у спільні рядки `JS` і `Vue (Storybook)`. Дані для цього потоку беруться з `package.json` кореня та workspace-root-ів: detect вмикає колектор лише там, де є `vitest`, інакше дає silent skip, щоб не чіпати несумісні пакети. scopeToRoot і scopeToStorybookRoot працюють як різні фільтри одного changed-scope: перший лишає production JS/TS для Stryker mutate, другий — лише Vue-компоненти й stories для окремого Storybook-виміру, без змішування зон відповідальності.  

У гілці JS collectOneRoot бере coverage з Vitest або Bun-native прогону, а mutation — зі Stryker; якщо workspace без тестів, full-режим зупиняється без результату, а в changed-режимі порожній coverage не маскує NoCoverage-мутанти для зміненого source. parseStrykerReport агрегує `mutation.json` у caught/total і групує survived за файлами, підтягаючи приклад тесту через findExampleTest; якщо source-файл недоступний, оригінальний фрагмент лишається порожнім, щоб не ламати звіт. extractFirstTestBlock використовується як стилевий приклад для survived-результатів, а findExampleTest бере його з найближчого test-файлу для пояснення, як виглядає релевантний тестовий контекст.  

Для Storybook collect окремо стежить за тим, щоб зміни стосувалися саме Vue/story files і щоб root справді був канонічним Storybook-пакетом; повний режим тут може піти або через canonical Stryker command-runner, або чесно пропустити mutation, якщо конфіг відсутній. Поведінка навколо Storybook спирається на обмеження сучасного browser mode, яке не підтримується Stryker vitest-runner; контекст цього розходження описаний у https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/. readParsedMutationReport і assertStorybookStrykerIsolation захищають від пізніх падінь: перший вимагає наявний `mutation.json`, другий перевіряє, що Storybook-root не намагається запускатися через неізольований конфіг.  

defaultRunner є спільною точкою запуску зовнішніх команд для всіх гілок, а collect передає його вниз як інʼєкцію, щоб зберегти однакову оркестрацію між roots і режимами. Результати збираються в окремі агрегати по площинах, а survived у фінальному виході рібейзяться відносно cwd, щоб подальший фіксер міг знаходити джерела без додаткових перетворень. Кеш у межах прогону зменшує повторні звернення до тих самих root-ів і report-файлів, але не змінює семантику: якщо `mutation.json` відсутній там, де він має бути за `package.json` і конфігом, це лишається помилкою конфігурації, а не успішним skip.

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

## Гарантії поведінки

- Кешує результати в межах одного прогону.
