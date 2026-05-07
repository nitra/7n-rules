# Changelog

Усі помітні зміни цього модуля документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [1.8.189] - 2026-05-07

### Added

- Нове правило `adr` (вмикається **вручну** через `.n-cursor.json` `rules`): автоматичне копіювання канонічного `.claude/hooks/capture-decisions.sh` з пакета та керована Stop-група у `.claude/settings.json`, яка викликає скрипт асинхронно (`async: true`, timeout `180`s). Скрипт зчитує JSONL-транскрипт сесії, передає дайджест у LLM CLI і пише чернетки ADR/Runbook/Knowledge у `docs/adr/_inbox/`.
- `capture-decisions.sh`: fallback `claude` → `cursor-agent` (LLM CLI). Якщо `claude` відсутній, береться `cursor-agent -p --mode ask --output-format text`. Моделі задаються через ENV `CAPTURE_DECISIONS_CLAUDE_MODEL` (default `sonnet`) і `CAPTURE_DECISIONS_CURSOR_MODEL` (default `claude-4.6-sonnet-medium`).
- `check-adr.mjs`: програмна перевірка наявності та канонічності `.claude/hooks/capture-decisions.sh`, ADR-групи у `.claude/settings.json`, відсутності дубля у `.claude/settings.local.json`, ігнорування `.claude/hooks/capture-decisions.log` у `.gitignore`, інформативно — наявність бодай одного LLM CLI (`claude`/`cursor-agent`) у `PATH`.
- `tests/check-adr.test.mjs` (7 кейсів) і нові кейси у `tests/sync-claude-config.test.mjs`: copy + Stop-merge + ідемпотентність + автоматичне видалення managed-групи при видаленні `adr` з `rules`.

### Changed

- `sync-claude-config.mjs`: `MANAGED_HOOK_COMMAND_MARKERS` (масив) замість одиничного маркера; `mergeSettings(existing, template, { includeAdrHook })`; `syncClaudeConfig` приймає `rules` і умовно копіює ADR Stop-hook script + додає managed-групу до Stop. `syncClaudeConfig` повертає додатковий прапорець `adrHook`.
- `bin/n-cursor.js`: передає `rules` у `syncClaudeConfig` і логує `.claude/hooks/capture-decisions.sh` у підсумку Claude-конфіга.

## [1.8.188] - 2026-05-07

### Changed

- `vue` (mdc v1.6 → v1.7): для Volar/асетів канонічно лише **`jsconfig.json`** у корені пакета — прибрано альтернативу з `tsconfig.json`. `check-vue.mjs`: перевіряється лише наявність `jsconfig.json`.

## [1.8.187] - 2026-05-07

### Added

- `check-vue.mjs`: перевірка `src/vite-env.d.ts` з `/// <reference types="vite/client" />` та наявності `jsconfig.json` або `tsconfig.json` у корені кожного Vue-пакета (типи для імпортів асетів у `.vue`).

### Changed

- `vue` (mdc v1.5 → v1.6): секція **«Vite client types (Volar, імпорти асетів)»** — обов’язкові `vite-env.d.ts`, jsconfig/tsconfig; застереження щодо вузького `compilerOptions.types`. Оновлено блок **«Перевірка»**.

## [1.8.186] - 2026-05-07

### Added

- `check-js-run.mjs` + `scripts/utils/promise-settimeout-scan.mjs`: програмна перевірка нової секції js-run «Паузи через setTimeout». AST-сканер на `oxc-parser` ловить `new Promise(resolve => setTimeout(resolve, ms))` (з `await` чи без, arrow та function expression, concise та block body, тривіально загорнутий callback `() => resolve()`). Паттерни з передачею значення (`r => setTimeout(() => r(value), ms)`), іншим callback-ом замість resolve, або з додатковими стейтментами в блоці — поза правилом (це не «чиста» пауза).
- `tests/promise-settimeout-scan.test.mjs`: 13 модульних тестів (await/без, block-body, function expression, обгорнутий callback, false-positive guards, multiline номер рядка, кілька входжень, фільтр розширень).
- `tests/check-js-run-fixture.test.mjs`: 2 інтеграційні кейси на `check()` — fail при `await new Promise(r => setTimeout(r, ms))` у workspace-пакеті, pass при `await setTimeout(ms)` з `node:timers/promises`.

### Changed

- `js-run` (mdc v1.3 → v1.4): додано секцію **«Паузи через setTimeout»** — заборонено `await new Promise(resolve => setTimeout(resolve, ms))`, замість цього треба `await setTimeout(ms)` з `node:timers/promises`. Зауваження про затінення глобального `setTimeout` у тому ж файлі (за потреби callback-варіант імпортувати під іншим іменем, наприклад `setTimeoutCb` з `node:timers`).

## [1.8.185] - 2026-05-06

### Changed

