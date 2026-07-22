---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/storybook-vitest-config/main.mjs
docgen:
  crc: 501ecc8f
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:detectStoriesGlob,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує лінт-контракт для Storybook-пакетів, які перевіряються через `VITEST_CONFIG_NAMES`: очікується розв’язуваний Vitest-конфіг зі статичними unit і Storybook-проєктами, Storybook-маркерами через `STORYBOOK_TEST_IMPORT`, browser provider через `PLAYWRIGHT_PROVIDER_IMPORT`, а також stories-маркерами, які визначаються відповідними regex/constants на кшталт `CHROMIUM_RE`, `BROWSER_KEY_RE`, `STORIES_RE`, `STORYBOOK_TEST_CONFIG_DIR_RE`, `PROVIDER_FACTORY_RE`, `QUASAR_PLUGIN_RE`, `AUTO_IMPORT_PLUGIN_RE`, `VITE_PLUGIN_PAGES_RE`. Він потрібен, щоб повертати стабільні machine-readable причини `REASON_*` для відсутніх, нерозв’язуваних, динамічних або неповних test-конфігурацій і Stryker-конфіга. У самому файлі немає власних операцій запису, а помилки обробляються fail-safe без винятків назовні.

## Поведінка

`lint` отримує скоуп Storybook-пакетів і для кожного пакета перевіряє узгодженість Vitest/Storybook-конфігурації. Шлях до основного конфіга визначається через `resolveVitestConfigPath` за пріоритетом `VITEST_CONFIG_NAMES`; якщо файл відсутній, результат лінту містить порушення з маркером ``.

Знайдений конфіг читається як вихідний текст і передається в `parseModule`, після чого `findTestObject` знаходить блок тестових налаштувань, а `findProperty` дістає з нього `projects`. Якщо конфіг неможливо надійно розібрати або `projects` не є статичним масивом, перевірка завершується контрольованим порушенням без винятку назовні.

`classifyProjects` розділяє стан `projects` на наявність unit-проєкту та текстовий фрагмент Storybook-проєкту. Для Storybook-фрагмента спільно застосовуються маркери `CHROMIUM_RE`, `BROWSER_KEY_RE`, `STORIES_RE`, `STORYBOOK_TEST_CONFIG_DIR_RE`, `PROVIDER_FACTORY_RE`, а `hasStoriesMarker` приймає як явне джерело stories, так і конфігурацію, де Storybook сам підхоплює stories зі своєї директорії. Для app-пакетів додатково очікуються маркери `QUASAR_PLUGIN_RE`, `AUTO_IMPORT_PLUGIN_RE`, `VITE_PLUGIN_PAGES_RE`, бо сторінкові stories потребують відповідних інтеграцій.

`storiesGlobForVitestConfig` задає glob відносно кореня пакета: для app-пакетів він ширший і не покладається на layout-детекцію бібліотек, щоб не втрачати page-stories. `resolveViteConfigName` використовується під час формування baseline-шаблонів: якщо у source-only пакета немає власного Vite-конфіга, відсутність файла є допустимою і має перетворюватися на порожній placeholder, а не на імпорт неіснуючого шляху. Для таких шаблонних вставок `STORYBOOK_TEST_IMPORT`, `PLAYWRIGHT_PROVIDER_IMPORT`, `QUASAR_PLUGIN_IMPORT`, `AUTO_IMPORT_PLUGIN_IMPORT`, `VITE_PLUGIN_PAGES_IMPORT`, `WHITESPACE_ONLY_RE` і `LEADING_COMMA_RE` задають канонічні маркери та очищення текстових фрагментів без зміни файлової системи.

Поруч із основним Vitest-конфігом `strykerConfigPathFor` визначає очікуваний ізольований Stryker-конфіг з тим самим каталогом і розширенням. Відсутність цього файла фіксується як окреме порушення, щоб mutation-testing не змішувався з основним test-проєктом.

Експортовані причини порушень стабілізують machine-readable результат лінту: `REASON_VITEST_CONFIG_MISSING="vitest-config-missing"` позначає відсутній Vitest-конфіг; `REASON_STRYKER_CONFIG_MISSING="stryker-config-missing"` — відсутній Stryker-конфіг; `REASON_CONFIG_UNRESOLVABLE="vitest-config-unresolvable"` — конфіг, який неможливо коректно проаналізувати; `REASON_PROJECTS_DYNAMIC="projects-dynamic"` — динамічний або непридатний для перевірки `projects`; `REASON_UNIT_PROJECT_MISSING="unit-project-missing"` — відсутній unit-проєкт; `REASON_STORYBOOK_PROJECT_MISSING="storybook-project-missing"` — відсутній Storybook-проєкт; `REASON_STORYBOOK_PROJECT_MARKER_MISSING="storybook-project-marker-missing"` — Storybook-проєкт є, але не містить обов’язкових канонічних маркерів.

