---
type: JS Module
title: eslint-config.mjs
resource: plugins/lang-js/rules/js/check/eslint-config.mjs
docgen:
  crc: 6626a862
  model: manual
---

## Огляд

Детекція воркспейс-типів (node/vue) репозиторію і чистий (read-only) планувальник
scaffold/merge для `eslint.config.js` consumer-репо. Спільне джерело правди для
detector-а `main.mjs` (перевірка, що кожен vue-воркспейс присутній у `vue: [...]`
аргументах `getConfig`) і T0-фіксера `fix-check.mjs` (детерміноване створення або
хірургічне оновлення конфігу — без повного перезапису файлу).

## Поведінка

- Тип воркспейсу визначається за root `package.json`: записи `workspaces`
  (glob-и типу `packages/*` розгортаються у наявні директорії); воркспейс — vue,
  якщо його `package.json` має `vue`/`nuxt` у deps або в ньому є хоч один `.vue`
  файл (`node_modules`/`dist` ігноруються). Без `workspaces` класифікується сам
  корінь як `.`.
- Merge наявного конфігу — хірургічний: додає відсутній `**/auto-imports.d.ts`
  у перший `ignores: [...]`, вставляє відсутні vue-воркспейси у `vue: [...]`
  (або нову властивість одразу після `getConfig({`), вилучає ці ж воркспейси з
  `node: [...]`. Кастомні ignores, overrides і коментарі не змінюються.
- Fail-safe: якщо структура конфігу не розпізнається (немає `getConfig({`),
  файл не чіпається — порушення лишається для ручного розгляду.

## Публічний API

- `detectWorkspaceTypes(cwd)` → `{ node: string[], vue: string[] }` — директорії
  за типами.
- `parseVueList(raw)` → нормалізовані записи `vue: [...]` з тексту конфігу.
- `renderEslintConfigScaffold(types)` → повний шаблон `eslint.config.js`
  (лише непорожні типи).
- `mergeEslintConfig(raw, types)` → новий вміст (`=== raw`, якщо merge
  неможливий чи не потрібен).
- `planEslintConfigFix(cwd)` → `{ path, content, message } | null` — ідемпотентний
  план для T0 (`null` на виправленому дереві).
- Константи reason-ів: `ESLINT_CONFIG_MISSING`, `ESLINT_CONFIG_IGNORES`,
  `ESLINT_CONFIG_VUE_WORKSPACE`; `AUTO_IMPORTS_IGNORE`.

## Де використовується

- `npm/rules/js/check/main.mjs` — detector (reason-и порушень, перевірка
  vue-воркспейсів).
- `npm/rules/js/check/fix-check.mjs` — T0-фіксер (виконання плану).

## Гарантії поведінки

- Read-only: модуль лише читає ФС і повертає план; запис виконує викликач.
- Ідемпотентність: повторний `planEslintConfigFix` на виправленому дереві → `null`.
- Биті/відсутні JSON-файли не кидають виняток (повертається `null`-об'єкт).
