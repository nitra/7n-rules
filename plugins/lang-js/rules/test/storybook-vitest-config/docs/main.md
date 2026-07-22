---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/storybook/vitest-config/main.mjs
docgen:
  crc: ae5f59a0
  model: openai-codex/gpt-5.4-mini
  score: 85
  issues: internal-name:detectStoriesGlob,anchor-miss:(vitest-config.mdc),judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Описує поведінку, за якою визначаються канонічні `vitest.config.*`, пов’язаний Stryker-конфіг, а також наявність і придатність `unit` та `storybook`-проєктів у пакеті. Для цього використовуються експортовані константи-рядки `REASON_VITEST_CONFIG_MISSING="vitest-config-missing"`, `REASON_STRYKER_CONFIG_MISSING="stryker-config-missing"`, `REASON_CONFIG_UNRESOLVABLE="vitest-config-unresolvable"`, `REASON_PROJECTS_DYNAMIC="projects-dynamic"`, `REASON_UNIT_PROJECT_MISSING="unit-project-missing"`, `REASON_STORYBOOK_PROJECT_MISSING="storybook-project-missing"`, `REASON_STORYBOOK_PROJECT_MARKER_MISSING="storybook-project-marker-missing"`, а повідомлення про такі стани передаються через маркери `vitest-config.mdc`.

## Поведінка

- `VITEST_CONFIG_NAMES` — задає канонічний пріоритет імен `vitest.config.*` для пошуку конфіга.
- `STORYBOOK_TEST_IMPORT` — містить обов’язковий import для резолву `storybookTest`.
- `REASON_VITEST_CONFIG_MISSING` — причина, коли в пакеті немає `vitest.config.*`.
- `REASON_STRYKER_CONFIG_MISSING` — причина, коли відсутній ізольований `vitest.stryker.config.*`.
- `REASON_CONFIG_UNRESOLVABLE` — причина, коли vitest-конфіг не вдається розпарсити або знайти в ньому `test`-блок.
- `REASON_PROJECTS_DYNAMIC` — причина, коли `test.projects` не є статичним масивом.
- `REASON_UNIT_PROJECT_MISSING` — причина, коли в `test.projects` немає `unit`.
- `REASON_STORYBOOK_PROJECT_MISSING` — причина, коли в `test.projects` немає `storybook`.
- `REASON_STORYBOOK_PROJECT_MARKER_MISSING` — причина, коли `storybook`-проєкт не має канонічних маркерів.
- `CHROMIUM_RE` — маркує наявність chromium-інстансу в `storybook`-проєкті.
- `BROWSER_KEY_RE` — маркує browser-mode в `storybook`-проєкті.
- `STORIES_RE` — маркує stories-glob у `storybook`-проєкті.
- `WHITESPACE_ONLY_RE` — визначає рядок, що складається лише з whitespace.
- `LEADING_COMMA_RE` — визначає фрагмент, що починається з коми з можливим whitespace.
- `resolveVitestConfigPath` — знаходить наявний `vitest.config.*` у корені пакета або повертає `null`.
- `resolveViteConfigName` — повертає ім’я доступного `vite.config.*` для пакета, а якщо його немає — `vite.config.js`.
- `strykerConfigPathFor` — будує шлях до поруч розташованого `vitest.stryker.config.*` з тим самим розширенням.
- `storiesGlobForVitestConfig` — повертає stories-glob у вигляді, придатному для vitest-конфіга в корені пакета.
- `parseModule` — парсить JS/TS модуль і повертає AST з діагностикою.
- `findTestObject` — знаходить у дереві AST `test`-об’єкт незалежно від обгорток конфігурації.
- `findProperty` — знаходить у об’єкті property за іменем.
- `classifyProjects` — визначає, чи є в `test.projects` `unit`, і витягає зріз `storybook`-запису для перевірки маркерів.
- `lint` — перевіряє всі пакети у скоупі на канонічний vitest-конфіг для `unit+storybook` і наявність ізольованого `vitest.stryker.config.*`, повідомляючи про порушення через маркери `vitest-config.mdc`.

## Публічний API

- STORYBOOK_TEST_IMPORT — Import, який має бути присутній у файлі, щоб `storybookTest(...)` резолвився.
- resolveVitestConfigPath — Резолвить абсолютний шлях наявного `vitest.config.*` пакета (перший знайдений
  за пріоритетом {@link VITEST_CONFIG_NAMES}), або `null` якщо жодного немає.
- resolveViteConfigName — Резолвить ім'я `vite.config.*` пакета для import-шляху в baseline-шаблонах
  (той самий файл, що й `viteFinal` у `.storybook/main.js`). Пакет у скоупі
  гарантовано має один із них (`scope/main.mjs#hasStandardBuild`).
- strykerConfigPathFor — Шлях до ізольованого `vitest.stryker.config.*` — той самий каталог і
  розширення, що й основний vitest-конфіг пакета.
- storiesGlobForVitestConfig — Stories-glob для vitest-конфіга пакета (на відміну від `detectStoriesGlob`
  scaffold-концерна — той повертає шлях відносно `.storybook/`, тут vitest-конфіг
  лежить у корені пакета, тож префікс `../` треба зняти).
- parseModule — Парсить JS/TS файл через oxc-parser з обраним lang за розширенням.
- findTestObject — Шукає перший `ObjectExpression` у дереві AST, що має property `test` зі
  значенням-`ObjectExpression` — незалежно від того, чи огорнутий він у
  `defineConfig(...)`/`mergeConfig(...)`, чи це простий об'єкт (стійко до
  варіацій testing.mdc-канону).
- findProperty — Шукає property `name` у `ObjectExpression`.
- classifyProjects — Класифікує елементи масиву `test.projects`: чи є `unit`-проєкт, і
  source-зріз елемента `storybook`-проєкту (для marker-перевірки).
- lint — Перевіряє канонічний vitest-конфіг (unit+storybook projects) і наявність
  ізольованого `vitest.stryker.config` для всіх пакетів у скоупі Storybook.
  Надішли, будь ласка, файл або вміст коду, до якого треба написати документацію.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
