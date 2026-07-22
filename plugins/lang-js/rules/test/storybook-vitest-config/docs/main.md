---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/storybook-vitest-config/main.mjs
docgen:
  crc: 1ae51726
  model: openai-codex/gpt-5.5
  score: 85
  issues: internal-name:detectStoriesGlob,anchor-miss:(vitest-config.mdc),judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує read-only lint для Storybook-пакетів: через `VITEST_CONFIG_NAMES` і `resolveVitestConfigPath` знаходить очікуваний Vitest-конфіг, перевіряє наявність `unit` і `storybook` projects, маркери Storybook browser-mode/stories та ізольований Stryker-конфіг. Він існує, щоб перетворювати відсутні або ненадійно прочитані конфіги на стабільні lint-порушення з маркером повідомлень `` без винятків назовні.

Експортовані reason-константи задають стабільні причини порушень: `REASON_VITEST_CONFIG_MISSING="vitest-config-missing"` — Vitest-конфіг відсутній; `REASON_STRYKER_CONFIG_MISSING="stryker-config-missing"` — Stryker-конфіг відсутній; `REASON_CONFIG_UNRESOLVABLE="vitest-config-unresolvable"` — Vitest-конфіг неможливо надійно прочитати; `REASON_PROJECTS_DYNAMIC="projects-dynamic"` — список projects є динамічним; `REASON_UNIT_PROJECT_MISSING="unit-project-missing"` — відсутній `unit` project; `REASON_STORYBOOK_PROJECT_MISSING="storybook-project-missing"` — відсутній `storybook` project; `REASON_STORYBOOK_PROJECT_MARKER_MISSING="storybook-project-marker-missing"` — відсутній очікуваний Storybook-маркер.

## Поведінка

- `VITEST_CONFIG_NAMES` задає пріоритет канонічних назв Vitest-конфіга пакета.
- `STORYBOOK_TEST_IMPORT` містить імпорт, потрібний для доступності `storybookTest`.
- `PLAYWRIGHT_PROVIDER_IMPORT` містить імпорт, потрібний для browser provider у Vitest v4.
- `REASON_VITEST_CONFIG_MISSING="vitest-config-missing"` позначає відсутній Vitest-конфіг.
- `REASON_STRYKER_CONFIG_MISSING="stryker-config-missing"` позначає відсутній ізольований Stryker-конфіг.
- `REASON_CONFIG_UNRESOLVABLE="vitest-config-unresolvable"` позначає конфіг, який неможливо надійно прочитати або проаналізувати.
- `REASON_PROJECTS_DYNAMIC="projects-dynamic"` позначає нестатичний `test.projects`.
- `REASON_UNIT_PROJECT_MISSING="unit-project-missing"` позначає відсутній `unit`-проєкт у Vitest.
- `REASON_STORYBOOK_PROJECT_MISSING="storybook-project-missing"` позначає відсутній `storybook`-проєкт у Vitest.
- `REASON_STORYBOOK_PROJECT_MARKER_MISSING="storybook-project-marker-missing"` позначає неповний канонічний набір маркерів Storybook-проєкту.
- `CHROMIUM_RE` визначає маркер chromium-інстанса для Storybook browser-mode.
- `BROWSER_KEY_RE` визначає маркер увімкненого browser-mode.
- `STORIES_RE` визначає маркер явного джерела stories.
- `STORYBOOK_TEST_CONFIG_DIR_RE` визначає маркер неявного джерела stories через Storybook-конфіг.
- `PROVIDER_FACTORY_RE` визначає маркер factory-провайдера Playwright для Vitest v4.
- `WHITESPACE_ONLY_RE` визначає маркер порожнього рядка з відступами для стабільних правок конфіга.
- `LEADING_COMMA_RE` визначає маркер початкової коми для стабільних правок конфіга.
- `resolveVitestConfigPath` знаходить наявний Vitest-конфіг пакета за канонічним пріоритетом або повертає відсутність.
- `resolveViteConfigName` знаходить ім’я Vite-конфіга для шаблонів або повертає відсутність, бо пакет у Storybook-скоупі може не мати власного Vite-конфіга.
- `strykerConfigPathFor` обчислює шлях ізольованого Stryker-конфіга поруч з основним Vitest-конфігом.
- `storiesGlobForVitestConfig` повертає stories-glob відносно кореня пакета; для app-пакетів використовує ширший фіксований glob, щоб не пропускати page-stories.
- `parseModule` читає модуль як JS або TS відповідно до розширення й повертає результат парсингу.
- `findTestObject` знаходить `test`-блок у конфігу незалежно від поширених обгорток конфігурації.
- `findProperty` знаходить потрібну властивість у конфігураційному об’єкті.
- `classifyProjects` визначає, чи є `unit`-проєкт, і виділяє текст Storybook-проєкту для перевірки маркерів.
- `hasStoriesMarker` визначає, чи Storybook-проєкт має явне або неявне джерело stories.
- `lint` перевіряє всі Storybook-пакети на наявність канонічного Vitest-конфіга з `unit` і `storybook` projects та ізольованого Stryker-конфіга; повідомлення прив’язує до ``, працює read-only і перетворює проблеми на lint-порушення без винятків назовні.

## Публічний API