## Публічний API

- VITEST_CONFIG_NAMES — Канонічні назви vitest-конфіга пакета (пріоритет .mjs — нові файли, js.mdc);
.ts підтримано для "стійкості до варіацій" (vitest-config.mdc).
- STORYBOOK_TEST_IMPORT — Import, який має бути присутній у файлі, щоб `storybookTest(...)` резолвився.
- PLAYWRIGHT_PROVIDER_IMPORT — Import, який має бути присутній у файлі, щоб `playwright(...)`-factory (vitest@^4) резолвилась.
- QUASAR_PLUGIN_IMPORT — Import-и, потрібні ЛИШЕ app-storybook-запису (хвиля 2a, `app-storybook-project-entry.js`):
`quasar()`/`AutoImport()`/`Pages()`-плагіни, яких немає у бібліотечному записі
(`storybook-project-entry.js`) — сторінковий storybook-проєкт app-пакета отримує ВЛАСНІ
копії цих плагінів замість урізаного батьківського `baseVite` (unit-ізоляція, test.mdc).
Експортовано — переюз у `fix-vitest-config.mjs`.
- AUTO_IMPORT_PLUGIN_IMPORT — Import `AutoImport`-плагіна — app-storybook-запис (див. опис над `QUASAR_PLUGIN_IMPORT`).
- VITE_PLUGIN_PAGES_IMPORT — Import `Pages`-плагіна — app-storybook-запис (див. опис над `QUASAR_PLUGIN_IMPORT`).
- REASON_VITEST_CONFIG_MISSING — Стабільний reason (namespace: ruleId/concernId/reason): у пакета немає жодного vitest-конфіга.
- REASON_STRYKER_CONFIG_MISSING — Стабільний reason: відсутній ізольований `vitest.stryker.config` поруч із vitest-конфігом.
- REASON_CONFIG_UNRESOLVABLE — Стабільний reason: vitest-конфіг не парситься / без test-блоку — правити вручну.
- REASON_PROJECTS_DYNAMIC — Стабільний reason: `test.projects` — не статичний масив (spread/змінна).
- REASON_UNIT_PROJECT_MISSING — Стабільний reason: у `test.projects` немає запису `unit`.
- REASON_STORYBOOK_PROJECT_MISSING — Стабільний reason: у `test.projects` немає запису `storybook`.
- REASON_STORYBOOK_PROJECT_MARKER_MISSING — Стабільний reason: storybook-запис без канонічних маркерів (chromium/browser/stories/provider).
- CHROMIUM_RE — Маркер chromium-інстанса у storybook-запису (текстовий пошук у зрізі елемента).
- BROWSER_KEY_RE — Маркер browser-mode (`browser:`-ключ) у storybook-запису.
- STORIES_RE — Маркер явного stories-джерела (підрядок `stories`) у storybook-запису.
- STORYBOOK_TEST_CONFIG_DIR_RE — `storybookTest({ configDir: ... })` без явного `include` — легітимний патерн:
Storybook підхоплює stories-glob автоматично зі своєї `.storybook/main.js`-конфігурації
(той самий stories-glob, що й `detectStoriesGlob`), явний include у vitest-конфізі не
обов'язковий (реальний кейс components/npm/vitest.config.js — пілот adopt-діагностики).
- PROVIDER_FACTORY_RE — vitest@^4: `browser.provider` — factory-виклик (`playwright()` з `@vitest/browser-playwright`),
не рядок `'playwright'` (застаріле API попередніх мажорів).
- QUASAR_PLUGIN_RE — App-специфічні маркери (хвиля 2a, `type: 'app'`): storybook-проєкт app-пакета має отримувати
ВЛАСНІ quasar()/AutoImport()/Pages()-плагіни (не той самий урізаний набір, що й unit-проєкт,
canon test.mdc) — без них сторінкові stories падають на Quasar SCSS-змінних/
auto-import globals/`<route>`-блоках (деталі — `app-storybook-project-entry.js`).
- AUTO_IMPORT_PLUGIN_RE — App-маркер: виклик `AutoImport()`-плагіна у storybook-запису (див. опис над `QUASAR_PLUGIN_RE`).
- VITE_PLUGIN_PAGES_RE — App-маркер: виклик `Pages()`-плагіна у storybook-запису (див. опис над `QUASAR_PLUGIN_RE`).
- WHITESPACE_ONLY_RE — Module-scope (prefer-static-regex): рядок-відступ цілком whitespace; leading
кома (можливо з whitespace) — спільні з fix-vitest-config.mjs патерном augment-у.
- LEADING_COMMA_RE — Leading кома (можливо з whitespace) — див. опис над `WHITESPACE_ONLY_RE`.
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

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
