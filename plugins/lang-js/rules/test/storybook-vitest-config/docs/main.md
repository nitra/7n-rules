---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/storybook-vitest-config/main.mjs
docgen:
  crc: 48dda89f
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  issues: internal-name:detectStoriesGlob,internal-name:collectStorybookMarkerHints,anchor-miss:(vitest-config.mdc),judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує перевірки для Storybook-пакетів: він зіставляє очікувані назви vitest-конфігів і шлях до Stryker-конфігу, щоб позначати, коли конфіг не знайдено, шлях не резолвиться, структура проєкту динамічна або unit/storybook-частини не розпізнані. Для таких випадків використовуються `VITEST_CONFIG_NAMES`, `resolveVitestConfigPath`, `resolveViteConfigName`, `strykerConfigPathFor`, `storiesGlobForVitestConfig` і причини `REASON_VITEST_CONFIG_MISSING`, `REASON_STRYKER_CONFIG_MISSING`, `REASON_CONFIG_UNRESOLVABLE`, `REASON_PROJECTS_DYNAMIC`, `REASON_UNIT_PROJECT_MISSING`, `REASON_STORYBOOK_PROJECT_MISSING`, `REASON_STORYBOOK_PROJECT_MARKER_MISSING`.

`lint` також перевіряє наявність storybook-маркерів і пов’язаних ознак у проєктах, зокрема через `STORYBOOK_TEST_IMPORT`, `STORIES_RE`, `BROWSER_KEY_RE`, `WHITESPACE_ONLY_RE`, `LEADING_COMMA_RE`, `findTestObject`, `findProperty`, `classifyProjects`, `hasStoriesMarker`. Для app-пакетів окремо враховуються `QUASAR_PLUGIN_IMPORT`, `AUTO_IMPORT_PLUGIN_IMPORT`, `VITE_PLUGIN_PAGES_IMPORT`, а також пов’язані `QUASAR_PLUGIN_RE`, `AUTO_IMPORT_PLUGIN_RE`, `VITE_PLUGIN_PAGES_RE` і `PROVIDER_FACTORY_RE`, щоб не пропустити story pages поруч із reusable components.

Перевірка працює fail-safe: помилки перехоплюються, назовні винятки не кидаються.

## Поведінка

`lint` проходить усі пакети в скоупі Storybook і зводить перевірку до двох інваріантів: наявний канонічний `vitest.config.*` для unit+storybook і наявний ізольований `vitest.stryker.config.*` поруч із ним. Для пошуку конфігів використовуються `VITEST_CONFIG_NAMES`, `resolveVitestConfigPath` і, для baseline-імпорту в шаблонах, `resolveViteConfigName`; якщо файлу немає або він не визначається, результатом стає відповідний reason-рядок: `REASON_VITEST_CONFIG_MISSING`, `REASON_STRYKER_CONFIG_MISSING` або `REASON_CONFIG_UNRESOLVABLE`. Коли `vitest.config.*` знайдено, `parseModule` і `findTestObject` разом дістають `test.projects`, а `findProperty` і `classifyProjects` відділяють unit-запис від storybook-запису. Якщо `projects` не можна прочитати як статичну структуру, спрацьовує `REASON_PROJECTS_DYNAMIC`; якщо відсутній unit-запис — `REASON_UNIT_PROJECT_MISSING`; якщо відсутній storybook-запис — `REASON_STORYBOOK_PROJECT_MISSING`.

Для storybook-запису `classifyProjects` передає зріз у `hasStoriesMarker`, а та повертає, чи присутній валідний маркер stories-джерела без вимоги до явного `include`, якщо джерело вже задається через Storybook-конфіг. Далі `collectStorybookMarkerHints` зводить бракуючі канонічні ознаки до людських підказок, зокрема для базового storybook-ланцюжка та, для app-пакетів, додаткових Quasar/auto-import/pages-маркерів. Якщо storybook-запис є, але його маркери не збігаються з каноном, лінт віддає `REASON_STORYBOOK_PROJECT_MARKER_MISSING`. Повідомлення й маркери узгоджуються з правилами `vitest-config.mdc`.