- `image` (mdc v1.4 → v1.5): прапорець `--avif` у `lint-image` тепер **заборонений** (інакше `bun run lint` плодив би `.avif` для зображень, що ніде не вживаються); канонічний `lint-image` — `npx @nitra/minify-image --src=. --write`. AVIF-генерацію виконує **виключно** `npx @nitra/cursor check image`. Секцію «AVIF-імпорти у `.vue`» переписано: тепер вона документує триетапну логіку `check image` — (1) запуск `npx @nitra/minify-image --src=. --write --avif`, (2) авто-заміна raster-посилань у `.vue`/`.html` на `.avif` у кожному workspace-пакеті, (3) прибирання AVIF-сиріт (файли `.avif` без жодного посилання у `.vue`/`.html` видаляються — AVIF лишається лише там, де заміна реально вдалася).
- `check-image.mjs`: `checkLintImageScript` більше не вимагає `--avif`, натомість фейлить за його наявністю; додано `runAvifGeneration` (best-effort `npx ... --avif`, опт-аут через `NITRA_CURSOR_NO_AVIF_RUN=1` для тестів), `cleanupOrphanAvifs` (видаляє `<...>.avif` без живого посилання), `hasAnyRasterImage`, `resolveImagePath`. `checkVueAvifImportsInPackage` тепер не лише валідує, а й переписує raster-посилання на `.avif` (коли AVIF-двійник реально існує на диску); якщо `.avif` нема — фейл, як раніше. Сканування поширено на `.html` файли (раніше було тільки `.vue`).
- `tests/check-image.test.mjs`: `CANONICAL_LINT_IMAGE` без `--avif`; кейс «без `--avif`» перейменовано/перекинуто на «з забороненим `--avif`»; додано тести на orphan-cleanup (`.avif` без посилань видаляється) та авто-заміну raster-імпорту, коли `.avif`-сусід реально існує.

## [1.8.184] - 2026-05-06

### Added

- `check-js-run.mjs`: програмна перевірка нового правила «depcheck у GitHub Actions з path-фільтром». Для кожного backend workspace-пакета сканується `.github/workflows/*.yml`; якщо `on.push.paths` або `on.pull_request.paths` містить glob, що починається з `<rootDir>/`, у job очікується крок `npx depcheck` з `working-directory: <rootDir>` і `--ignores`, що містить мінімум `graphql,bun` (інші значення допустимі). Логіка — у новому `scripts/utils/depcheck-workflow.mjs` (парсинг `--ignores="…"` з підтримкою single/double-quote і unquoted формату; класифікація `missing` / `wrong-cwd` / `missing-ignores`).
- `check-js-run-fixture.test.mjs`: 9 нових кейсів — нема `.github/workflows/`, глобальні paths без скоупу пакета, scoped-paths без depcheck (fail), depcheck з неправильним `working-directory` (fail), без `--ignores` (fail), `--ignores` без `bun` (fail), валідний з extra-ignores (pass), вкладений `cron-jobs/foo/src/**` як scope (pass).
- `.github/workflows/npm-publish.yml`: додано власний крок `npx depcheck --ignores="graphql,bun,bun:test,@nitra/cursor"` з `working-directory: npm`, щоб репо `@nitra/cursor` саме відповідало новому правилу js-run (`paths: ['npm/**']` обмежено пакетом `npm`); extra-ignores потрібні для self-reference `@nitra/cursor` у devDependencies та для `bun:test` як bun-built-in.

## [1.8.183] - 2026-05-06

### Changed

- `ga` (mdc v1.6 → v1.7): додано **універсальну** вимогу — кожен workflow у `.github/workflows/*.yml` обов'язково містить блок `concurrency` з `group: ${{ github.ref }}-${{ github.workflow }}` і `cancel-in-progress: true`. Без винятків — scheduled cleanup-воркфлоу, `pull_request: types: [closed]`, publish-воркфлоу теж. Канонічні приклади у правилі (`clean-ga-workflows.yml`, `clean-merged-branch.yml`, `git-ai.yml`) оновлено й тепер містять цей блок.
- `check-ga.mjs`: нова перевірка `verifyConcurrencyBlock` — запускається на кожному `*.yml` у `.github/workflows/` і структурно перевіряє рівно два поля (`concurrency.group` дорівнює канонічному рядку, `concurrency.cancel-in-progress === true`); відсутність блоку, інший `group` або `cancel-in-progress: false` — fail. Спільний `validateConcurrencyOnRoot` додано в усі канонічні структурні валідатори (clean-ga-workflows, clean-merged-branch, lint-ga, git-ai), щоб ці workflow перевірялися й через шаблонну, і через універсальну логіку.

## [1.8.182] - 2026-05-06

### Changed

- `js-run` (mdc v1.2 → v1.3): додано секцію **«depcheck у GitHub Actions з path-фільтром»** — якщо в `.github/workflows/*.yml` тригер `paths:` обмежено каталогом одного backend-пакета (наприклад `cron-jobs/refund-loyalty-points/**`), у job має бути крок `npx depcheck --ignores="graphql,bun"` з `working-directory`, що вказує на той самий каталог. Список `--ignores` обов'язково містить мінімум `graphql,bun` (peer-залежність GraphQL та рантайм Bun, які depcheck не розпізнає коректно), але може бути розширений значеннями через кому без пробілів. Не застосовується до глобальних workflow без `paths:` або з кореневими `**/*.js` патернами.

