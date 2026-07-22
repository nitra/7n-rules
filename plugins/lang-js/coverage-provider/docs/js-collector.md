---
type: JS Module
title: js-collector.mjs
resource: plugins/lang-js/coverage-provider/js-collector.mjs
docgen:
  crc: 6d515737
  model: openai-codex/gpt-5.4-mini
  score: 75
  issues: internal-name:collectStorybookForRoot,internal-name:buildAreaRow,anchor-miss:https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Збирає окремі coverage- і mutation-метрики для JS-ядра та Storybook-частини, щоб не змішувати production-код із browser-mode скоупом. Орієнтується на workspace через `detect`, розрізає межі через `scopeToRoot` і `scopeToStorybookRoot`, а результати coverage та Stryker зводить у `collect` після розбору звіту через `parseStrykerReport`. Працює з мережевими джерелами та кешує дані в межах одного прогону.

## Поведінка

scopeToRoot і scopeToStorybookRoot спочатку розділяють змінені файли на дві незалежні площини: JS-ядро та Storybook-частину. Перша дає тільки production JS/TS-файли під коренем workspace, друга — лише `.vue`-компоненти та story-файли, щоб JS-мутація не змішувалась із browser-mode скоупом.

detect вирішує, чи взагалі запускати collector у поточному проєкті: він орієнтується на наявність vitest у package.json на рівні root або JS-root і тим самим відсікає несумісні workspace ще до будь-яких прогонів. Якщо умова не виконується, collector тихо пропускається.

collect оркеструє весь потік. У full-режимі він проходить по всіх JS-root’ах, запускає JS-вимір і Storybook-вимір окремо для кожного root-а, а потім зводить їх у підсумкові рядки. У changed-режимі він працює лише з уже звуженим списком змін: JS отримує тільки JS-файли, Storybook — тільки `.vue` і сторі, і кожен вимір може бути пропущений незалежно, якщо релевантних змін немає.

defaultRunner є точкою виконання зовнішніх прогонів і тримає спільний контракт для coverage та mutation. Для JS воно збирає покриття через vitest або bun test залежно від root-а, а для mutation запускає Stryker лише там, де є що мутувати. Результати цих прогонів далі зводяться в однакову форму, щоб collect міг агрегувати їх без знання деталей конкретного раннера.

parseStrykerReport перетворює mutation.json у підсумок caught/total і список survived-мутантів. Саме цей файл є джерелом істини для mutation-метрик; compile/runtime помилки не додаються до total, а survived-групи збагачуються прикладом тесту через findExampleTest і текстом оригінального фрагмента через extractOriginal. Для JS-мутації окремо перевіряється ізоляція Storybook-конфігу, щоб не впертися в browser-mode помилку без mutation.json.

extractFirstTestBlock і findExampleTest працюють як допоміжний шлях для зрозумілого контексту survived-мутантів: з тестового файлу береться перший прикладовий блок, щоб у звіті було видно стиль перевірки поруч із проблемним кодом. Це не впливає на самі метрики, але робить mutation-результат придатним для швидкого ручного розбору.

Результати всіх коренів зводяться через спільне сумування coverage та mutation по кожній площині окремо, а шляхи у survived нормалізуються відносно cwd, щоб подальші фікси могли знаходити джерела без прив’язки до внутрішнього розташування workspace. У Storybook-частині full-режим спирається на canonical конфіг із package.json і mutation.json, а changed-режим свідомо обходиться без зайвих прогонів, якщо змінено лише тести або лише не-relevant файли.

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

- defaultRunner — запускає mutation testing із browser mode, бере налаштування з package.json і mutation.json, щоб автоматично проганяти mutating-перевірки для коду з урахуванням публікації про підхід на https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/

## Гарантії поведінки

- Кешує результати в межах одного прогону.
