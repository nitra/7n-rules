# Виправлення lint-порушень у npm/scripts: JSDoc, ESLint, jscpd, cspell, markdownlint

**Status:** Accepted
**Date:** 2026-05-06

## Контекст

`bun run lint` завершувався з помилками в ~10 скриптах: відсутні JSDoc `@param`/`@returns` описи, статичні регекси всередині функцій, дубльований блок `findAllPackageJsonPaths` у двох файлах, невідомі українські слова у cspell-словнику, заборонені дублі заголовків у CHANGELOG, неопрацьований Vue SFC парсинг та незаекранована змінна в GitHub Actions.

## Рішення/Процедура/Факт

- **JSDoc** (`require-param`/`require-returns-description`): в усіх `npm/scripts/*.mjs` та `utils/*.mjs` додано описи до всіх `@param` і `@returns` тегів.
- **`e18e/prefer-static-regex`**: регекс-літерали перенесено на рівень модуля як `const` (`N_CURSOR_LINT_GA_RE` у `check-ga.mjs`, `MEGALINTER_CONFIG_NAMES`, `TRAILING_SLASHES_RE` тощо).
- **Нова утиліта** `npm/scripts/utils/find-package-json-paths.mjs` з `findAllPackageJsonPaths(repoRoot, ignorePaths)` — винесено з `check-js-bun-db.mjs` і `check-js-mssql.mjs` де код був ідентичним (29 рядків).
- **`sonarjs/prefer-single-boolean-return`**: `if/return true; return false` у `check-changelog.mjs` переписано на `return code === 1`.
- **`eslint.config.js`**: додано `vue: ['demo']` щоб `vue-eslint-parser` обробляв `demo/src/**/*.vue`.
- **`.jscpd.json`**: до `ignore` додано `"npm/.claude-template/**"` — шаблони навмисно ідентичні копіям.
- **`.markdownlint-cli2.jsonc`**: додано `"MD024": { "siblings_only": true }` — у CHANGELOG легітимно мати однойменні підзаголовки в різних версіях.
- **`.cspell.json`**: додано ~60 українських слів (`Воркспейс`, `бандл`, `бампити` тощо) та технічних термінів.
- **`.github/workflows/git-ai.yml`**: `$GITHUB_PATH` → `"$GITHUB_PATH"` (SC2086).
- Версія: 1.8.180 → 1.8.181.

## Обґрунтування

`bun run lint` є gate перед merge; всі помилки блокували CI. Виділення `findAllPackageJsonPaths` усунуло перевищення ліміту jscpd (25 рядків). `.claude-template` є source-of-truth для шаблонів, тому ідентичність із копіями навмисна.

## Розглянуті альтернативи

Для `sonarjs/slow-regex` розглядалась заміна `replace(/\/+$/, '')` на `while`-цикл, але достатньо було винести регекс у module-scope константу.

## Зачіпає

`npm/scripts/check-changelog.mjs`, `check-vue.mjs`, `check-js-run.mjs`, `check-nginx-default-tpl.mjs`, `check-js-bun-db.mjs`, `check-js-mssql.mjs`, `check-ga.mjs`, та ін.; утиліти `utils/walkDir.mjs`, `utils/load-cursor-config.mjs`, нова `utils/find-package-json-paths.mjs`; конфіги `.jscpd.json`, `.markdownlint-cli2.jsonc`, `.cspell.json`, `eslint.config.js`, `.github/workflows/git-ai.yml`; `demo/src/App.vue`, `npm/package.json`, `npm/CHANGELOG.md`.