## [1.8.181] - 2026-05-06

### Changed

- `scripts/utils/find-package-json-paths.mjs`: винесено спільну `findAllPackageJsonPaths(repoRoot, ignorePaths)` з `check-js-bun-db.mjs` і `check-js-mssql.mjs`, щоб усунути jscpd-дублювання. Самі check-скрипти тепер імпортують її, як інші утиліти з `utils/`.
- `scripts/utils/walkDir.mjs` / `scripts/utils/load-cursor-config.mjs`: trimming trailing-slash переписано з регулярки `/\\/+$/` на `while (s.endsWith('/'))`, щоб уникнути попередження `sonarjs/slow-regex` (потенційний backtracking) — поведінка не змінилась.
- `scripts/check-k8s.mjs`: `failIfExplicitPatchTargetsHaveRedundantGroupVersion` рефакторено — логіка одного запису винесена в новий хелпер `describePatchTargetRedundancy`, основна функція тепер просто будує повідомлення з результату (зменшено sonarjs/cognitive-complexity 24→<15, поведінка не змінилась).
- `scripts/claude-stop-hook.mjs`: `readStdin` і `runStopHookCli` переписані з `new Promise(resolve => …)` на `events.once(stream, 'end' | 'exit')` — підказка `eslint-plugin-promise/avoid-new`, поведінка не змінилась.

### Fixed

- `scripts/utils/bun-sql-scan.mjs`: у JSDoc `findBunSqlUnsafeUseWithoutAllowMarkerInText` прибрано вкладений приклад із backslash-backtick (`sql\\`...\\${value}...\\``), який ламав парсер коментарів oxlint і призводив до false-positive `eslint-plugin-jsdoc(require-param)`/`(require-returns)` на функції з валідним JSDoc — текст переписано без екранованих backtick-ів.
- Десятки `eslint-plugin-jsdoc` правил у `npm/scripts/**` та `npm/tests/**`: додано відсутні описи `@param` / `@returns` (включно зі спільним `ignorePaths`-аргументом у нових сигнатурах walkDir-обгорток), прибрано неприпустимі дефолтні значення в JSDoc (`[name=...]`) — без зміни поведінки.

## [1.8.180] - 2026-05-05

### Changed

- `js-run` (mdc v1.1 → v1.2): додано секцію **«Область застосування»** — правило явно не застосовується до frontend-пакетів (маркер `vite` у `devDependencies`). У браузерному бандлі немає `node:process`, тому заміна `process.env.X` на `import { env } from 'node:process'` ламає рантайм (`TypeError: Cannot read properties of undefined (reading 'X')`); для frontend замість `process.env.NODE_ENV` — `import.meta.env.MODE` / `import.meta.env.PROD`, інші ENV — лише `import.meta.env.VITE_*`. Передумова — інцидент у abie/b2b `site/`, де LLM-агент за правилом замінив `process.env.NODE_ENV` у `src/main.js` і вибив прод-бандл.
- `check-js-run.mjs`: workspace-пакети з `vite` у `devDependencies` пропускаються — нова `packageJsonHasViteDevDependency(pkgJson)`, виклик одразу після `loadPackageJsonAndCheckBunyanDeps`. bunyan-залежність у `package.json` все одно перевіряється (бо це робиться до раннього виходу), але скан `process.env`, `#conn/*` і OTEL configmap для frontend-пакета не запускається. Тести: 2 нові кейси у `check-js-run-fixture.test.mjs` (vite-пакет з прямим `process.env` — pass; non-vite пакет з тим же кодом — fail).

## [1.8.179] - 2026-05-05

### Changed

- `abie` (`check-abie.mjs` / `mdc/abie.mdc`): `httpHealthCheck.requestPath` у `HealthCheckPolicy` (`hc.yaml`) тепер допускає будь-який непорожній шлях від кореня — рядок, що починається з `/` (`/healthz`, `/IsAlive`, `/api/live` тощо), замість жорсткої вимоги `/healthz`. Решта вимог незмінна: `type: HTTP`, `port: 8080`, `targetRef` на headless Service з суфіксом `-hl`. Канонічно рекомендується `/healthz`, але правило не блокує сервіси з власним liveness endpoint. JSDoc у `check-abie.mjs` і опис у `mdc/abie.mdc` приведено у відповідність до коду. Тести: 3 нові кейси у `check-abie.test.mjs` (нестандартний `/IsAlive`, відсутній лідируючий `/`, порожній рядок).

## [1.8.178] - 2026-05-05

### Added