- STORYBOOK_TEST_IMPORT — Import, який має бути присутній у файлі, щоб `storybookTest(...)` резолвився.
- PLAYWRIGHT_PROVIDER_IMPORT — Import, який має бути присутній у файлі, щоб `playwright(...)`-factory (vitest@^4) резолвилась.
- resolveVitestConfigPath — Резолвить абсолютний шлях наявного `vitest.config.*` пакета (перший знайдений
  за пріоритетом {@link VITEST_CONFIG_NAMES}), або `null` якщо жодного немає.
- resolveViteConfigName — Резолвить ім'я `vite.config.*` пакета для import-шляху в baseline-шаблонах
  (той самий файл, що й `viteFinal` у `.storybook/main.js`). Пакет у скоупі
  Storybook НЕ гарантовано має власний `vite.config.*` (хвиля 1.4 — вимогу
  `hasStandardBuild` прибрано зі скоуп-детекції, `scope/main.mjs`) — source-only
  Vue-бібліотека (напр. tauri-components/npm) законно потрапляє у скоуп без
  жодного `vite.config.*`. `null` — сигнал викликачу (`fix-vitest-config.mjs`)
  підставити порожній placeholder замість імпорту неіснуючого файлу.
- strykerConfigPathFor — Шлях до ізольованого `vitest.stryker.config.*` — той самий каталог і
  розширення, що й основний vitest-конфіг пакета.
- storiesGlobForVitestConfig — Stories-glob для vitest-конфіга пакета (на відміну від `detectStoriesGlob`
  scaffold-концерна — той повертає шлях відносно `.storybook/`, тут vitest-конфіг
  лежить у корені пакета, тож префікс `../` треба зняти). Для app-пакетів (хвиля 2a,
  `type: 'app'`) — фіксований {@link APP_STORIES_GLOB}, НЕ layout-детекція бібліотек:
  app-проєкт може мати одночасно `src/components/` (переюзані презентаційні компоненти)
  і `src/pages/` (сторінки) — вузький `detectStoriesGlob`-glob тоді мовчки пропустив би
  page-stories з vitest storybook-проєкту.
- parseModule — Парсить JS/TS файл через oxc-parser з обраним lang за розширенням.
- findTestObject — Шукає перший `ObjectExpression` у дереві AST, що має property `test` зі
  значенням-`ObjectExpression` — незалежно від того, чи огорнутий він у
  `defineConfig(...)`/`mergeConfig(...)`, чи це простий об'єкт (стійко до
  варіацій testing.mdc-канону).
- findProperty — Шукає property `name` у `ObjectExpression`.
- classifyProjects — Класифікує елементи масиву `test.projects`: чи є `unit`-проєкт, і
  source-зріз елемента `storybook`-проєкту (для marker-перевірки).
- hasStoriesMarker — Чи присутній валідний маркер джерела stories у зрізі `storybook`-проєкту:
  явний stories-glob (`include: [...]`, {@link STORIES_RE}) АБО виклик
  `storybookTest({ configDir })` без явного `include` — Storybook підхоплює glob
  автоматично зі своєї конфігурації, явний include не обов'язковий (реальний
  кейс components/npm/vitest.config.js — пілот adopt-діагностики). Раніше гола
  вимога підрядка `stories` давала хибний позитив на цьому валідному патерні.
  Спільна логіка для `main.mjs` (lint) і `adopt/main.mjs` (diff-діагностика) —
  не дублювати комбінацію двох regex у двох місцях.
- lint — Перевіряє канонічний vitest-конфіг (unit+storybook projects) і наявність
  ізольованого `vitest.stryker.config` для всіх пакетів у скоупі Storybook.
  **Поведінка**

Код аналізує Vitest/Stryker конфігурацію та формує причини пропуску або помилки, коли тестове середовище не може бути надійно визначене. Повідомлення маркуються джерелом правила ``, щоб користувач бачив, яка перевірка вимагає виправлення.

- VITEST_CONFIG_NAMES — задає підтримувані імена файлів Vitest-конфігурації.
- REASON_VITEST_CONFIG_MISSING — `vitest-config-missing`, позначає відсутність Vitest-конфігурації.
- REASON_STRYKER_CONFIG_MISSING — `stryker-config-missing`, позначає відсутність Stryker-конфігурації.
- REASON_CONFIG_UNRESOLVABLE — `vitest-config-unresolvable`, позначає конфігурацію, яку неможливо прочитати або визначити.
- REASON_PROJECTS_DYNAMIC — `projects-dynamic`, позначає динамічний список проєктів, який не можна безпечно проаналізувати статично.
- REASON_UNIT_PROJECT_MISSING — `unit-project-missing`, позначає відсутність unit-проєкту у Vitest.
- REASON_STORYBOOK_PROJECT_MISSING — `storybook-project-missing`, позначає відсутність Storybook-проєкту у Vitest.
- REASON_STORYBOOK_PROJECT_MARKER_MISSING — `storybook-project-marker-missing`, позначає Storybook-проєкт без очікуваного маркера.
- CHROMIUM_RE — визначає прив’язку браузерного тестування до Chromium.
- BROWSER_KEY_RE — знаходить налаштування браузерного режиму у конфігурації.
- STORIES_RE — визначає Storybook stories як ціль тестування.
- STORYBOOK_TEST_CONFIG_DIR_RE — визначає директорію конфігурації Storybook-тестів.
- PROVIDER_FACTORY_RE — визначає використання фабрики провайдера для браузерного тестування.
- WHITESPACE_ONLY_RE — розпізнає порожній за змістом текст.
- LEADING_COMMA_RE — визначає зайву кому на початку фрагмента конфігурації.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