`storiesGlobForVitestConfig` дає glob для кореневого `vitest.config.*`, щоб шаблони не тягнули path-prefix, який потрібен лише для `.storybook/`. Для app-пакетів він тримає окремий маршрут, щоб не втратити page-stories, які можуть співіснувати з reusable components. `strykerConfigPathFor` будує поруч розміщений ізольований конфіг для того самого каталогу й розширення, що й основний vitest-файл. `CHROMIUM_RE`, `BROWSER_KEY_RE`, `STORIES_RE`, `STORYBOOK_TEST_CONFIG_DIR_RE`, `PROVIDER_FACTORY_RE`, `QUASAR_PLUGIN_RE`, `AUTO_IMPORT_PLUGIN_RE`, `VITE_PLUGIN_PAGES_RE`, `WHITESPACE_ONLY_RE` і `LEADING_COMMA_RE` використовуються як спільні канонічні сигнали для впізнавання форми storybook-запису та його текстових варіацій.

## Публічний API

- STORYBOOK_TEST_IMPORT — Import, який має бути присутній у файлі, щоб `storybookTest(...)` резолвився.
- PLAYWRIGHT_PROVIDER_IMPORT — Import, який має бути присутній у файлі, щоб `playwright(...)`-factory (vitest@^4) резолвилась.
- QUASAR_PLUGIN_IMPORT — Import-и, потрібні ЛИШЕ app-storybook-запису (хвиля 2a, `app-storybook-project-entry.js`):
`quasar()`/`AutoImport()`/`Pages()`-плагіни, яких немає у бібліотечному записі
(`storybook-project-entry.js`) — сторінковий storybook-проєкт app-пакета отримує ВЛАСНІ
копії цих плагінів замість урізаного батьківського `baseVite` (unit-ізоляція, test.mdc).
Експортовано — переюз у `fix-vitest-config.mjs`.
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
- VITEST_CONFIG_NAMES — перелік підтримуваних назв vitest-конфігів, які шукаються в проєкті для визначення тестової конфігурації.
- AUTO_IMPORT_PLUGIN_IMPORT — імпорт плагіна auto-import, за яким впізнають відповідну інтеграцію в конфігурації.
- VITE_PLUGIN_PAGES_IMPORT — імпорт плагіна vite-plugin-pages, що позначає використання сторінкової маршрутизації.
- REASON_VITEST_CONFIG_MISSING — код відсутності vitest-config, коли конфіг для vitest не знайдено.
- REASON_STRYKER_CONFIG_MISSING — код відсутності stryker-config, коли конфіг для Stryker не знайдено.
- REASON_CONFIG_UNRESOLVABLE — код, що означає неможливість розв’язати шлях до vitest-конфіга.
- REASON_PROJECTS_DYNAMIC — код, що вказує на динамічне визначення проєктів і неможливість статично їх зібрати.
- REASON_UNIT_PROJECT_MISSING — код відсутності unit-проєкту в списку знайдених проєктів.
- REASON_STORYBOOK_PROJECT_MISSING — код відсутності Storybook-проєкту серед доступних проєктів.
- REASON_STORYBOOK_PROJECT_MARKER_MISSING — код, що означає: Storybook-проєкт є, але в ньому немає маркера очікуваної конфігурації; маркери повідомлень оформлені через ``.
- CHROMIUM_RE — шаблон для впізнавання браузера Chromium у назвах або описах середовища.
- BROWSER_KEY_RE — шаблон для ключів, які позначають браузерний запуск у конфігурації проєкту.
- STORIES_RE — шаблон для виявлення story-файлів, які належать до Storybook.
- STORYBOOK_TEST_CONFIG_DIR_RE — шаблон для директорій із тестовими конфігами Storybook.
- PROVIDER_FACTORY_RE — шаблон для factory-описів провайдера, щоб відрізнити їх від звичайних викликів.
- QUASAR_PLUGIN_RE — шаблон для записів, що вказують на плагін Quasar.
- AUTO_IMPORT_PLUGIN_RE — шаблон для записів, що вказують на плагін auto-import.
- VITE_PLUGIN_PAGES_RE — шаблон для записів, що вказують на плагін vite-plugin-pages.
- WHITESPACE_ONLY_RE — шаблон для рядків, що складаються лише з whitespace.
- LEADING_COMMA_RE — шаблон для конструкцій із початковою комою, які треба розпізнати окремо.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