- `vue` (mdc v1.4 → v1.5): у `.vue` SFC заборонено імпортувати Node-нативні модулі — як з префіксом `node:` (`node:timers/promises`, `node:fs` тощо), так і bare-ім’я вбудованого модуля Node (`fs`, `path`, `crypto`, `fs/promises` …). Vue SFC виконується у браузері, де Node API недоступне; такі імпорти ламають білд / рантайм. Логіку з Node API треба виносити у server-side утіліту (backend-пакет монорепо), а у компонентах використовувати браузерні замінники (`window.crypto`, `URL`, глобальний `setTimeout`, `AbortController` тощо). Правило торкається лише `.vue` файлів — `.ts`/`.js`-утіліти, що споживаються server-side, можуть імпортувати Node-built-ins без обмежень.
- `check-vue.mjs`: нова гілка `checkVueNodeImportViolations` обходить `.vue` файли пакета (виключаючи `node_modules`/`dist`/…) і парсить `<script>` блоки тим самим **oxc-parser**’ом — для кожного `staticImport` перевіряє специфікатор через `isNodeBuiltinSpecifier(spec)` (префікс `node:` або bare-ім’я з `module.builtinModules`, з підтримкою підшляхів типу `fs/promises`). У повідомленні про fail виводиться `rel:line` і фрагмент import.
- `vue-forbidden-imports.mjs`: експортовано `isNodeBuiltinSpecifier`, `findForbiddenNodeImportsInText`, `findForbiddenNodeImportsInVueFile` (для не-`.vue` повертає `[]`). Тести: 5 нових кейсів у `vue-forbidden-imports.test.mjs` (built-in detection / `node:` префікс / bare-built-in / лише script-блоки SFC / non-`.vue` skip) та 2 нові integration-кейси у `check-rule-fixtures.test.mjs` (fail при `node:timers/promises` і при bare `fs` у SFC).

## [1.8.177] - 2026-05-05

### Changed

- `changelog` (mdc v2.0): тепер дві моделі бази порівняння на рівні воркспейсу. **npm-published** (`name` + `files` + не `private: true`) — порівняння з опублікованою версією через `npm view <name> version` (git не задіяний; покриває кейс прямих комітів у `main` поза PR-flow). **local-only** (приватні / без `files`) — PR-scoped через `git merge-base <dev> HEAD`, що коректно обробляє: feature-гілку (видно лише унікальні коміти), `main` після merge `dev → main` (diff порожній → правило мовчить), direct-commit на `main` поза PR (ловиться як зміна, що потребує bump). Якщо реєстр недосяжний (офлайн / пакет не публікувався) — fail-safe pass, щоб локальна розробка не блокувалась.
- `check-changelog.mjs`: повний рефактор. Експорт `check(opts?)` з опційним `getPublishedVersion` для підстановки в тестах (CLI калить без аргументів — використовується дефолтний `npm view`-виклик з 10s таймаутом). Класифікація воркспейсів через `isNpmPublishable(pkg)`; для published — `checkPublishedWorkspace`, для local-only — окрема `runLocalOnlyChecks` із власною skip-логікою (no-git / on dev / no dev ref / no merge-base) і `resolveMergeBase(baseRef)` через `git merge-base`. Спільна `verifyChangelogEntry` для обох режимів.
- `n-changelog.mdc` / `mdc/changelog.mdc` (v1.1 → 2.0): переписано під дві моделі з прикладами кейсів.
- Тести `check-changelog.test.mjs`: 16 кейсів (раніше 11) — npm-mode (sync / out-of-sync / no CHANGELOG / no entry / files без `CHANGELOG.md` / offline), local-only skip-логіка, merge-base сценарії (feature-гілка, `main` після merge `dev → main`, direct-commit на `main`), змішаний режим.

## [1.8.176] - 2026-05-05

### Changed

- `changelog` стало єдиним правилом про CHANGELOG для всіх воркспейсів — включно з `npm/`. У `check-npm-module.mjs` прибрано `checkChangelog()` (і константу `CHANGELOG_PATH`); відповідну секцію `## CHANGELOG` видалено з `mdc/npm-module.mdc` (v1.9). Логіка перевірки `npm/CHANGELOG.md` лишилася незмінна за наповненням, але тепер вона PR-scoped (порівняння з `dev`), тож на feature-гілці bump і запис достатньо зробити **один раз — як суму по PR**, без bump-шуму в проміжних комітах.
- `check-changelog.mjs`: додано перевірку `files`-масиву — якщо `<ws>/package.json` його оголошує, у ньому має бути `"CHANGELOG.md"` (приватні воркспейси без `files` цей пункт пропускають). Прибрано `SKIP_WORKSPACE = 'npm'` — `npm/` тепер у звичайному циклі. Хелпер `readPackageJsonOrNull` об'єднує читання `package.json` (раніше було два окремі читачі — `version` і `files`).
- `auto-rules.mjs` / `auto-rules.md`: `changelog` переведено на `AUTO_RULE_DEPENDENCIES = ['bun']` (раніше — пряма умова `packageJsonExists`); тепер послідовно з рештою правил.
- `npm/.claude-template/npm-CLAUDE.md` (і згенерований `npm/CLAUDE.md`): оновлено — посилається на `n-changelog.mdc`, явно згадує `files: ["CHANGELOG.md"]`, наголошує на PR-scoped логіці.
- Тести `check-changelog.test.mjs`: кейс `npm/ пропускається` замінено на `npm/ перевіряється з files=["CHANGELOG.md"]`; додано окремий кейс fail при `files` без `CHANGELOG.md`.

