---
type: ADR
title: "Виправлення lint-порушень у npm/scripts: JSDoc, ESLint, jscpd, cspell, markdownlint"
---

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

## Update 2026-05-18

Після додавання `network_policy` та рефакторингу утиліт (`template.mjs`, `inline-template-links.mjs`, `package-manifest.mjs`) повний `bun run lint` відновлено до EXIT=0:

- `YAML_LS_MODELINE_RE`, `LEADING_DOTSLASH_RE`, `MD_LINK_RE`, `IDENT_RE`, `NEWLINE_RE`, `LEADING_BANG_RE` — regex-літерали винесено на рівень модуля (`e18e/prefer-static-regex`, `sonarjs/slow-regex`).
- `MD_LINK_RE` у `inline-template-links.mjs` — bounded quantifiers замість зворотнього відстеження.
- `() => {}` → `() => undefined` у тест-файлах (`no-empty-function`).
- `.jscpd.json`: `"npm/rules/*/policy/*/template/*.yml.snippet.yml"` додано в `ignore`.
- `.v8rignore`: `npm/rules/*/policy/*/template/**`, `npm/rules/*/fix/*/template/**`, `.cursor/hooks.json`, `npm/scripts/utils/__fixtures__/**`.
- `.n-cursor.json`: `"ignore": ["npm/rules/k8s/policy"]` — `runLintK8s` не запускає kubeconform/kubescape на template YAML.
- `.cspell.json`: 62 нових технічних та українських слова.
- `knip.json`: `trufflehog` додано до `ignoreBinaries`.
- `markdownlint.rego`: виправлено кирилічний символ `v` → `в` у коментарі.
- `ci4.mdc`, `n-ci4.mdc`: MD060 (ширина стовпців) і typo `apended` → `appended`.

## Update 2026-05-20

- `e18e/prefer-static-regex`: виносити regexp поза тіла функцій у модуль-рівневі `const`. Файли: `npm/rules/bun/fix/layout/check.mjs` (`WHITESPACE_RE`, `LINT_CHAIN_PART_RE`), `npm/scripts/utils/inline-template-links.mjs`, `npm/scripts/utils/template.mjs`.
- JSDoc `any` → `unknown`: замінювати `{*}` і `{ prop?: any }` на `unknown` та об'єднувати дубльовані `@param`-блоки. Файли: `npm/scripts/utils/template.mjs`, `npm/rules/k8s/fix/manifests/check.mjs`.
- `cspell` перефразування: `Прекомпільовані` → `Статичні` (`npm/scripts/utils/inline-template-links.mjs:7`, `npm/scripts/utils/template.mjs:14`); `білдів` → `зібраних kustomize-маніфестів` (`npm/rules/k8s/lint/lint.mjs:250`).

## Update 2026-05-20

### ESLint: витягування проміжних змінних (`unicorn/no-await-expression-member`)

Файли `npm/rules/changelog/fix/consistency/check.mjs` і `npm/scripts/sync-claude-config.test.mjs` зверталися до методів напряму з `await`-виразу (`.trim()`), що порушувало `unicorn/no-await-expression-member`. Рішення: витягти результат у проміжну змінну (`originMainRaw`, `headRaw`, `gitignoreContent`) перед викликом методу — мінімальна зміна без порушення логіки.

### ESLint: заміна вкладеного тернарного оператора (`sonarjs/no-nested-conditional`)

Файл `npm/scripts/sync-claude-config.mjs` (~рядок 442) використовував вкладений тернарний оператор для `prefix`. Замінено на `let prefix = ''` із наступним `if`-блоком — усуває вкладеність умов і задовольняє `sonarjs/no-nested-conditional` без зміни поведінки.

### cspell: заміна неологізму `автодопис`

Слово `автодопис` (форма `автодопису`) у `npm/CHANGELOG.md` (рядок 15) не розпізнавалося `cspell` (`Unknown word (автодопису)`). Замінено на `автоматичного дописування` — слово одноразове, простіше переформулювати, ніж додавати виключення в словник.