## [1.8.175] - 2026-05-05

### Added

- `k8s.mdc` / `check-k8s.mjs`: у маршрутах Gateway API (**HTTPRoute**, **GRPCRoute**, **TCPRoute**, **TLSRoute**, **UDPRoute**, група `gateway.networking.k8s.io`) забороняється поле `namespace` у `spec.rules[*].backendRefs[*]` (і однини `backendRef`), якщо його значення збігається з `metadata.namespace` самого маршруту. За замовчуванням Gateway API резолвить backend у тому ж namespace, що й маршрут — дублювання у `backendRef` мертве й заважає Kustomize-overlay, що міняє namespace маршруту. Cross-namespace backendRef (з відмінним `namespace`) правило не торкається. Експортовано `collectGatewayApiRouteBackendRefsWithRedundantNamespace(spec, routeNs)`; перевіряється усередині існуючого `failIfGatewayRouteUsesNonHeadlessService` (той самий обхід дерева, що й для headless-перевірки). Додано приклад «погано/добре» у `k8s.mdc` і відповідні юніт-тести.

## [1.8.174] - 2026-05-05

### Added

- Нове правило `changelog` (`mdc/changelog.mdc` + `scripts/check-changelog.mjs`): для «звичайних» Bun-монорепо проєктів вимагає, щоб у кожному workspace, який змінився відносно базової гілки `dev`, у поточному PR було підвищено `version` у `<ws>/package.json` і додано запис `## [version] - YYYY-MM-DD` у `<ws>/CHANGELOG.md` (Keep a Changelog 1.1.0). Перевірка PR-scoped: на самій гілці `dev` пропускається; на feature-гілці bump і запис достатньо зробити **один раз — як суму по всьому PR**, без бамп-шуму в проміжних комітах. Воркспейс `npm/` пропускається — його CHANGELOG покриває окреме правило `npm-module`. У `auto-rules.md` / `auto-rules.mjs` `changelog` додано до автодетекту з умовою «у корені є `package.json`» і до `AUTO_RULE_ORDER` між `capacitor` і `docker`.
- `.n-cursor.json` поле `ignore` (`schemas/n-cursor.json`): тепер не лише сигнал для AI, а й керує обходом усіх `check-*.mjs` / `run-*.mjs` — перелічені каталоги повністю виключаються з `walkDir`, як `node_modules` чи `.git`. Дозволяє безпечно тримати vendored Helm-чарти, генеровані маніфести, legacy-дерева у репо без false-positive’ів від check-скриптів. Розширено опис у схемі (стандартні виключення додавати не треба) і README отримав секцію «Виключення цілих дерев».
- `scripts/utils/load-cursor-config.mjs`: нова утиліта `loadCursorIgnorePaths(root)` — читає поле `ignore` з `.n-cursor.json` і нормалізує до абсолютних posix-шляхів без trailing-slash; пропускає не-рядки та порожні елементи; повертає `[]`, якщо файлу/поля нема або JSON невалідний.
- `scripts/utils/walkDir.mjs`: третій аргумент `ignorePaths` (за замовчуванням `[]`) — каталоги, які пропускаються разом з усім вмістом. Збіг — за повним шляхом (точний або з префіксом `/`), а не за basename, тож `postgres-master-test/` не пропускається коли в ignore лише `postgres-master/`. Стандартні пропуски (`node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next`) працюють як раніше.

### Changed

- Усі скрипти, що обходять FS через `walkDir`, тепер на початку `check()` зчитують `loadCursorIgnorePaths(root)` і передають третім аргументом: `check-abie`, `check-docker`, `check-graphql`, `check-hasura`, `check-image`, `check-js-bun-db`, `check-js-mssql`, `check-js-run`, `check-k8s`, `check-nginx-default-tpl`, `check-npm-module`, `check-vue`, плюс `run-docker`, `run-k8s` і `rename-yaml-extensions`. Wrapper-функції (`findDockerfilePaths`, `findK8sYamlFiles`, `findLintDockerfilePaths`, `findK8sRoots`, `findDefaultConfTemplatePaths`, `migrateDefaultTplConfFiles`) отримали опційний параметр `ignorePaths` для прозорого пробросу.

## [1.8.172] - 2026-05-04

### Changed

- `auto-rules.md` / `auto-rules.mjs`: правило `php` тепер автоувімкається за наявністю `composer.json` у корені, а не за будь-яким `*.php` файлом у дереві. Прибрано константу `PHP_RE`, факт `hasPhpSource` і його збір у `updateFileFacts`/`collectAutoRuleFacts`; натомість у `detectAutoRulesAndSkills` додано прапорець `composerJsonExists` (за аналогією з `packageJsonExists` / `npmDirExists`).

## [1.8.171] - 2026-05-04

### Removed

- `abie.mdc` (v1.17) / `check-abie.mjs`: прибрано перевірку `.github/actionlint.yaml` (мітки `self-hosted-runner` `ua` / `dev` / `ru`). Видалено константи `ABIE_REQUIRED_ACTIONLINT_LABELS`, шаблон файлу та функції `parseActionlintSelfHostedLabels`, `abieMissingActionlintLabels`, `ensureAbieActionlintConfig`; знято відповідні юніт- та інтеграційні тести. Файл `.github/actionlint.yaml` більше не створюється і не валідовується правилом abie.

## [1.8.170] - 2026-05-03

### Changed

- `image.mdc` (v1.4) / `check-image.mjs`: правило перейшло на split-cache `@nitra/minify-image` ≥ **3.2.0**. Замість єдиного `.minify-image-cache.tsv` (який раніше мав бути або в `.gitignore`, або у `files`) тепер: (а) `.n-minify-image.tsv` у корені — committed source of truth з SHA-1/originalSize/size; правило вимагає, щоб він НЕ був у `.gitignore`; (б) `node_modules/.cache/@nitra/minify-image/mtime.tsv` — локальний fast-path, авто-gitignored через `node_modules/`, окремої перевірки не потребує. Додано міграційний fail: якщо `.minify-image-cache.tsv` лежить у корені або згадується в `.gitignore` — підказка з командою `git rm --cached` + `rm -f`. README + image.mdc-секція `## Split-cache` пояснюють, чому коміт hash-кешу осмислений (переживає `git clone`/`checkout`, на відміну від mtime).

## [1.8.169] - 2026-05-03

### Added

- `image.mdc` (v1.3) / `check-image.mjs`: нове правило `image` для оптимізації зображень через [`@nitra/minify-image`](https://www.npmjs.com/package/@nitra/minify-image). Перевіряє лише локальну конфігурацію (CI-workflow не вимагається — sharp/svgo тягнуть бінарні залежності, цінність на ubuntu-runner-ах нижча за час прогону): скрипт `lint-image` у `package.json` з обовʼязковим викликом `npx @nitra/minify-image --src=. --write --avif` (авто-оптимізація на місці + AVIF-двійники для PNG/JPEG/GIF), `bun run lint-image` в агрегованому `lint`, заборона `@nitra/minify-image` у `dependencies`/`devDependencies` (CLI лише через `npx`, симетрично до `markdownlint-cli2` у `text.mdc`) і рядок `.minify-image-cache.tsv` у `.gitignore` (або, рідше, у `files` пакета). AVIF-двійники (`<name>.<ext>.avif`) зберігаються в git як готові артефакти для віддачі браузеру.
- `image.mdc` (v1.3) / `check-image.mjs`: у `.vue` файлах кожного workspace-пакета raster-посилання мають вести на AVIF-двійник (`...png.avif`) у двох формах: (а) `import x from '...png|jpg|jpeg|gif'` (далі `:src="x"`); (б) прямі статичні атрибути `<img src="...png" />` у `<template>` (Vite перетворює їх на asset-імпорти при збірці). Реактивне `:src="..."` не сканується (JS-вираз — резолвиться через імпорт, який ловиться у формі (а)); `data-src=`, `obj.src=` у `<script>`, SVG-імпорти теж пропускаємо. Опт-аут на рівні воркспейс-пакета: `"@nitra/minify-image": { "disable-avif": true }` у `package.json` цього пакета. Дедуплікація обходу: при walk-у кореня `.` піддерева інших workspace-роди пропускаються (інакше `App.vue` у `demo/` доповідався б двічі).
- `auto-rules.mjs` / `auto-rules.md`: введено граф залежностей між правилами (`AUTO_RULE_DEPENDENCIES`, синтаксис у `auto-rules.md` — `rule - [other]`). Правило `image` описане як `image - [vue]` — варто автододати лише разом з `vue`, без дублювання вихідної умови «`.vue`-файли». Транзитивне розгортання дозволяє ланцюги (`a → b → c`) і поважає `disable-rules` (якщо vue вимкнено — image теж не додається).
- `vue.mdc` (v1.4) / `check-vue.mjs`: посилено перевірку `vite.config` — окрім згадки `AutoImport` тепер вимагається, щоб у виклику `AutoImport({ imports: [...] })` був присутній рядковий елемент `'vue'`. Без цього `unplugin-auto-import` не надасть `ref` / `createApp` / тощо, і прибирати явні value-імпорти з `'vue'` стає небезпечно (зламає код). Якщо `'vue'` у `imports` відсутній — value-імпорти більше не оголошуються забороненими, а fail зʼявляється на конфізі vite. Балансована екстракція аргументів `AutoImport(...)` через `extractAutoImportCallArgs` працює для багаторядкових об'єктів.

## [1.8.168] - 2026-05-03

### Added

- `lint-ga.mjs`: до preflight на `shellcheck` додано preflight на [`uv`](https://docs.astral.sh/uv/) (постачає `uvx` для `uvx zizmor`). Якщо `uv` відсутній у `PATH` — `n-cursor lint-ga` падає з exit 1 і підказками `brew install uv` / `curl -LsSf https://astral.sh/uv/install.sh | sh` / `pip install uv`. Обидва preflight’и повідомляються незалежно: якщо нема одночасно й `shellcheck`, і `uv`, користувач одразу бачить обидві підказки, а не лише першу.
- `lint-ga.mjs`: винесено внутрішній `PreflightDep` із `bin`/`winBins`/`explanation`/`install`/`successMsg` — однотипний pattern для додавання нових залежностей у preflight без копіпасти.

## [1.8.167] - 2026-05-03

### Added

- `lint-ga.mjs` / `bin/n-cursor.js`: нова CLI-підкоманда `n-cursor lint-ga` (експорт `runLintGaCli`). Робить preflight на `shellcheck` (exit 1 + brew/apt/pacman підказки, коли його немає в `PATH`), тоді послідовно запускає `bunx github-actionlint` і `uvx zizmor --offline --collect=workflows .` через `spawnSync` з `stdio: 'inherit'`. Тепер і `bun lint-ga` сигналізує про відсутність shellcheck — раніше це робила лише `check ga`.
- `ga.mdc` (v1.5): канонічний скрипт `lint-ga` у `package.json` тепер `n-cursor lint-ga` (а не `bunx github-actionlint && uvx zizmor …`); `check-ga.mjs` валідує саме цю форму. Виклик через bin-ім’я `n-cursor`, бо `bun run` транслює `npx` у `bun x`, а `bun x @nitra/cursor` для скоупованого пакету з одним bin-ім’ям повертає 0 без виконання.

## [1.8.166] - 2026-05-03

### Added

- `ga.mdc` (v1.4) / `check-ga.mjs`: нова перевірка локального [`shellcheck`](https://www.shellcheck.net/) у `PATH`. Без нього `actionlint` (`bunx github-actionlint`) мовчки пропускає shell-перевірки в `run:` блоках, тож локальний `bun lint-ga` дає зелений результат, який падає в CI на `ubuntu-latest` (де shellcheck передвстановлений). `npx @nitra/cursor check ga` тепер `fail` з підказкою встановлення (`brew install shellcheck` / `apt-get install -y shellcheck` / `pacman -S shellcheck`).

### Changed

- `utils/resolve-cmd.mjs`: явно передаємо `process.env` у `spawnSync('which'/'where', ...)`, щоб у Bun зміни `PATH` у runtime (наприклад, підстановка стабів у тестах) бачилися дочірнім процесом. Без цього Bun використовував би snapshot оточення на старті.

## [1.8.165] - 2026-05-01

### Changed

- `ga.mdc` / `check-ga.mjs`: лінт workflow-ів через [`github-actionlint`](https://www.npmjs.com/package/github-actionlint) замість `node-actionlint`. Канонічний скрипт `lint-ga` тепер `bunx github-actionlint && uvx zizmor --offline --collect=workflows .`; `check-ga` вимагає у `package.json` саме `github-actionlint`.

## [1.8.164] - 2026-05-01

### Added

- `abie.mdc` (v1.16) / `check-abie.mjs`: нова перевірка `.github/actionlint.yaml`. Якщо файл відсутній — `npx @nitra/cursor check abie` створює його з канонічним вмістом (`self-hosted-runner.labels: ['ua', 'dev', 'ru']`); якщо є — звіряє, що в `self-hosted-runner.labels` присутні мітки `ua`, `dev`, `ru` (порядок, інші мітки й формат лапок дозволені). Експортовано `ABIE_REQUIRED_ACTIONLINT_LABELS`, `parseActionlintSelfHostedLabels`, `abieMissingActionlintLabels`.

## [1.8.163] - 2026-05-01

### Changed

- `check-js-lint.mjs`: `ignorePatterns` у `.oxlintrc.json` тепер звіряється як `rules` — канонічні патерни мають бути присутні, додаткові локальні glob-и дозволені (раніше була строга рівність — будь-який зайвий запис зламував перевірку).
- `check-text.mjs`: `OXFMT_REQUIRED_IGNORE_PATTERNS` доповнено `**/auto-imports.d.ts` (узгоджено з каноном oxlint); перевірка `.oxfmtrc.json` уже працює як subset, тому локальні розширення не падають.
- `js-lint.mdc` / `n-js-lint.mdc`, `text.mdc` / `n-text.mdc`: документовано, що канон задає мінімум `ignorePatterns`, локальне розширення дозволене.

## [1.8.162] - 2026-05-01

### Changed

- `oxlint-canonical-skeleton.json` (та перебудований `oxlint-canonical.json`): `ignorePatterns` тепер містить `["**/schema.graphql", "**/auto-imports.d.ts"]` (узгоджено з `.oxfmtrc.json`). Споживачі мають синхронізувати корінь `.oxlintrc.json` із каноном — `check-js-lint` падатиме, поки масив не збігається.

## [1.8.161] - 2026-05-01

### Added

- `js-bun-db.mdc` (v1.5): нова секція «Прибирати pg-leftover виклики (`.connect()`, `.end()`)». У файлах з Bun SQL прапоруються `<obj>.connect(...)` і `<obj>.end(...)` як ручний lifecycle, який Bun SQL робить за тебе. Opt-out — маркер `// allow-pg-leftover: <причина>` (line- або block-коментар на тому ж рядку чи безпосередньо перед викликом).
- `bun-sql-scan.mjs`: новий сканер `findBunSqlPgLeftoverCallInText` (скоп — лише файли з `import { sql|SQL } from 'bun'`, щоб не давати false-positive на WebSocket/Stream `.end()`). Виділено спільний `hasMarkerCommentNear` для обох opt-in маркерів (`allow-unsafe`, `allow-pg-leftover`).

## [1.8.160] - 2026-05-01

### Changed

- `js-bun-db.mdc` (v1.4): `sql.unsafe(...)` тепер заборонено за замовчуванням — допустимо лише для підстановки назви таблиці/колонки чи dynamic SQL/DDL з code-controlled значенням; інакше переробляємо на tagged template `sql\`...${value}...\``. Кожен легітимний виклик має супроводжуватись маркером`// allow-unsafe: <причина>` на тому ж рядку або рядком вище.
- `check-js-bun-db.mjs`: замість вузької перевірки `sql.unsafe` із tagged-template і інтерполяцією тепер сканер `findBunSqlUnsafeUseWithoutAllowMarkerInText` падає на будь-якому `obj.unsafe(...)` без маркера-коментаря з непорожньою причиною (line- або block-коментар на тому ж рядку чи безпосередньо перед викликом).
- `ast-scan-utils.mjs`: додано `parseProgramAndCommentsOrNull` — окремий вхід для перевірок, яким потрібні коментарі поряд з AST.

## [1.8.159] - 2026-05-01

### Added

- Інтеграція з Claude Code: новий каталог `npm/.claude-template/` із `settings.template.json` (Stop hook + permissions allowlist), `npm-CLAUDE.md` (path-scoped нагадування для роботи в `npm/`) і slash-команду `/n-check`.
- `sync-claude-config.mjs`: під час `npx @nitra/cursor` синхронізує `.claude/settings.json` (merge — користувацькі поля зберігаються, наші hooks ідентифікуються маркером і перезаписуються), `npm/CLAUDE.md` і slash-команди checks.
- Subcommand `npx @nitra/cursor stop-hook` — точка входу Stop hook Claude Code (читає stdin, виходить 0 при `stop_hook_active=true` для захисту від рекурсії, інакше викликає `check`).
- Поле `claude-config` у `.n-cursor.json` (default `true`) для опт-ауту.
- Тести `npm/tests/sync-claude-config.test.mjs` — merge allow-list/hooks, інтеграція, ідемпотентність, опт-аут (12 кейсів).

### Changed

- `npm/schemas/n-cursor.json`: додано опис поля `claude-config`.
- `npm/package.json`: `.claude-template` додано в масив `files`, щоб публікувався з пакетом.

## [1.8.158] - 2026-05-01

### Changed

- `check-hasura.mjs`: файл `.env` без імені (локальний файл розробника) виключено з перевірки `HASURA_GRAPHQL_ENDPOINT` — скануються лише `*.env` із префіксом (`dev.env`, `production.env` тощо).
- `hasura.mdc`: явно зафіксовано виключення для `.env` без імені.

## [1.8.157] - 2026-04-30

### Added

- Правило `npm-module.mdc`: секція **CHANGELOG** — разом із bump build-версії в `npm/package.json` обовʼязково оновлювати `npm/CHANGELOG.md` (Keep a Changelog).
- `check-npm-module.mjs`: перевірка наявності `npm/CHANGELOG.md`, наявності в `files` у `npm/package.json` і запису для поточної версії.
- `check-hasura.mjs`: перевірка `HASURA_GRAPHQL_ENDPOINT` у `*.env` для проєктів **nitra** і **abie** — має бути внутрішнім кластерним URL виду `http://<service>.<namespace>.svc.<cluster>.internal:<port>`; за наявності `hasura/k8s/base/svc-hl.yaml` та `hasura/k8s/base/namespace.yaml` додатково звіряється `<service>` і `<namespace>`.

### Changed

- `npm/package.json`: `CHANGELOG.md` додано в масив `files`, щоб публікувався разом із пакетом.
- `hasura.mdc`: текст правила переформульовано як людинозрозумілий з прикладом і посиланням на `check-hasura.mjs`.
