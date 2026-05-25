# Changelog

Усі помітні зміни цього модуля документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [1.23.0] - 2026-05-25

### Added

- **Pi.dev ADR hooks** — bundled TS-extension `npm/.pi-template/extensions/n-cursor-adr/index.ts` копіюється у `.pi/extensions/n-cursor-adr/index.ts` проєкту-споживача коли `adr` ∈ `.n-cursor.json#rules`. На pi `agent_end` event серіалізує `ctx.sessionManager.getEntries()` у Claude-сумісний JSONL у `tmpdir()`, спавнить існуючі `.claude/hooks/{capture,normalize}-decisions.sh` через `pi.exec` (async, `signal: ctx.signal`, timeouts 180s/600s). Жодного дублювання bash-логіки: skip/throttle/LLM-CLI-selection лишається у bash. Recursion guard через env-vars `CAPTURE_DECISIONS_RUNNING` / `ADR_NORMALIZE_RUNNING`, які bash виставляє перед спавном LLM CLI.
- `npm/scripts/sync-claude-config.mjs`: експорт `PI_DIR`, `PI_EXTENSIONS_DIR`, `PI_TEMPLATE_DIR_NAME`, `PI_EXTENSION_NAME`; нова функція `syncPiExtensions(projectRoot, bundledPackageRoot)` (copy) і `removeOrphanPiExtension(projectRoot)` (cleanup); поле `piExtension: boolean` у відповіді `syncClaudeConfig` (gated на `adr` ∈ rules).
- `npm/package.json` `files` array: додано `.pi-template` — bundled-директорія шипиться разом із пакетом.
- `npm/bin/n-cursor.js`: у `🤖 Claude-конфіг`-логу після sync додається `.pi/extensions/n-cursor-adr/index.ts` коли pi-extension згенерована.

## [1.22.0] - 2026-05-25

### Added

- **`npx @nitra/cursor lint`** — оркестратор лінт-ланцюжка з тайменгом на кожен крок. Послідовно запускає присутні у root `package.json` скрипти з фіксованого списку (`lint-ga`, `lint-js`, `lint-rego`, `lint-style`, `lint-text`, `lint-security`, `oxfmt`), **fail-fast** на першому ненульовому exit-коді. Наприкінці друкує таблицю `⏱ Lint timing` з часом кожного кроку — для атрибуції повільних кроків замість анонімного `&&`-агрегатора.
- **`runFixCommand` тепер друкує `⏱ Fix timing`** після прогону всіх `rules/<id>/fix.mjs` — per-rule час + сума. Маркер `❌` на впалих рядках.
- `npm/scripts/lib/timing-summary.mjs` — чистий форматер `formatTimingSummary(title, entries)` (спільний для fix і lint). 9 тестів у `tests/timing-summary.test.mjs`.
- `npm/scripts/lib/run-lint-cli.mjs` — `runLintCli({ cwd, spawnSyncFn, now, log, logError })` з DI для юніт-тестів. 7 тестів у `tests/run-lint-cli.test.mjs`.

### Changed

- Кореневий `package.json` цього монорепо: `lint` → `n-cursor lint`; додано окремий скрипт `oxfmt: "oxfmt ."`, який раніше йшов у хвості ланцюжка прямою командою.
- Скіли `/n-fix` і `/n-lint`: додано вимогу копіювати таблицю `⏱` з виводу інструмента у фінальне резюме відповіді користувачу.

## [1.21.0] - 2026-05-25

### Changed

- **Stop-hook → PostToolUse з маршрутизацією за типом файла** (BREAKING для консьюмерів із кастомним `stop-hook` записом). `.claude-template/settings.template.json` тепер реєструє `PostToolUse` (matcher `Edit|Write|MultiEdit`, timeout 300) із командою `npx --no @nitra/cursor post-tool-use-fix` замість попереднього синхронного `Stop`-хука, що ганяв повний `fix` усіх правил на кожному turn-і. Новий хук читає `tool_input.file_path` зі stdin і запускає `fix` **лише** з релевантними правилами: `*.{mjs,js,cjs,ts,tsx,jsx}` → `js-lint`; `*.vue` → `js-lint style-lint vue`; `*.{css,scss,sass}` → `style-lint`; `**/k8s/**/*.{yaml,yml}` → `k8s`; `*.rego` → `rego`; `Dockerfile`/`*.Dockerfile` → `docker`; `.github/workflows/*.{yml,yaml}` → `ga`; `package.json` → `npm-module bun`; `*.sh` → `security`; `*.md` → `text` (поза `docs/adr/**` — там покриває async `normalize-decisions.sh`).
- **CLI**: підкоманду `npx @nitra/cursor stop-hook` видалено; замість неї — `npx @nitra/cursor post-tool-use-fix`. `MANAGED_HOOK_COMMAND_MARKER` у `sync-claude-config.mjs` змінено на `@nitra/cursor post-tool-use-fix`; legacy-маркер `@nitra/cursor stop-hook` лишається у `MANAGED_HOOK_COMMAND_MARKERS` для автоматичного cleanup-у старих entries при наступному `npx @nitra/cursor`. `mergeHooks` тепер обходить union usually template+existing events, тому застарілі managed-групи у вже-непотрібних подіях (`Stop` у даному випадку) теж зачищаються.

### Added

- `npm/scripts/post-tool-use-fix.mjs` — реалізація `routeFilePathToRules(filePath)` (чиста функція, picomatch) і `runPostToolUseFixCli({ stdinJson, spawnFn })` (DI-friendly для тестів). 21 тест у `npm/scripts/tests/post-tool-use-fix.test.mjs`.
- `LEGACY_STOP_HOOK_COMMAND_MARKER` — публічний export для тестів і потенційних консьюмерів, які перевіряють відсутність застарілого хука.

### Removed

- `npm/scripts/claude-stop-hook.mjs` — більше не потрібен.

## [1.20.0] - 2026-05-25

### Added

- **NetworkPolicy: два повних канон-snippets**: `deployment.snippet.yaml` (для `Deployment`/`Job`/`CronJob`/`DaemonSet`) і `statefulset.snippet.yaml` (повний канон для `StatefulSet` з intra-replica правилами). Жодного runtime-merge — JS-генератор/rego обирають один за `kind` workload-у через анотацію `metadata.annotations['nitra.dev/workload-kind']`. Нові publiс exports: `loadSnippetSpec('deployment'|'statefulset')`, `KIND_TO_SNIPPET`, `snippetNameForKind(kind)`. `buildNetworkPolicyYaml(deployName, appLabel, kind)` — `kind` тепер обовʼязковий (throws на невідомий). Rego (`network_policy.rego`) робить superset-перевірку проти обраного канону; safety-net deny на allow-all `egress: [{}]`. GKE NodeLocal DNSCache: link-local `169.254.0.0/16` UDP/TCP 53 — у обох канонах. **Breaking** з v1.19.x: видалено `networkPolicyManifestViolations` (структуру тримає rego); `buildNetworkPolicyYaml` без `kind` тепер throws. Перейменування `common.snippet.yaml` → `deployment.snippet.yaml`; `data.template.snippet` → `data.template.deployment_snippet` у rego.
- **`rules/js-lint/coverage`**: `parseStrykerReport` тепер зчитує оригінальний код вижилих мутантів (`extractOriginal`), групує по файлах і повертає `survived: [{file, mutants: [{line,col,mutantType,original,replacement}], exampleTest, recommendationText}]`; `findExampleTest` + `extractFirstTestBlock` знаходять і витягують перший тест-блок із тест-файлу поруч — для стилю.
- **LLM-рекомендації у COVERAGE.md**: коли встановлено `ANTHROPIC_API_KEY`, `n-cursor coverage` робить один Anthropic API-виклик на кожен файл з вижилими мутантами та записує рекомендацію «Що треба протестувати» у секцію `## Recommendations`. Модель: `claude-haiku-4-5-20251001` з prompt caching (`ephemeral`). Без ключа — секція генерується без LLM-тексту.
- **`rules/js-lint/coverage/lib/generate-recommendation.mjs`**: `generateMutantRecommendation(client, sourceContent, mutants)` — ізольований модуль LLM-виклику.
- **`@anthropic-ai/sdk`** у dependencies — потрібен для LLM-рекомендацій (опціонально: якщо `ANTHROPIC_API_KEY` не задано, sdk не викликається).
- **`rules/test/coverage`**: `renderMarkdown` генерує секцію `## Recommendations` з per-file підрозділами (`### <file>`) — таблиця мутантів + приклад тесту + LLM-текст (якщо є).
- **Stryker incremental mode** у `stryker.config.baseline.mjs`: `incremental: true` + `incrementalFile: 'reports/stryker/stryker-incremental.json'` — Stryker зберігає прогрес між прогонами, відновлює стан після переривання (SIGURG, OOM тощо).
- **`skills/coverage-fix`**: новий скіл `/n-coverage-fix` — читає `## Recommendations` з COVERAGE.md і ітеративно дописує тести до конвергенції mutation score, включаючи LLM-рекомендації та приклади тестів у промпт агента.

## [1.19.2] - 2026-05-25

### Fixed

- **`js-lint` coverage провайдер**: виправлено `bunx stryker run` → `bunx @stryker-mutator/core run`. Стара команда (`bunx stryker`) резолвить deprecated unscoped-пакет без CLI, через що `mutation.json` не створювався і coverage падав з помилкою.
- **`npm/stryker.config.mjs`**: додано `mutate: ['scripts/*.mjs', 'scripts/utils/*.mjs', 'rules/*/coverage/coverage.mjs']` — без обмеження Stryker намагався мутувати 422 файли, що робить coverage-прогін нереалістичним. `commandRunner.command` змінено на `bun test --parallel` (раніше `bun test` без флагу) — ізолює worker-процеси та запобігає git-race у withTmpCwd-тестах.

## [1.19.1] - 2026-05-25

### Fixed

- **`bun test --parallel`** як default у `npm/package.json` (`test`, `test:coverage`). Без флагу bun-test крутить усі 95 файлів у одному процесі — а `withTmpCwd` (`scripts/utils/test-helpers.mjs`) міняє глобальний `process.cwd()`, через що тести гонять один за одного: `prev = process.cwd()` ловить tmp-dir сусіднього тесту, `chdir(prev)` на restore падає `ENOENT` (бо сусід уже видалив свій tmp), або `git commit` з `cwd: process.cwd()` злітає в реальний repo з `npm/CHANGELOG.md`/`npm/package.json` як stub-fixture. `--parallel` дає окремий worker-процес на файл (з `process.cwd()` per-process), що геть знімає race. Знизило 22 тести з fail до pass, час suite'у — 211с → 47с.
- **`tests/integration-repo-checks.test.mjs`** — додано explicit `30000`ms timeout для `check-* на реальному репозиторії > узгоджені з поточним деревом cursor`. Тест послідовно ганяє 10 check-функцій із subprocess-викликами (shellcheck-стаб + conftest/opa/regal/kubeconform/kubescape) — на macOS виходить ~3-7с, дефолтний 5000ms-timeout bun-test'у не вистачає.

## [1.19.0] - 2026-05-25

### Added

- **Pi.dev інтеграція** — CLI під час синку генерує `.pi/skills/<dir>/SKILL.md` для кожного скілу з `.cursor/skills/<dir>/` із frontmatter `name`+`description` (формат pi.dev: 1-64 chars, `[a-z0-9-]`). Тіло — делегат `Виконай інструкції зі скілу .cursor/skills/<dir>/SKILL.md.`, симетрично до `.claude/commands/<dir>.md`. Always-on, без флагу. Покриває керовані (з пакета) і локальні скіли; orphan-cleanup видаляє `.pi/skills/n-*` дири, яких немає у конфігу, і локальні дири, яких більше немає у `.cursor/skills/`.
- `npm/bin/n-cursor.js`: константа `PI_SKILLS_DIR='.pi/skills'`, функція `formatPiSkillFrontmatter(name, desc)`, синки `syncPiSkills`/`syncLocalOnlyPiSkills` + cleanups `removeOrphanManagedPiSkillDirs`/`removeOrphanLocalPiSkillDirs`. Новий `runSyncStep('❌ Pi skills: ', …)` після Commands-блоку у головному потоці.

## [1.18.3] - 2026-05-25

### Changed

- Canonical `.cargo/mutants.toml` baseline: `additional_cargo_test_args = ["--lib", "--tests"]` — виключає `--bins` і `--doc` фази, які перебудовують Tauri-бінарник та doc-tests при кожному мутанті, збільшуючи час з секунд до хвилин.

## [1.18.2] - 2026-05-25

### Fixed

- `rules/adr/js/tests/capture-decisions-tooling-only.test.mjs`, `rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs` — `process.env.HOME` → `env.HOME` із `'node:process'` (js-run.mdc: `process.env` deprecated, треба `env` з `node:process` або `@nitra/check-env`).

## [1.18.1] - 2026-05-25

### Fixed

- **`scripts/cli-entry.mjs::isRunAsCli`** + **`scripts/lib/run-rule-cli.mjs::isRunAsCli`** — функція приймала `()` без аргументів і всередині дивилася на власний `import.meta.url`, а не на caller'а. Через те, що `import.meta` лексично прив'язаний до файлу, де записаний, helper-функція ВСІГДА бачила свій файл — `cli-entry.mjs` / `run-rule-cli.mjs` — і ніколи не дорівнювала `process.argv[1]`. Результат: усі ~40 `if (isRunAsCli())` у `rules/<id>/fix.mjs` / `lint/*.mjs` / `bin/rename-yaml-extensions.mjs` ВСІГДА йшли в else-гілку, і `bun rules/<id>/fix.mjs` мовчки виходив `0` без жодного output'у. `npx @nitra/cursor fix <rule>` → `runFixCommand` → `spawnSync('bun', [fix.mjs])` → exit 0 без жодного reporter-звіту.
- **Fix:** функція тепер приймає `metaUrl` параметром: `isRunAsCli(import.meta.url)`. Реалізація через `realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1]))` — `realpath` знімає різницю «symlink vs canonical» (macOS `/tmp` ↔ `/private/tmp`, pnpm content-addressable links, `node_modules/.bin/*` shim).
- **Консолідація:** `run-rule-cli.mjs::isRunAsCli` тепер `export { isRunAsCli } from '../cli-entry.mjs'` — одне джерело правди. Existing import paths у callers лишилися без змін.
- **Callsites:** всі ~40 викликів `isRunAsCli()` оновлено на `isRunAsCli(import.meta.url)`.
- **Tests:** додано три нові кейси у `scripts/tests/cli-entry.test.mjs` (entry-detection через spawn-fixture, symlink-нормалізація через `/tmp` → `/private/tmp`, no-arg fallback). Fixture — `scripts/tests/fixtures/cli-entry-as-cli.mjs`.

## [1.18.0] - 2026-05-25

### Added

- `text`: `docs/adr/**` у канонічному `ignorePaths` правила `.cspell.json` (`policy/cspell/template/.cspell.json.snippet.json`). Машинно-генеровані ADR-документи більше не валідуються cspell-ом — це розриває петлю «правка `.cspell.json` → новий ADR-draft → знову `cspell` ламається на ньому». Локальні розширення `ignorePaths` лишаються дозволені (rego subset-of).
- `adr`: ENV `ADR_NORMALIZE_SKIP_TOOLING_ONLY` (default `1`) — вимикає structural skip у capture-/normalize-хуках. Документація в `adr.mdc` (таблиця ENV) і `skills/adr-normalize/SKILL.md`.

### Changed

- `adr`: `.claude-template/hooks/capture-decisions.sh` — перед LLM-викликом перевіряє список `tool_use`-правок із transcript'у. Якщо всі правки у вузькому allowlist (`.cspell.json`, `docs/adr/*.md`, кореневі `AGENTS.md`/`CLAUDE.md`, `CHANGELOG.md`, `*/package.json` із diff виключно по ключу `version`) — `exit 0` із записом `skipping ADR capture: tooling-only session` у лог. Inline-функція `is_tooling_only_change` + `git_diff_only_version_field`, bash 3.2-сумісно.
- `adr`: `.claude-template/hooks/normalize-decisions.sh` — після формування батча для кожної чернетки читає `transcript:` із frontmatter і та сама перевірка allowlist'у. Tooling-only чернетки видаляються без виклику LLM; якщо батч порожній — `exit 0`.
- `text.mdc` 1.29 → 1.30: документація `docs/adr/**` у `ignorePaths`; приклади `.cspell.json` оновлено.
- `adr.mdc` 2.1 → 2.2: нова секція «Tooling-only skip» у Фазі 1, bullet у Фазі 2, рядок у таблиці ENV.

### Notes

- Існуючі ENV (`ADR_NORMALIZE_THRESHOLD`, `…_MIN_INTERVAL_HOURS`, `…_BATCH`, `…_DRY`, recursion-guard `CAPTURE_DECISIONS_RUNNING` / `ADR_NORMALIZE_RUNNING`) поведінку не змінюють.
- `cspell.rego` subset-of-перевірку зберігає — нічого не зламано для проєктів, де користувач уже руками додав `docs/adr/**` у свій `.cspell.json`.

## [1.17.4] - 2026-05-24

### Changed

- Концерн `stryker_config`: gitignore-патерн `**/reports/stryker/.tmp/` + `**/reports/stryker/mutation.json` замінено на один broader `**/reports/stryker/` — увесь каталог Stryker-output-у. Покриває не лише `.tmp/` + `mutation.json`, а й HTML/dashboard-репорти якщо користувач додасть інші reporter-и. Існуючі дрібніші патерни в `.gitignore` користувача не видаляються (idempotent helper лише дописує), але стають надлишковими — користувач може почистити вручну за бажанням.
- `test.mdc` 2.1 → 2.2: оновлено опис gitignore-керування під новий broader patern.

## [1.17.3] - 2026-05-24

### Added

- Концерн `stryker_config` правила `test` тепер ідемпотентно додає у кореневий `.gitignore` патерни Stryker-output-у:
  - `**/reports/stryker/.tmp/` — in-place backup-каталог (з baseline-у `tempDirName`).
  - `**/reports/stryker/mutation.json` — JSON-репорт мутацій.
  - Header-секція `# Stryker mutation testing (test.mdc)`, sectioning через `ensureGitignoreEntries`.
- Спільний helper `npm/scripts/utils/ensure-gitignore-entries.mjs` — append-only оновлювач `.gitignore` з header-секціями. Idempotent (точне співпадіння рядка після `trim`), створює файл якщо немає, зберігає trailing-newline. 5 unit-тестів.

### Changed

- `test.mdc` 2.0 → 2.1: додано параграф про gitignore-керування Stryker-output-у в секцію «Налаштування mutation-testing».
- `stryker_config` concern: додано виклик `ensureGitignoreEntries` після копіювання baseline-ів; репортер видає pass-повідомлення про додані патерни.

## [1.17.2] - 2026-05-24

### Added

- Правило `test`: два нових концерни — `stryker_config` і `cargo_mutants_config`. Self-gating через `.n-cursor.json#rules`: концерн активний лише якщо відповідне залежне правило (`js-lint` / `rust`) enabled. **Iterate-all-workspaces**: при відсутності цільового файлу копіює canonical baseline у КОЖЕН workspace-каталог (не лише workspaces[0]).
  - `stryker.config.mjs` у кожному JS-root (всі workspaces з package.json, або cwd у single-package) — мінімум для роботи з `bun test`.
  - `.cargo/mutants.toml` у каталозі КОЖНОГО Cargo.toml-маніфесту: корінь + workspaces (з підтримкою Tauri-патерну `<ws>/src-tauri/Cargo.toml`) — комент-плейсхолдер; cargo-mutants має робочі defaults.
- Спільні резолвери у `npm/scripts/utils/`: `resolveJsRoot` (single, для coverage-провайдера) + `resolveAllJsRoots` (plural, для test-концерну); `resolveCargoManifest` (single) + `resolveAllCargoManifests` (plural). Coverage-провайдери js-lint і rust реюзають single-варіанти.

### Changed

- `test.mdc` 1.2 → 2.0 (major): `alwaysApply: true → false`; явні `globs` (`.n-cursor.json`, `package.json`, `Cargo.toml`, mutation-config-цілі, `*.test.mjs`). Нова секція «Налаштування mutation-testing» з посиланнями на baselines.
- `js-lint/coverage/coverage.mjs`: hint при missing `mutation.json` тепер вказує на `npx @nitra/cursor fix test`. `resolveJsRoot` витягнуто у спільний модуль.
- `rust/coverage/coverage.mjs`: `resolveCargoManifest` витягнуто у спільний модуль (контракт `null` замість throw для missing manifest; user-facing throw зберігся на callsite).

## [1.17.1] - 2026-05-24

### Fixed

- **`js-lint/coverage/coverage.mjs` + `rust/coverage/coverage.mjs`** — `Bun.spawn` (runtime-only) замінено на `node:child_process.spawnSync`. CLI `n-cursor` запускається через `#!/usr/bin/env node` shebang, отже Node-runtime — `Bun.*` API недоступні в реальному прогоні (тести використовували ін'єктований runner і не виявляли цього). Тестова ін'єкція runner-а лишається тією самою (контракт `runJsCoverage`/`runStryker`/`runLlvmCov`/`runCargoMutants` mock-ів — без змін).

## [1.17.0] - 2026-05-24

### Added

- CLI-команда `n-cursor coverage` — оркестратор покриття + мутаційного тестування з discovery провайдерів через `.n-cursor.json#rules`. Канон `scripts.coverage` (контейнер `package.json`) у правилі `test`. Лок — прямий `withLock('coverage', ...)`.
- Провайдер `js-lint/coverage/` — `bun test --coverage --coverage-reporter=lcov` + `bunx stryker run`; парсить lcov.info і `reports/stryker/mutation.json`.
- Провайдер `rust/coverage/` — `cargo llvm-cov --json` + `cargo mutants --in-place`; парсить `data[0].totals` і `outcomes.json` (caught = caught + timeout; total = caught + missed; unviable виключено).
- Policy `test.package_json` з template `package.json.contains.json` — substring-вимога `scripts.coverage` містити `n-cursor coverage`.

### Fixed

- `test/coverage/coverage.mjs::loadProvider` — коли правило `test` присутнє у `.n-cursor.json#rules` (як у самому `@nitra/cursor`), оркестратор знаходив власний файл `npm/rules/test/coverage/coverage.mjs` і намагався викликати його як провайдер (`provider.detect is not a function`). `loadProvider` тепер перевіряє, що модуль експортує обидва `detect` і `collect` як функції — інакше silently skip. Regression-тест: `пропускає модулі без detect/collect (наприклад сам оркестратор)`.

### Changed

- `test.mdc` 1.1 → 1.2: додано секцію «Покриття + мутаційне тестування» з посиланням на template.
- `js-lint.mdc` 1.24 → 1.25: додано параграф із посиланням на JS-coverage-провайдер.
- `rust.mdc` 1.0 → 1.1: додано параграф із посиланням на Rust-coverage-провайдер.
- `npm/bin/n-cursor.js`: новий `case 'coverage'` + розширений help-string.

## [1.16.1] - 2026-05-24

### Fixed

- **`npm/rules/ga/js/workflows.mjs::GA_POLICY_DIR`** — flat-layout regression: `join(HERE, '..', '..', 'policy')` давав `npm/rules/policy/` замість `npm/rules/ga/policy/`. `HERE` для `rules/<rule>/js/<concern>.mjs` живе на 1 рівень ближче до `rules/<rule>/`, ніж попередній nested layout. Виправлено на `join(HERE, '..', 'policy')` — `loadTemplate(concernDir)` тепер реально читає `template/<workflow>.snippet.yml`, замість тихо повертати `{}` і втрачати `data.template.snippet.*` у rego-перевірках (`step0_with_canonical` і т.д. падали з-за `null`). Тест `check-ga: shellcheck в PATH > exit 0` тепер pass.
- **`npm/rules/adr/js/hooks.mjs::BUNDLED_HOOKS_DIR`** і **`npm/rules/adr/js/tests/hooks.test.mjs::BUNDLED_HOOKS_DIR`** — той самий клас regression-у: `..` на одне більше за потрібне після flat-layout, тож шлях зривався у `cursor/.claude-template/hooks/` замість `npm/.claude-template/hooks/`, через що `check-adr` та 4 тести у `hooks.test.mjs` падали з `ENOENT`/`канонічний скрипт не знайдено`. У `hooks.mjs` `..×4` → `..×3`; у тесті `..×5` → `..×4`.

## [1.16.0] - 2026-05-24

### Changed

- **`utils/` vs `lib/` (js-lint.mdc):** усі 10 каталогів `npm/rules/<rule>/utils/` перейменовано в `npm/rules/<rule>/lib/` — їхній вміст domain-bound (запускає hadolint, парсить kustomize/k8s-tree, конкретні AST-сканери правила, читання `.n-cursor.json` тощо), що за правилом `utils/` vs `lib/` має жити в `lib/`. Зачеплені правила: `abie`, `changelog`, `docker`, `graphql`, `js-bun-db`, `js-lint`, `js-mssql`, `js-run`, `rust`, `vue`. Тести й `__fixtures__/` переїхали разом із батьківським каталогом. 26 внутрішніх `'../utils/'`-імпортів у `js/`/`lint/` і 3 зовнішніх з `npm/scripts/auto-rules.mjs` оновлено на `'../lib/'` / `'../<rule>/lib/'`. JSDoc-шлях у `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs` (приклад запуску) і JSDoc-натяк у `npm/rules/rust/lib/has-cargo-toml.mjs` теж оновлені.
- **`npm/scripts/utils/` розщеплено на `utils/` + `lib/`:** 19 файлів (`run-rule`, `run-rule-cli`, `run-standard-rule`, `run-standard-lint`, `run-lint-step`, `run-conftest-batch`, `discover-checkable-rules`, `discover-check-rules-from-cursor`, `list-rule-ids`, `load-cursor-config`, `read-n-cursor-config-lite`, `resolve-target-files`, `check-mdc-template-refs`, `check-reporter`, `gha-workflow`, `generated-markdown`, `inline-template-links`, `template`, `workspaces`) і 14 відповідних тестів + `__fixtures__/` переїхали у `npm/scripts/lib/`. У `npm/scripts/utils/` залишилися 9 справді generic-файлів (`ast-scan-utils`, `find-package-json-paths`, `pass`, `resolve-cmd`, `test-helpers`, `walk-cache`, `walkDir`, `with-lock`, `worktree-fingerprint`) + 4 їхні тести. `~220` імпортів `scripts/utils/<lib-file>` по всьому `npm/` оновлено на `scripts/lib/<lib-file>`; внутрішні lib→utils переходи (`check-reporter→pass`, `resolve-target-files→walkDir`, `run-conftest-batch→resolve-cmd`, `run-lint-step→resolve-cmd`, `run-rule-cli→walk-cache`, `run-standard-lint→with-lock`, `run-standard-rule→walk-cache,with-lock`) переписані на `'../utils/<file>'`; lib-тести з залежністю від `test-helpers` — на `'../../utils/test-helpers.mjs'`.
- **`scripts/utils/redis-imports.mjs` → `npm/rules/js-bun-redis/lib/redis-imports.mjs`** (+тест). Симетрично до `bunyan-imports`/`vue-forbidden-imports`: per-rule сканер живе в самому правилі, а не в спільних скриптах. Імпорт `scripts/utils/ast-scan-utils.mjs` зберігся (це справді generic helper).

### Added

- **Новий концерн `js-lint.utils_imports`** (`npm/rules/js-lint/js/utils_imports.mjs`): обходить кожен `utils/`-каталог у monorepo-воркспейсах і падає, якщо знаходить relative-імпорт з `..` у не-тестовому `.[cm]?[jt]sx?`-файлі. Дозволені лише same-dir (`./X`), bare-пакети та `node:*`; cross-rule, конфіги проєкту чи sibling-utils → fail з підказкою «перенеси у `lib/`». Тести (`*.test.mjs`) і будь-який `__fixtures__/` пропускаються — тестам легально треба `../X`. У `js-lint.mdc` під секцією «Структура спільних модулів: `utils/` vs `lib/`» додано абзац про автоматичну перевірку.

## [1.15.1] - 2026-05-24

### Fixed

- `adr.mdc`: виправлено stale template-лінк `./js/hooks/template/.gitignore.snippet` → `./js/templates/hooks/.gitignore.snippet` (після flat-layout міграції `js/<concern>.mjs` у комміті `6ecd84c` шлях не оновили, через що `inlineTemplateLinks` падав під час `bun start` із `file not found`).

## [1.15.0] - 2026-05-24

### Added

- **Нове правило `rust`** (`npm/rules/rust/`): канонічний скрипт `lint-rust` у `package.json` (`cargo fmt` → `cargo clippy --fix` → `cargo clippy ... -D warnings`), CI workflow `.github/workflows/lint-rust.yml` з `dtolnay/rust-toolchain@stable` (`components: rustfmt, clippy`) + `Swatinem/rust-cache@v2`, VSCode-розширення `rust-lang.rust-analyzer` + `tamasfe.even-better-toml`. Auto-trigger — наявність `Cargo.toml` (`hasCargoToml` fact у `auto-rules.mjs`). Три rego policy-пакети (`package_json`, `vscode_extensions`, `lint_rust_yml`) читають канон через `data.template.*` з drift-тестами.

### Changed

- **Правило `tauri` (1.1 → 1.2) звужено:** `rust-lang.rust-analyzer` більше не вимагається у `tauri.vscode_extensions` — перенесено в нове правило `rust`. Tauri-проєкт автоматично активує `rust` через `src-tauri/Cargo.toml`. Канон `tauri.mdc` оновлено: лишається лише `tauri-apps.tauri-vscode`.

## [1.14.0] - 2026-05-24

### Changed (BREAKING)

- **Flat концерн-лейаут:** кожен JS-концерн правила тепер один файл `npm/rules/<rule>/js/<concern>.mjs` замість вкладеного `js/<concern>/check.mjs`. Tests — у `js/tests/<concern>.test.mjs` (single) або `js/tests/<concern>/<name>.test.mjs` (multi+fixtures). Templates — у `js/templates/<concern>/`. Data (json/tsv) — у `js/data/<concern>/`. Helpers (cross-concern і concern-private) — у `<rule>/utils/<helper>.mjs` peer до `js/` (existing convention з `abie/utils/`).
- **`JsConcern.files` removed:** один файл на concern, поле більше не потрібне. `runRule` обчислює шлях як `<rule>/js/<concern.name>.mjs`; `resolveJsCheckPath` тепер `(bundledRulesDir, ruleId, concern)` без `fileName`.
- **`CHECK_FILENAME_RE` і `TEST_SUFFIX` removed:** discovery більше не використовує regex `check-*.mjs` — `listJsConcerns` фільтрує `*.mjs` без `.test.mjs` (підкаталоги скіпаються через `!isFile()`).
- **`scripts/sync-claude-config.mjs::ADR_GITIGNORE_SNIPPET_REL`** змінено: `rules/adr/js/hooks/template/.gitignore.snippet` → `rules/adr/js/templates/hooks/.gitignore.snippet`.
- **`scripts/utils/inline-template-links.mjs::TEMPLATE_SEGMENT_RE`** розширено з `/\/template\//` до `/\/templates?\//` — підтримує і `js/templates/` (нова конвенція), і `policy/<concern>/template/` (існуюча).

### Breaking (для зовнішніх інтеграторів)

- Каталог `npm/rules/<rule>/js/<concern>/check.mjs` тепер `npm/rules/<rule>/js/<concern>.mjs`. Tests → `js/tests/`, templates → `js/templates/`, data → `js/data/` (усе всередині `js/`); helpers → `<rule>/utils/<helper>.mjs` (peer до `js/`, як `abie/utils/`). Імпорти helpers з concern-файлів: `from '../utils/<helper>.mjs'`. Міграційний скрипт у git-історії — комміт `refactor(rules): flat layout js/<concern>.mjs (міграційний move)`.

### Notes

- Convention для helper-імен: namespace-префікс (`<rule>-` або `<concern>-`) робить колізії у плоскому `utils/` неможливими (як уже робить abie: `k8s-tree`, `kustomization-patches`; docker: `docker-mirror`; vue: `vue-forbidden-imports`).
- Шпаргалка імпорт-шляхів у `.cursor/rules/scripts.mdc` (1.10 → 1.11).
- `.cursor/rules/conftest.mdc` — алгоритм Rego-first переписаний під flat-layout.
- Канонічні `security.mdc` і `k8s.mdc` markdown-лінки на template-файли оновлені (`./js/templates/<concern>/`).

## [1.13.90] - 2026-05-24

### Added

- **`js-lint` 1.23 → 1.24 — конвенція `utils/` vs `lib/`:** додано секцію «Структура спільних модулів». `utils/` — низькорівневі generic helpers без домену (могли б жити окремим npm-пакетом); `lib/` — внутрішні модулі з доменним state/конфігом/side effects. Канонічні назви лише ці дві — не `shared/`, не `common/`. Дзеркало `.cursor/rules/n-js-lint.mdc` оновлено.

## [1.13.89] - 2026-05-23

### Changed

- **Stop-hook кличе `fix` замість deprecated `check`:** `scripts/claude-stop-hook.mjs` тепер спавнить `npx --no @nitra/cursor fix` — без deprecation-warning'а на кожен Stop event Claude Code.
- **`.claude-template/commands/n-check.md` видалено** (разом з локальним `.claude/commands/n-check.md`). Після CLI-перейменування `check` → `fix` slash-команда `/n-check` вказувала на застарілу команду. У `syncClaudeConfig` логіка sync `commands/*.md` залишилась; зараз темплейт порожній. Тест `створює settings.json + slash-команди` переписано на «без slash-команд, коли темплейт порожній».
- **JSDoc/docstring чистка:** `bin/n-cursor.js` (CLI usage header), `scripts/claude-stop-hook.mjs`, `scripts/sync-claude-config.mjs`, `rules/image-compress/js/package_setup/check.mjs` — згадки `npx @nitra/cursor check`, `/n-check`, `npm/scripts/check-*.mjs` оновлено на актуальну CLI (`fix`) і шляхи (`rules/<id>/fix.mjs`, `rules/<id>/js/<concern>/check.mjs`).
- **`.cursor/rules/conftest.mdc`** — алгоритм рішення / патерн Rego-authoritative / Workflow / Red-flags переписано під фактичну структуру `rules/<rule>/js/<concern>/check.mjs` + `rules/<rule>/policy/<name>/`. Прибрано згадки `npm/scripts/check-<rule>.mjs` та `npm/policy/<rule>/` (legacy шляхи); приклади `check abie`, `check ga` → `fix abie`, `fix ga`.
- **`docs/fix-cursor-skill.md`** — ASCII-діаграми, workflow-кроки та таблиця "Анатомія Skill-файлу" → `npx @nitra/cursor fix`; згадка `check-*.mjs скрипти` → `rules/<id>/fix.mjs правил`.

### Notes

- Споживачі: після оновлення вручну видалити `.claude/commands/n-check.md` (sync не вичищає orphan slash-команди з темплейту). Активна команда — `/n-fix` (зі скілу `n-fix`).
- В `.claude/settings.json` permission `Bash(npx @nitra/cursor check)` видалено як redundant — вайлдкард `Bash(npx @nitra/cursor *)` нижче вже покриває обидві команди.

## [1.13.88] - 2026-05-23

### Changed

- **`scripts/utils/with-lock.mjs` + тести:** локальна `sleep(ms)` через `new Promise(r => setTimeout(r, ms))` замінена на іменований імпорт `setTimeout as sleep` із `node:timers/promises`. Відповідає правилу `js-run` (без ручних `setTimeout`-промісів) — перевірка `npx @nitra/cursor fix js-run` стала зеленою.

## [1.13.87] - 2026-05-23

### Added

- **`scripts/utils/run-standard-lint.mjs`** — спільна точка входу для всіх `lint-<rule>` підкоманд, дзеркально до `runStandardRule` для `fix-<id>`. Виводить ключ локу зі шляху (`basename(dirname(lintDir))`) і прокидає `opts` у `withLock`. Місце для майбутніх крос-cutting розширень (телеметрія, env-toggle вимкнення локу, common preflight-логування) — патчиш одне місце, не 5 файлів.

### Changed

- **5 `rules/<rule>/lint/lint.mjs` (ga, rego, text, k8s, docker)** більше не імпортують `withLock` напряму — використовують `runStandardLint(import.meta.dirname, runLint<Foo>Steps)`. Ім'я правила в одному місці — у каталозі.
- **`.cursor/rules/scripts.mdc` 1.9 → 1.10:** канон патерну переписано на `runStandardLint` (а не прямий `withLock`); додано явну заборону імпортувати `withLock` у `rules/<rule>/lint/lint.mjs`. У кожному з 5 lint.mjs у top-JSDoc додано посилання «Канон патерну `lint-*` — `.cursor/rules/scripts.mdc`».

## [1.13.86] - 2026-05-23

### Fixed

- **`worktreeFingerprint` повертав `null` при untracked-файлах з не-ASCII іменами:** `git ls-files --others --exclude-standard` без `-z` повертає такі шляхи у C-escape виді (`"docs/adr/20260523-...кирилиця..."` з `\321\201`-послідовностями), і наступний `git hash-object <escaped>` не знаходить файл — увесь fingerprint падав у `null`, через що дедуп ніколи не спрацьовував у репах з кирилицею в untracked-іменах. Перехід на `-z` + `\0`-розбиття дає сирий байтовий шлях.

## [1.13.85] - 2026-05-23

### Changed

- **`withLock` розгорнуто на всі важкі CLI-команди:** додано серіалізацію + дедуп у `lint-rego`, `lint-text`, `lint-k8s`, `lint-docker` за тим самим зразком, що `lint-ga` (приватна `runLint<Foo>Steps()` + публічна `runLint<Foo>Cli = () => withLock('lint-<rule>', …)`).
- **`fix`-лок переїхав у `runStandardRule`:** замість зовнішньої обгортки навколо `runFixCommand` у `bin/n-cursor.js`, `withLock('fix-<ruleId>')` тепер всередині `scripts/utils/run-standard-rule.mjs`. Кожен `rules/<id>/fix.mjs` отримує лок «безкоштовно» через делегацію; `npx @nitra/cursor fix`, прямий `bun rules/<id>/fix.mjs` і `run(ctx)`-композиція проходять через одну точку. Per-rule гранулярність — різні правила паралельно, однакові серіалізуються.
- **`runLintRego` тепер async** (наслідок обгортки), додано окремий export `runLintRegoSteps(cwd)` для тестів — щоб не дедупувати проти попереднього прогону, який лишив cached result у `node_modules/.cache/n-cursor/lint-rego/`.
- **`.cursor/rules/scripts.mdc` 1.8 → 1.9:** додано канонічну секцію «Серіалізація важких CLI-команд: `withLock`» з патерном інтеграції, таблицею ключів і red flags.

### Fixed

- Тест `withLock integration > serializes parallel calls` падав через дедуп (обидва виклики бачили однаковий fingerprint і другий пропускав). Тест явно вимикає дедуп через `getFingerprint: () => null` — окремо тестується серіалізація, окремо дедуп.
- Тест `runLintTextCli` після обгортки повертає Promise; `withIsolatedPath` тепер `await fn()`.
- JSDoc-тип `withLock` opts розширено `getFingerprint?` (вже використовувався у runtime, але був відсутній у сигнатурі — TS видавав error 2353).

## [1.13.84] - 2026-05-23

### Changed

- **CLI команда `check` перейменована на `fix`** (узгоджено з ім'ям файла `rules/<id>/fix.mjs`). `npx @nitra/cursor fix [<rule>...]` — новий канонічний формат. Команда `check` залишається як deprecated alias з warning'ом — буде видалена в наступній major-версії.
- **CLI стає spawn-wrapper:** замість inline dynamic import у `runChecks`, `fix [<rule>...]` тепер просто послідовно спавнить `bun rules/<id>/fix.mjs` per rule (один шлях у коді — `fix.mjs` як єдина авторитативна точка входу). Discovery з `.cursor/rules/*.mdc` без аргументів зберігається.
- **`rules/<id>/fix.mjs` отримує standalone-режим:** блок `if (import.meta.main)` тепер делегує новій утиліті `runRuleCli`, яка читає `.n-cursor.json` (через light reader), перевіряє whitelist + друкує per-rule summary. `bun rules/<id>/fix.mjs` тепер повний еквівалент `npx @nitra/cursor fix <id>`.
- **Документація переписана:** всі `npx @nitra/cursor check <rule>` у `.mdc`, `.cursor/rules/`, `README.md`, skills, JSDoc pass-повідомленнях оновлено на `fix`. Один формат у документації; CLI alias `check` лишається тільки для backward compatibility.

### Added

- **`scripts/utils/run-rule-cli.mjs`** — standalone runner з config-loading + summary; використовується `fix.mjs::main` блоком.
- **`scripts/utils/read-n-cursor-config-lite.mjs`** — мінімальний read-only `.n-cursor.json` reader (без auto-detection / sync — це окрема справа CLI). API: `readNCursorConfigLite()`, `isRuleEnabled(config, ruleId)`. Open-by-default: якщо файл відсутній — правило вважається активним (для debug).

## [1.13.83] - 2026-05-23

### Changed

- **Per-rule `fix.mjs` entry-point + rename `fix/` → `js/`:** кожне з 30 правил тепер має `rules/<id>/fix.mjs` — 11-рядковий wrapper над новим `runStandardRule`. CLI більше не робить convention-based discovery на верхньому рівні — перебирає правила через `listRuleIds` і викликає `await import(rules/<id>/fix.mjs).run({ walkCache })`. Каталог `fix/<concern>/` перейменовано на `js/<concern>/` для усунення колізії з кореневим `fix.mjs` та узгодження з `policy/` (за технологією, не функцією).
- **Локальна логіка в `fix.mjs` заборонена** — розширення поведінки правил тільки через опції в `RuleContext` (зараз: `walkCache`; зарезервовано на майбутнє: `skipMdcRefs`, `skipApplies`, `onlyConcerns`). Простір варіацій повністю описано в `RuleContext` JSDoc; convention-drift виключений на рівні дизайну.
- **Shared `walkCache`** як module-level singleton у `scripts/utils/walk-cache.mjs` (`getOrCreateWalkCache` + `resetWalkCache` для тестів). CLI створює один cache на прогон і прокидає через ctx до всіх concerns.
- **Нові utils:** `scripts/utils/run-standard-rule.mjs`, `scripts/utils/list-rule-ids.mjs`, `scripts/utils/walk-cache.mjs`. Експорт `discoverOneRule(ruleDir, ruleId)` з `discover-checkable-rules.mjs` (виокремлено з існуючого `discoverCheckableRules` — DRY).
- **Нові тести:** `tests/fix-mjs-contract.test.mjs` (91 кейс — smoke на всі 30 правил), `tests/run-standard-rule.test.mjs`, `tests/list-rule-ids.test.mjs`, `tests/walk-cache.test.mjs`, `tests/discover-one-rule.test.mjs`. Існуючі тести оновлено в частині import-шляхів `/fix/<concern>` → `/js/<concern>` (логіка не змінювалась); видалено застарілий `discoverCheckableRules > legacy js/-структура ігнорується` — `js/` тепер canonical convention.

### Breaking

- **Для зовнішніх інтеграторів, що пишуть власні правила:** каталог `rules/<id>/fix/<concern>/check.mjs` перейменовано на `rules/<id>/js/<concern>/check.mjs`; додатково потрібен файл `rules/<id>/fix.mjs` з канонічним вмістом (див. будь-яке вбудоване правило для шаблону). CLI більше не запустить правило без `fix.mjs`.

### Notes

- Зворотна сумісність CLI: `npx @nitra/cursor fix` та `npx @nitra/cursor fix abie` працюють як раніше.
- Use-cases: `bun npm/rules/abie/fix.mjs` (debug); `bun npm/rules/${{ matrix.rule }}/fix.mjs` (CI per-rule jobs); IDE Run-button на `fix.mjs`.

## [1.13.82] - 2026-05-23

### Changed

- **`rules/test`: виняток для `*_test.rego` файлів — лишаються поряд із полісі (OPA/Conftest community-конвенція)**:
  - **Rego unit-тести (`*_test.rego`) лежать у тому самому каталозі, що й `<name>.rego`** — за загальноприйнятим патерном OPA/Conftest. `package <name>` (полісі) ↔ `package <name>_test` (тест) семантично зв'язані через `package`-декларації, а не локацію файлу; `conftest verify -p <dir>` рекурсивний, тож знаходить тест незалежно від місця, але спільнота тримає їх поруч (бачимо у OPA examples, Gatekeeper library, Datree, Styra DAS bundles). Це **легітимне відхилення** від внутрішньої JS-конвенції «`tests/` всюди» на користь OPA-ідіоми.
  - `rules/test/test.mdc` v1.1 — додано **окрему секцію про виняток** для Rego: «`*_test.rego` лишаються поряд із полісі, бо це загальноприйнятий OPA/Conftest community-патерн» (з прикладом структури `policy/<concern>/{<name>.rego, <name>_test.rego, target.json}`).
  - `rules/test/fix/location/check.mjs` — перевіряє **лише `*.test.mjs`**, `*_test.rego` свідомо виключено з область перевірки (зафіксовано у docstring).
  - Додано test-case у `rules/test/fix/location/tests/check.test.mjs`: `*_test.rego` поряд із полісі НЕ є порушенням.
- **Відкат переміщення `*_test.rego`**: 69 файлів, які раніше було помилково перенесено у `policy/<concern>/tests/<name>_test.rego`, повернуто у `policy/<concern>/<name>_test.rego` через `git mv`. Порожні `tests/` піддиректорії під `policy/` видалено.
- **`npx @nitra/cursor fix test`** охоплює лише JS-тести: «✅ Всі 77 файлів \*.test.mjs у каталозі tests/». Rego-тести продовжують перевірятись через `conftest verify` у правилі `rego`.

## [1.13.81] - 2026-05-23

### Fixed

- **`npm-module.package_structure`: carve-out для rule-name сегмента** у `classifyPublishedFileAsTest`. Раніше для шляху `rules/<X>/...` сегмент `<X>` піддавався TEST_DIR_NAMES-перевірці, що давало false positive на правилах із id, що збігається з test-style ім'ям (`test`, `tests`, `fixtures` тощо). Тепер сегмент індекс 1 (ім'я правила, коли індекс 0 — `rules`) пропускається; глибші сегменти (`rules/<r>/fix/<c>/tests/`) продовжують перевірятись.

### Added

- **Нове правило `test` (`npm/rules/test/`)** — програмний канон розміщення тестів (ADR `docs/adr/20260523-154806-...`):
  - `test.mdc` — конвенція «`*.test.mjs` живуть у `tests/` поряд із джерелом», з описом спецвипадків (root `tests/`, fixtures у `tests/__fixtures__/` і `tests/fixtures/`, test-helpers як shared-infra).
  - `fix/location/check.mjs` — обхід дерева `walkDir`'ом (зі стандартним skip-листом + `.n-cursor.json:ignore`); для кожного `*.test.mjs` басенейм батьківської директорії має бути `tests`, інакше fail з вказівкою куди перенести.
  - `fix/location/tests/check.test.mjs` — 6 тестів самого правила (eats own dogfood).
  - `auto.md` — auto-enable умова: «якщо у проекті є хоча б один файл `*.test.mjs`».
  - Додано `"test"` у `.n-cursor.json:rules` репо `@nitra/cursor`.
  - Додано `"ignore": [".claude/worktrees"]` у `.n-cursor.json` — щоб правило не звітувало про знімки в git worktrees.

### Changed

- **Тести переміщено з-поряд-із-файлом у `dir/tests/` піддиректорію** (ADR `docs/adr/20260523-154806-...`):
  - **73 sibling-тести** у `rules/...` і `scripts/...`: для кожного `dir/X.test.mjs` → `dir/tests/X.test.mjs` із автоматичним оновленням relative imports.
  - **3 integration-тести у `npm/tests/`** — без змін (вже відповідали конвенції).
  - **`npm/scripts/utils/__fixtures__/`** → `npm/scripts/utils/tests/__fixtures__/`.
  - **`npm/rules/nginx-default-tpl/fix/template/fixtures/`** → `.../tests/fixtures/`; посилання в `npm/tests/check-rule-fixtures.test.mjs` оновлено.
  - Ручні фіксапи 4 тестів із HERE/`..` path patterns (sync-setup-bun-deps-action, inline-template-links, rules/adr/fix/hooks, rules/abie/utils/enabled) — додано додатковий `..`, бо тести стали на рівень глибше.
  - `package.json#files` негативні globs (`!**/*.test.mjs`, `!**/__fixtures__/**`, `!**/fixtures/**`) працюють рекурсивно — без змін.
  - **77 тестів** проходять у новому layout (76 існуючих + 1 нового правила): `bun test` 843 pass / 2 fail (обидва — pre-existing `with-lock` issues, не пов'язані).
  - `npx @nitra/cursor fix test` → `✅ Всі 77 файлів *.test.mjs у каталозі tests/ (test.mdc)`.

## [1.13.79] - 2026-05-23

### Changed

- **Перенесення single-rule сканерів і canonical-конфігів з `npm/scripts/utils/` у `npm/rules/<rule>/fix/<sub>/`** (узгоджено з конвенцією `rules/ga/fix/workflows/`, `rules/nginx-default-tpl/fix/template/` тощо; ADR `docs/adr/20260523-114913-...`, який supersede `20260523-112217-...`):
  - **js-lint** (`rules/js-lint/fix/tooling/`): `knip-canonical.json`, `oxlint-canonical.json`, `oxlint-canonical-skeleton.json`, `oxlint-rules.tsv`, `rebuild-oxlint-canonical.mjs`. Константи `OXLINT_CANONICAL_JSON_PATH` / `KNIP_CANONICAL_JSON_PATH` у `check.mjs` стали локальними (без 4-річневих `..`).
  - **js-run** (`rules/js-run/fix/runtime/`): `bunyan-imports.mjs` (+test), `check-env-scan.mjs`, `conn-file-rules.mjs` (+test), `conn-imports-scan.mjs` (+test), `promise-settimeout-scan.mjs` (+test).
  - **docker** (`rules/docker/fix/lint/`): `docker-hadolint.mjs` (+test), `docker-mirror.mjs`. `rules/docker/lint/lint.mjs` тепер імпортує з `../fix/lint/docker-hadolint.mjs`.
  - **js-bun-db** (`rules/js-bun-db/fix/safety/`): `bun-sql-scan.mjs`.
  - **js-mssql** (`rules/js-mssql/fix/deps/`): `mssql-pool-scan.mjs`.
  - **changelog** (`rules/changelog/fix/consistency/`): `package-manifest.mjs` (+test).
  - **vue** (`rules/vue/fix/packages/`): `vue-forbidden-imports.mjs` (+test).
  - **graphql** (`rules/graphql/fix/tooling/`): `graphql-gql-scan.mjs`. Cross-rule імпорту немає: `extractVueScriptBlocks`, локалізована `contentForGqlScan` і власні `isGqlScanSourceFile` / `shouldSkipFileForGqlScan` (з власною source-regex і skip-list `.d.ts` / `auto-imports.d.ts` / `components.d.ts`) дубльовані всередині `graphql-gql-scan.mjs` — правила залишаються самодостатніми.
  - **`scripts/auto-rules.mjs`** оновлено: імпорти переадресовано на нові локації трьох сканерів (`bun-sql-scan`, `graphql-gql-scan`, `vue-forbidden-imports`).
  - **`.mdc`-документація** оновлена: `rules/js-lint/js-lint.mdc`, `rules/docker/docker.mdc`, `rules/vue/vue.mdc`, `.cursor/rules/n-js-lint.mdc`, `.cursor/rules/n-vue.mdc` — посилання на нові шляхи canonical-файлів і сканерів.

## [1.13.78] - 2026-05-23

### Changed

- **abie / k8s / hasura — актуалізація посилань на неіснуючий `check-abie.mjs`:** після реструктуризації `rules/abie/` на `fix/<concern>/check.mjs` (+ Rego-пакети у `policy/`) монолітного `check-abie.mjs` більше немає; застарілі посилання в активних `.mdc`/`.rego`/`.mjs` (поза історичним `CHANGELOG.md`) оновлено:
  - `npm/rules/abie/abie.mdc` — три згадки замінено: пер-документна перевірка HTTPRoute base hostnames → Rego `abie.http_route_base`; env-DNS-скан → `fix/env_dns/check.mjs`; cross-file/FS-логіку розбито за концернами (`hc_pairing/`, `ua_http_route/`, `ua_node_selector/`, `env_dns/`, `firebase_hosting/`) з поясненням, що `targetRef.name -hl` cross-check обчислюється з `hcp.metadata.name` у Rego.
  - `npm/rules/abie/policy/{http_route_base,base_deployment_preem,health_check_policy}/*.rego` — у шапках замінено `npm/scripts/check-abie.mjs` на актуальні джерела: cross-file gating через `policy/<pkg>/target.json` (glob), rule-level applies-гейт у `fix/applies/check.mjs`, FS-парність HCP↔Deployment у `fix/hc_pairing/check.mjs`. Прибрано згадки видалених JS-функцій (`validateAbieHcPolicy`, `deploymentDocumentHasAbieBasePreemNodeSelector`).
  - `npm/rules/k8s/k8s.mdc` — рядок про `targetRef -hl` для abie-проєктів вказує на Rego-пакет `abie.health_check_policy` + `abie.mdc` (замість `check-abie.mjs`).
  - `npm/rules/hasura/fix/internal_urls/check.mjs` — у JSDoc згадку `check-abie` замінено на нейтральне «abie-перевірки».

### Added

- **`with-lock`:** атомарний `mkdirSync`-лок + SHA-256 fingerprint-дедуп для важких команд; пілот — `lint-ga` автоматично серіалізує паралельні запуски та пропускає дублікати при незміненому робочому дереві (TTL 10 хв). Нові модулі: `scripts/utils/worktree-fingerprint.mjs`, `scripts/utils/with-lock.mjs`.

## [1.13.76] - 2026-05-22

### Added

- **`ga.workflow_common` — мінімальні версії marketplace actions у `uses:`:** `actions/checkout` >= major `v6` (`@v6` і `@v6.0.2` дозволені), `Infisical/secrets-action` >= `v1.0.16` (канон у `policy/workflow_common/template/uses-min-versions.snippet.json`; SHA-pin пропускається). `check-ga` передає template через `--data`. Bump `ga.mdc` `1.9` → `1.10`.

## [1.13.75] - 2026-05-22

### Removed

- **Скіли `abie-clean` та `abie-kustomize`** прибрано з пакета — abie-специфічні скіли перенесено до `@nitra/abie-docs` і перейменовано на `clean` / `kustomize` (запуск через `npx @nitra/abie-docs skill <id>`). Автоактивація цих скілів за правилом `abie` більше не діє. Зачеплено: [auto-skills.mjs](scripts/auto-skills.mjs), [auto-skills.test.mjs](scripts/auto-skills.test.mjs), `skills/abie-clean/`, `skills/abie-kustomize/`.
- **Скіл `efes-create-env`** прибрано з пакета — efes-специфічний скіл перенесено до `@nitra/efes-docs` і перейменовано на `create-env` (запуск через `npx @nitra/efes-docs skill create-env`). Автоактивація за правилом `efes` більше не діє. Зачеплено: [auto-skills.test.mjs](scripts/auto-skills.test.mjs), `skills/efes-create-env/`.

## [1.13.73] - 2026-05-21

### Fixed

- **Збір workspace-коренів** — `getMonorepoPackageRootDirs` / `getMonorepoProjectRootDirs` більше не трактують `package.json` у `node_modules/`, `.git/`, `.venv/`, `venv/` як воркспейси (glob ignore + `isIgnoredWorkspaceRoot`). Усуває хибні `check changelog` на транзитивних залежностях (наприклад `node-gyp/gyp`).

## [1.13.72] - 2026-05-21

### Changed

- **CLI скілів спрощено** — лише `npx @nitra/cursor skill list`, `skill <id> ["task"]` (промпт на stdout), `skill cursor <id> ["task"]`, `skill claude <id> ["task"]`. Прибрано `skill prompt`, bins `n-skills` / `n-claude`, підкоманду `claude` у `n-cursor`. Зачеплено: [skills-cli.mjs](scripts/skills-cli.mjs).

## [1.13.71] - 2026-05-21

### Added

- **Claude-first UX для скілів** — `npx @nitra/cursor claude taze "task"` і bin **`n-claude`** (замінено спрощеним `skill` у 1.13.72).

## [1.13.70] - 2026-05-21

### Added

- **CLI скілів без синку в проєкт** — `npx @nitra/cursor skill list|prompt|claude|cursor <id> "task"` і bin **`n-skills`** (`npx -p @nitra/cursor n-skills …`). Читає `skills/<id>/SKILL.md` з установленого пакета, збирає промпт із CWD (`package.json`, `tsconfig.json`, `.n-cursor.json`) і виводить на stdout або делегує в `claude -p` / `cursor-agent -p`. Id скілу — каталог у пакеті (`lint`, `fix`, …) або з префіксом `n-` (`n-lint` → `lint`). Зачеплено: [skills-cli.mjs](scripts/skills-cli.mjs), [n-skills.js](bin/n-skills.js), [n-cursor.js](bin/n-cursor.js).

## [1.13.69] - 2026-05-21

### Changed

- **CLI `check` без аргументів** більше не парсить `AGENTS.md` — список правил для прогону будується з **`*.mdc` у `.cursor/rules/`** (той самий дисковий індекс, що для `AGENTS.md` / `CLAUDE.md`): `n-bun.mdc` → `check bun`, ручні `conftest.mdc` тощо — за наявності programmatic check у пакеті. Явний `check bun ga` без змін. Зачеплено: [discover-check-rules-from-cursor.mjs](scripts/utils/discover-check-rules-from-cursor.mjs), [n-cursor.js](bin/n-cursor.js), [fix/SKILL.md](skills/fix/SKILL.md).

## [1.13.68] - 2026-05-21

### Changed

- ADR-хук **`normalize-decisions.sh`**: нормалізація тепер активніше повторно використовує наявні ADR замість створення нових файлів. У промпт додано принцип вибору операції — перш ніж `rewrite` (новий файл), агент звіряє тему драфта з clean-списком і рештою драфтів батча; якщо рішення по суті вже зафіксоване і драфт лише уточнює/доповнює/виправляє його — обирає `merge-into`. Правило `merge-into` тепер явно дозволяє `target` двох видів: clean-файл зі списку або `<slug>.md` `rewrite`-операції цього ж батча; суперечливе обмеження «не вигадуй target поза clean-списком» узгоджено з цим. Зачеплено: [normalize-decisions.sh](.claude-template/hooks/normalize-decisions.sh).

### Fixed

- ADR-хук **`normalize-decisions.sh`**: `merge-into` більше не падає в `skip … target missing`, коли драфт треба влити в clean-ADR, який створює `rewrite` того самого батча, або в наявний clean-ADR, на який LLM послався голим `<slug>.md` без timestamp-префікса. Операції тепер застосовуються двома впорядкованими групами (спершу `delete`/`rewrite`, потім `merge-into`), а `target` резолвиться за трьома кроками: точна назва → slug-мапа rewrite-ів цього батча → єдиний наявний clean-файл із суфіксом `-<slug>.md`. Цикл застосування переведено з pipe на читання з файлу — лічильники `applied`/`skipped` виживають і потрапляють у фінальний рядок логу `done (applied N, skipped M)`. Зачеплено: [normalize-decisions.sh](.claude-template/hooks/normalize-decisions.sh).

## [1.13.67] - 2026-05-21

### Changed

- Правило **`changelog`**: перевірка `changelog/consistency` більше не вимагає version-bump і запису в `CHANGELOG.md` за зміни синхронізованого з `@nitra/cursor` інструментарію. Інверсію шляхів розширено: до `docs/` / `doc/` додано префікси `.cursor/` (канонічні правила та скіли) і `.claude/` (ADR-хуки). Причина: синк tooling-пакета — це дзеркало `@nitra/cursor`, а не зміна логіки воркспейсу, тож раніше кожен `npx @nitra/cursor` тягнув за собою зайвий bump і секцію CHANGELOG, де описувалося лише оновлення інструментарію. Кореневі `AGENTS.md` / `CLAUDE.md` окремого запису в інверсії не потребують — їх покриває пропуск кореня монорепо (нижче). Джерело правил у самому репо `@nitra/cursor` лежить під `npm/`, тож на нього інверсія не поширюється — реальні зміни правил і далі вимагають bump. Зачеплено: [check.mjs](rules/changelog/fix/consistency/check.mjs) (`CHANGELOG_IGNORE_PATH_PREFIXES`), [changelog.mdc](rules/changelog/changelog.mdc) (секція «Інверсія», bump `2.5` → `2.6`).
- Правило **`changelog`**: корінь монорепо (воркспейс `.` за наявності підпакетів) більше не перевіряється на bump/CHANGELOG. Причина: кореневий `package.json` монорепо — це glue/конфіг/tooling (`private`, `workspaces`), власного продуктового CHANGELOG він не веде, а помітні зміни документують підпакети. Раніше будь-яка правка в корені (конфіги, синк правил, bump `@nitra/cursor` у `devDependencies`) хибно вимагала bump кореневої `version`. Одно-пакетні репозиторії (корінь = єдиний воркспейс) перевіряються як і раніше. Зачеплено: [check.mjs](rules/changelog/fix/consistency/check.mjs) (`isMonorepoRoot` у `check()`), [changelog.mdc](rules/changelog/changelog.mdc).

### Fixed

- Правило **`changelog`**: перевірка `changelog/consistency` коректно опрацьовує файли з не-ASCII іменами (кирилиця тощо). `git diff` / `git ls-files` без `-z` застосовують `core.quotePath` і повертають такі шляхи у C-quoted формі `"docs/\320\262..."` — рядок не збігався з префіксами інверсії, тож, наприклад, чернетка ADR з кириличною назвою під `docs/` хибно вважалася зміною, що потребує bump, і валила перевірку. Усі переліки шляхів тепер читаються через `-z` (`NUL`-розділення, без quoting). Зачеплено: [check.mjs](rules/changelog/fix/consistency/check.mjs) (`splitNulPaths`, `listChangedPathsAgainstBase`), [check.test.mjs](rules/changelog/fix/consistency/check.test.mjs) (тести quotePath, синку tooling і пропуску кореня монорепо).

## [1.13.66] - 2026-05-20

### Changed

- `adr`: `normalize-decisions.sh` тепер зберігає `YYYYMMDD-HHMMSS-`-префікс чернетки в імені clean-файлу — операція `rewrite` пише результат у `<timestamp>-<slug>.md` замість bare `<slug>.md`. Причина: під час нормалізації LLM генерує `slug` заново, тож раніше чернетка `20260518-092807-foo.md` ставала clean-файлом з абсолютно іншим іменем `bar.md` — назва «стрибала» цілком. Тепер timestamp-префікс лишається стабільним якорем: між draft і clean змінюється лише slug-частина, а `docs/adr/` сортується хронологічно (capture-час). Чернетки без `YYYYMMDD-HHMMSS-`-префікса лишаються на fallback bare `<slug>.md`. Колізії resolve'яться як і раніше — детермінований суфікс `-2`, `-3`, тепер на повному імені `<timestamp>-<slug>-N.md`. Зачеплено: [normalize-decisions.sh](.claude-template/hooks/normalize-decisions.sh) (нова `case`-гілка у rewrite-операції обчислює `DEST_SLUG` з timestamp-префіксом перед `resolve_unique_slug_path`), [adr.mdc](rules/adr/adr.mdc) (опис clean-формату, рядок таблиці `rewrite`, дерево каталогу `docs/adr/` й абзац про `slug`), [SKILL.md](skills/adr-normalize/SKILL.md) (опис rewrite-результату й дублів імен). Bump `adr.mdc` `2.0` → `2.1`.

## [1.13.65] - 2026-05-20

### Changed

- Скіл **`n-abie-clean`**: розділ перекладів — апострофи та спецсимволи в англійських рядках (`tr`); після очистки — обовʼязкова локальна перевірка `bun vite build` поряд із `check abie`.

## [1.13.64] - 2026-05-20

### Added

- **`sync-claude-config`**: при увімкненому правилі `adr` `npx @nitra/cursor` дописує в кореневий `.gitignore` канонічний фрагмент `rules/adr/fix/hooks/template/.gitignore.snippet` (`.claude/hooks/*.log`, `.normalize-state`, `.normalize.lock`) — логи ADR Stop-hook більше не потрапляють у git status.

### Changed

- Правило **`adr`**: посилання на канон `.gitignore.snippet` і згадка автоматичного дописування під час sync.
- **`.gitignore.snippet`**: додано базові рядки `node_modules/`, `dist/`, `*.secret` (як у кореневому `.gitignore` пакета).

## [1.13.63] - 2026-05-20

### Fixed

- **`check changelog`**: новий local-only воркспейс (маніфест відсутній на merge-base з `dev`/`main`, напр. `demo/` на `main`) більше не вимагає штучного bump — достатньо початкової `version` і запису в `CHANGELOG.md` (раніше `Vbase === ∅` помилково трактувалось як «version не підвищено»).
- **`check changelog`**: на гілці **`main`** база порівняння — **`origin/main`** (або `HEAD~1` без remote), не `dev`; коли `origin/main` збігається з `HEAD`, diff порожній (не fallback на `HEAD~1`); feature-гілки — `merge-base` з `dev`, інакше з `main` (репо без `dev`).

### Changed

- Правило **`changelog`** ([changelog.mdc](rules/changelog/changelog.mdc) `2.5`): блок **STOP** перенесено на початок (тригер шляхів, інверсія, три кроки до завершення відповіді) — щоб агент не пропускав bump після правок у `npm/skills/` тощо, коли чеклист губився внизу довгого alwaysApply-правила.
- **`.cursor/rules/scripts.mdc`**: секція «Завершення задачі після правок у пакетному workspace» — cross-STOP з **n-changelog** (останні кроки сесії перед відповіддю).
- **`hk.pkl`**: pre-commit крок **`npm-changelog`** (`glob: npm/**`, `bun ./npm/bin/n-cursor.js check changelog`) — програмний стоп-кран при commit, якщо агент забув bump.

## [1.13.62] - 2026-05-20

### Changed

- Скіл **`n-lint`** ([SKILL.md](skills/lint/SKILL.md)): перед правкою конфігів з винятками (`.jscpd.json` → `ignore`/`minLines`, `.cspell.json` → `words`/`ignorePaths`, `knip.json`, eslint/oxlint ignores, `eslint-disable` тощо) агент **зупиняється** і питає користувача через **`AskQuestion`** — рефакторинг (за замовчуванням), точковий виняток у конфігу (`ignore-once`), пропуск (`skip`) або детальніше пояснення (`explain`). Заборонено мовчки розширювати ignore/words лише щоб зеленіти лінт; без відповіді користувача — рефакторинг або червоний лінт з поясненням, без змін конфігу.

## [1.13.61] - 2026-05-20

### Fixed

- Скіл **`n-publish-telegram`** ([SKILL.md](skills/publish-telegram/SKILL.md)): усунено суперечність про хештеги. Шаблон і приклад ставили тег **першим рядком** поста й використовували **один** тег (`#dev`), але секція «Правила» вимагала «**2–4** хештеги **в кінці**» — агент не мав однозначного орієнтиру. Канон узгоджено за фактичною практикою: **рівно 1 хештег першим рядком поста**. Зачеплено два прозові рядки — вступ до переліку тегів («хештеги в кінці поста» → «один хештег першим рядком поста») і пункт «Правила» («Теги: 2–4 хештеги в кінці» → «Тег: рівно 1 хештег першим рядком поста»); шаблон і приклад не змінювалися — вони вже відповідали канону.

## [1.13.60] - 2026-05-20

### Fixed

- Генерація **`AGENTS.md`** і **`CLAUDE.md`** при `npx @nitra/cursor`: Mustache-секції більше не вставляють порожній рядок між кожним пунктом списку (MD012), а фінальний markdown згортає зайві `\n\n\n` на стиках секцій — не потрібен окремий `lint-text` лише заради зачистки згенерованих файлів. Зачеплено: [generated-markdown.mjs](scripts/utils/generated-markdown.mjs) (`expandMustacheSection` — trim inner + `join('\n')`, `collapseMultipleBlankLines`, `formatGeneratedMarkdownLines`), [n-cursor.js](bin/n-cursor.js) (імпорт утиліт замість inline-логіки), [generated-markdown.test.mjs](scripts/utils/generated-markdown.test.mjs).

## [1.13.59] - 2026-05-20

### Added

- Нове `alwaysApply`-правило **`feedback`** ([feedback.mdc](rules/feedback/feedback.mdc)) — ефемерний канал зворотного звʼязку до пакета `@nitra/cursor`. Виконуючи будь-який скіл пакета (`n-lint`, `n-fix`, `n-taze`, `n-adr-normalize`, `n-llm-patch`, `n-publish-telegram`, `mdc-check`), агент проходить крізь `.cursor/rules/`, `SKILL.md` і `npx @nitra/cursor fix` — і бачить «тертя»: неоднозначні інструкції, відсутні `check-*.mjs`, false positive, порушення без автофіксу, повторювані патерни. Правило вимагає наприкінці скілу, **після** основного резюме, додати у відповідь чату секцію `## 🔧 Покращення @nitra/cursor` з пунктами за схемою `target` (`rule`/`skill`/`check`) · `id` · `kind` (`ambiguous-doc`/`missing-check`/`false-positive`/`no-autofix`/`recurring-pattern`) · `evidence` · `suggestion`. Резюме **навмисно ефемерне** — живе лише у відповіді чату: правило забороняє запис файлів/чернеток, GitHub issue/PR і редагування самого пакета; розробник, читаючи відповідь, сам вирішує, чи переносити пункт у пакет. Якщо тертя не було — секція повністю пропускається. Правило чисто документаційне (як `ci4`), `check-*.mjs` не має, бо поведінка агента програмно не верифікується. Зачеплено: новий каталог [rules/feedback/](rules/feedback/) з `feedback.mdc` (`version: '1.0'`), додано `"feedback"` у `rules` кореневого `.n-cursor.json` — після синку правило копіюється як `.cursor/rules/n-feedback.mdc` і потрапляє в `AGENTS.md`.
- `check security`: новий concern **`security.sample_secret`** — placeholder фейкових credential-значень у прикладних файлах має бути `sample-secret`, а не bare `secret`. Причина: `sample-secret` містить підрядок `sample` із вшитого списку `DefaultFalsePositives` TruffleHog і відсіюється сканером гарантовано та незалежно від версії; bare `secret` наразі ігнорується лише тому, що випадково присутнє у словнику `fp_words.txt` — крихка поведінка, що залежить від версії інструмента. [check.mjs](rules/security/fix/sample_secret/check.mjs) обходить дерево, відбирає прикладні файли (basename із суфіксом `.example`/`.sample`/`.template`/`.dist` чи infix `.example.`/`.sample.`/`.template.`, а також усе всередині каталогів `fixtures`/`fixture`/`__fixtures__`) і порядково шукає `secret` у позиції значення — одразу після `=`, `:` або `=>` з опційними лапками; імена ключів (`client_secret`, `JWT_SECRET`) не чіпаються, бо матч прив'язаний до значення. Решта файлів не сканується — там `secret` майже завжди частина реального коду. Скан текстовий (regex, не AST/Rego): прикладні файли — різнорідні конфіги (`.env`, YAML, JSON, TOML, plain `.dist`) без єдиного AST, а відбір файлів потребує обходу дерева. Зачеплено: [check.mjs](rules/security/fix/sample_secret/check.mjs) і [check.test.mjs](rules/security/fix/sample_secret/check.test.mjs) (новий concern + 9 тестів), [security.mdc](rules/security/security.mdc) (нова секція «Placeholder для секретів — `sample-secret`» та секція «Перевірка»). Bump `security.mdc` `2.0` → `2.1`.

## [1.13.57] - 2026-05-19

### Changed

- `check js-bun-db`: новий **hard fail** на `sql.unsafe(template_literal_with_interpolation)` — будь-який виклик з template-літералом, що містить `${...}`-інтерполяцію, тепер падає **навіть з маркером** `// allow-unsafe`. Причина: шаблонна підстановка `${name}` у `sql.unsafe`-рядок не екранує identifier'ів (reserved words, спецсимволи, пробіли в імені) і не біндить значень; такий код виглядає звично через знайому tagged-template-форму, але насправді робить просту строкову конкатенацію без жодних гарантій. Канон — зібрати `text` окремо: identifiers через `@scaleleap/pg-format` `format('%I', name)`, values як позиційні `$N` + другий аргумент `sql.unsafe(text, [params])`. Раніше дозволений приклад `sql.unsafe(\\\`CREATE TABLE \\\${TABLE} (id int)\\\`)`з marker'ом тепер fail — переписати через`format('CREATE TABLE %I (id int)', TABLE)`. Не зачепило:`sql.unsafe('SELECT 1')`(статичний рядок),`sql.unsafe(\\\`SELECT 1\\\`)`(template без інтерполяції),`sql.unsafe(text, [params])`зі змінною`text`. Зачеплено: [bun-sql-scan.mjs](scripts/utils/bun-sql-scan.mjs) (новий експорт`findBunSqlUnsafeWithInterpolatedTemplateInText`, що флагає лише`obj.unsafe(TemplateLiteral)`з`expressions.length > 0`), [check.mjs](rules/js-bun-db/fix/safety/check.mjs) (новий лічильник`unsafeTemplateInterp`+ окреме повідомлення з порадою на`@scaleleap/pg-format`), [check.test.mjs](rules/js-bun-db/fix/safety/check.test.mjs) (попередній DDL-тест переписано на безпечний`format('%I', ...)`-варіант, додано **негативний** тест на template-interp + marker і **позитивний** тест на статичний template без інтерполяції), [js-bun-db.mdc](rules/js-bun-db/js-bun-db.mdc) (нова підсекція «sql.unsafe з template-літералом і ${...}-інтерполяцією — заборонено навіть з маркером» зі зразками поганого/гарного коду; основний приклад DDL у секції unsafe-allowlist переписано на`format`+ готовий`text`). Bump`js-bun-db.mdc` `1.10`→`1.11`.

## [1.13.56] - 2026-05-19

### Changed

- `check js-bun-db`: пакет **`pg`** більше не повністю заборонений — додано виключення для **PostgreSQL LISTEN/NOTIFY**, який Bun SQL поки не реалізує. Причина: dev-теми з notifications (черги нотифікацій, інвалідація кешу через `pg_notify`, бот-консьюмери на каналі) досі мають законну потребу у клієнті `pg`, а попереднє правило flat-out забороняло це навіть у файлах, що буквально нічого не роблять, окрім виклику `client.query` з рядком `LISTEN ...` плюс listener `client.on` на події `notification`. Тепер `dependencies.pg` дозволено, **якщо** AST-сканер знаходить у проєкті хоч один сигнал LISTEN/NOTIFY: метод `query` / `queryArray` / `queryStream` зі string- або template-літералом, що починається з `LISTEN`, `UNLISTEN` або `NOTIFY` (case-insensitive), або метод `on` із першим аргументом-рядком `notification`, або tagged template з тегом `sql` і першим quasi, що починається з тих самих ключових слів. Якщо жодного — `fail` з посиланням на нову секцію .mdc. Додатково — **per-file**: будь-який файл з `import 'pg'` (або `require('pg')`) повинен сам містити LISTEN/NOTIFY; звичайні `SELECT`/`INSERT`/`UPDATE` через `pg` лишаються забороненими (переписати на Bun SQL і лишити LISTEN/NOTIFY в окремому модулі). Заборона `pg-format` і `mysql2` не змінилася. Зачеплено: [bun-sql-scan.mjs](scripts/utils/bun-sql-scan.mjs) (нові експорти `textHasPgLibImport`, `findPgLibImportInText`, `findPgListenNotifyUsageInText` + AST-хелпери для розпізнавання pg-style LISTEN/NOTIFY-запитів і `notification`-listener'ів), [check.mjs](rules/js-bun-db/fix/safety/check.mjs) (нова функція `checkPgDependencyAndUsage`, що пробігає по всіх `package.json` і per-file pg-imports; перевірку `pg` повністю переведено з Rego в JS, бо Rego не бачить JS-коду), [package.json.deny.json](rules/js-bun-db/policy/package_json/template/package.json.deny.json) (прибрано `pg`, лишилися `pg-format`/`mysql2`), [package_json_test.rego](rules/js-bun-db/policy/package_json/package_json_test.rego) (`test_deny_pg` → `test_allow_pg_in_dependencies` + новий `test_deny_pg_format`), [check.test.mjs](rules/js-bun-db/fix/safety/check.test.mjs) (5 нових сценаріїв: успіх з LISTEN, успіх з notification-listener, помилка `pg` без LISTEN/NOTIFY, помилка змішаних файлів — один із LISTEN, інший зі звичайними запитами, успіх з `NOTIFY` як виправдання). `.mdc` отримало нову секцію «pg: виключення для LISTEN/NOTIFY» з прикладом окремого `pg-listen.ts`-модуля і явним переліком сигналів, які зважує сканер. Bump `js-bun-db.mdc` `1.9` → `1.10`.

## [1.13.55] - 2026-05-19

### Changed

- `check js-bun-db`: правило [js-bun-db.mdc](rules/js-bun-db/js-bun-db.mdc) **пом'якшено** для випадків, де Bun SQL принципово не може допомогти — **динамічних SQL identifiers** (назви schema/table/column/index/role/database) і whitelist-фрагментів типу `ASC`/`DESC`. Раніше для них рекомендувалось будувати рядок шаблонною підстановкою у `sql.unsafe`, але інтерполяція identifier'у в template literal не робить escape (reserved words, спецсимволи) — це слабкий захист. Тепер канон — окремий пакет **`@scaleleap/pg-format`** (scoped форк, не unscoped `pg-format`): виклик типу `format('SELECT * FROM %I', name)` повертає коректно екранований PostgreSQL identifier, далі рядок іде у `sql.unsafe(query, [bindParams])` з обов'язковим маркером `// allow-unsafe: <причина>`. Значення (user input, фільтри, INSERT/UPDATE) — **завжди** через Bun parameters (tagged template або `$N` + `sql.unsafe(text, values)`); `%L` для значень лишається забороненим, як і власні шими `format`/`pgFormat`/`quoteIdent` тощо. Unscoped `pg-format` лишається у [deny-списку](rules/js-bun-db/policy/package_json/template/package.json.deny.json) — виключення стосується **тільки** scoped `@scaleleap/pg-format`. Зачеплено: вступ секції «Заміна на Bun native SQL» (зафіксовано виключення), рядок таблиці ідіом для `%I` (тепер через `@scaleleap/pg-format`, не через `sql.unsafe` з шаблонним рядком), нова секція «Динамічна SQL-структура: @scaleleap/pg-format для identifiers» з прикладами (динамічний `ORDER BY` зі whitelist, multi-row `INSERT` через `VALUES %L`, dynamic `WHERE` через ручні `$N`) і коротка таблиця рішень. AST-сканер [bun-sql-scan.mjs](scripts/utils/bun-sql-scan.mjs) не зачеплений — він знаходить лише **визначення** функцій-шимів (`format` з `%L`/`%I`/`%s` у тілі), а імпорт `format` із `@scaleleap/pg-format` як зовнішня бібліотека не флагається. Bump `js-bun-db.mdc` `1.8` → `1.9`.

## [1.13.54] - 2026-05-19

### Changed

- `check k8s` / `lint-k8s`: правила під `npm/rules/k8s/` спрощено — за каноном `k8s.mdc` тримаємо лише `.yaml`, тож **rego-цілі** і **rego-вирази** очищено від `.yml`. Зачеплено: глоби `walkGlob` у `npm/rules/k8s/policy/{manifest,base_manifest,gateway,hpa_pdb}/target.json` — лише `**/*.yaml`; у [base_kustomization.rego](rules/k8s/policy/base_kustomization/base_kustomization.rego) `is_hpa_or_pdb_filename` більше не містить `hpa.yml` / `pdb.yml`; тест `test_deny_hpa_yml_in_subdir` → `test_deny_hpa_yaml_in_subdir`. **Safety-net** у [check.mjs](rules/k8s/fix/manifests/check.mjs) **збережено**: `findK8sYamlFiles` та `checkK8sYamlFile` все ще пропускають `.yml` далі, але одразу падають з повідомленням `розширення .yml — перейменуй на .yaml (див. k8s.mdc)` — щоб випадково створений `*.yml` під `k8s/` не залишився непоміченим (автоматичне перейменування — окрема ручна команда `npx @nitra/cursor rename-yaml-extensions`, яка з `check k8s` не викликається). Згадки про `.github/workflows/*.yml` у JSDoc лишилися (це чуже правило `ga.mdc`, де канон — `.yml`). Bump `k8s.mdc` `1.40` → `1.41`.

## [1.13.53] - 2026-05-19

### Changed

- `check k8s`: **NetworkPolicy переїхав з `components/` у `base/`**. Раніше канон вимагав `…/k8s/<pkg>/components/networkpolicy.yaml` (Kustomize Component, sibling до `base/`), а локальний `networkpolicy.yaml` у base був забороненим (file-existence error) — через що **dev-середовище** (рендер лише з base без overlay → без components) **не отримувало жодних мережевих обмежень** і pod'и були відкриті для будь-якого трафіку. Тепер NP лежить у `base/networkpolicy.yaml` поруч з workload-маніфестом і підключений через `base/kustomization.yaml` `resources:` — обмеження діють і на dev, і на всіх overlays через звичайний `resources: [- ../base]`. Канон `components/`: лише `hpa.yaml` + `pdb.yaml` (HPA/PDB лишаються env-залежними й підключаються тільки прод-overlays). У не-base overlays `networkpolicy.yaml` поруч з workload — опційний overlay-specific override. Зачеплено: [npm/rules/k8s/k8s.mdc](rules/k8s/k8s.mdc) (нова секція «NetworkPolicy у `base/`», оновлені приклади `components/kustomization.yaml` без NP і новий приклад `base/networkpolicy.yaml`), [npm/rules/k8s/fix/manifests/check.mjs](rules/k8s/fix/manifests/check.mjs) (видалено `failIfBaseLayerHasLocalNetworkPolicy` і `validateComponentsNetworkPolicyFile`; `validateNetworkPoliciesForK8sWorkloads` і `ensureNetworkPoliciesForWorkloadsInDir` тепер завжди шукають `networkpolicy.yaml` у `dir`, autofix додає його у `base/kustomization.yaml` `resources:`; `validateComponentsKustomizationManifest` більше не вимагає NP у resources), [npm/rules/k8s/policy/base_kustomization/base_kustomization.rego](rules/k8s/policy/base_kustomization/base_kustomization.rego) (deny прибирає `networkpolicy.yaml` зі списку заборонених у base resources — лишаються тільки HPA/PDB), [npm/rules/k8s/lint/lint.mjs](rules/k8s/lint/lint.mjs) (оновлено JSDoc про C-0260: NP тепер у base і kustomize-збірка нормалізує namespace природньо). Bump `k8s.mdc` `1.39` → `1.40`.

## [1.13.52] - 2026-05-19

### Added

- `check bun`: **зворотній інваріант** для `lint-<id>`-скриптів. Раніше `checkCursorRuleScripts` ([npm/rules/bun/fix/layout/check.mjs](rules/bun/fix/layout/check.mjs)) перевіряв лише пряму імплікацію — «правило в `.n-cursor.json:rules` → скрипт у `package.json`». Тепер також fail-имо, коли правило **відсутнє** в `rules` (або явно перенесене в **`disable-rules`**), але в кореневому `package.json` залишилися: (а) сам скрипт `lint-<id>`, або (б) виклик `bun run lint-<id>` у агрегованому `scripts.lint`. Причина: `n-cursor lint-<id>` запускається напряму й **ігнорує** `.n-cursor.json`, тож `bun run lint` падає на вимкненому правилі (як було з `disable-rules: ["k8s"]` у cursor-репо, де `lint-k8s` обходив template-сорці власного правила). Покриті скрипти і їхні правила-власники: `lint-docker` ← `docker`, `lint-k8s` ← `k8s`, `lint-image` ← `image-avif`/`image-compress` (multi-owner — скрипт лишається дозволеним, поки активний **хоч один** власник). Розпізнавання згадки `bun run lint-<id>` у chain'і — через токен-границі (regex `\\bbun run <script>\\b`), щоб не матчити префікси (`lint-k8s-foo` ≠ `lint-k8s`). Bump `bun.mdc` `1.8` → `1.9`.

## [1.13.51] - 2026-05-19

### Fixed

- `lint-k8s`: `kubescape scan -` (stdin), доданий у 1.13.49 і збережений у 1.13.50, **не працює в kubescape v4.x** — `-` трактується як шлях до файлу й сканер виходить з `no resources found to scan` (fatal), тож `bun run lint` падав на `lint-k8s` навіть на чистих маніфестах. Прапорця `--input`/`--stdin` у CLI також немає. Тепер `runKubescapeManifest` пише зібраний kustomize-маніфест у тимчасовий файл під `os.tmpdir()` (через `fs.mkdtempSync`) і запускає **`kubescape scan <tmp-file>`**; тимчасова директорія прибирається у `finally`. Bump `k8s.mdc` `1.38` → `1.39`.

## [1.13.50] - 2026-05-19

### Changed

- `lint-k8s`: kubescape тепер збирає kustomize-маніфест через **вшиту в kubectl підкоманду** — `kubectl kustomize <dir> | kubescape scan -` (замість окремого бінарника `kustomize build <dir>`, доданого в 1.13.49). Причина: на машинах без окремого `kustomize` lint-k8s падав з `kustomize не знайдено в PATH`, тоді як `kubectl` — штатний інструмент з вшитим Kustomize (рендеринг локальний, доступ до кластера не потрібен). PATH-залежність зведена з пари `kubectl+kustomize` до одного `kubectl`; крок `Install kustomize` у GHA-шаблоні `lint-k8s.yml` прибрано (на github-hosted runner'ах kubectl уже доступний). Bump `k8s.mdc` `1.37` → `1.38`.

## [1.13.49] - 2026-05-19

### Changed

- `lint-k8s`: kubescape тепер сканує **зібраний kustomize-маніфест** через stdin (`kustomize build <dir> | kubescape scan -`) для кожного dir-у з `kustomization.yaml` під `…/k8s` (Kustomize Components — `kind: Component` — пропускаються, вони не білдяться окремо). Це усуває false-positive **C-0260** (`Missing network policy`) у каноні з sibling `components/networkpolicy.yaml` без `metadata.namespace`: сирий dir-скан не виконував kustomize, бачив порожній namespace у NetworkPolicy проти непорожнього у Deployment з `base/`, через що `podSelector` не матчився. Якщо `kustomization.yaml` під коренем `…/k8s` немає — fallback на старий dir-скан. Нова PATH-залежність — `kustomize` (додано крок у GHA-шаблоні `lint-k8s.yml`). Bump `k8s.mdc` `1.36` → `1.37`.

## [1.13.48] - 2026-05-19

### Changed

- `k8s.network_policy`: канонічний egress NetworkPolicy більше **не дозволяє** `to.namespaceSelector: {}` без `ports:` (catch-all). У шаблоні `networkpolicy.snippet.yaml`, генераторі `buildNetworkPolicyYaml` і rego-policy `network_policy.rego` тепер in-cluster rule має явний список TCP-портів: `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`. Додатково: `fix k8s` під час прогону знаходить існуючі `networkpolicy.yaml` з legacy catch-all egress і **перезаписує** їх через `buildNetworkPolicyYaml` (повний rebuild за `metadata.name` + `app`-міткою). JS-валідатор `networkPolicyManifestViolations` не змінюється (порти enforce-ить rego). Bump `k8s.mdc` `1.35` → `1.36`. Спец: [docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md](../../docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md).

## [1.13.47] - 2026-05-19

### Fixed

- `js-bun-db`, `js-bun-redis` rules: додано markdown-посилання на `policy/package_json/template/package.json.deny.json` у канонічних `<id>.mdc` — `findMissingMdcRefs` (викликається з `run-rule.mjs`) падав, бо канонічні `.mdc` не містили `[package.json.deny.json](./policy/package_json/template/package.json.deny.json)`. Bump rule versions: `js-bun-db.mdc` `1.7` → `1.8`, `js-bun-redis.mdc` `1.1` → `1.2`.

## [1.13.46] - 2026-05-19

### Changed

- `image-avif` rule: двопрохідний rewrite у `check image-avif` — спочатку pre-scan `.vue`/`.html` на raster-посилання (`VUE_RASTER_IMPORT_RE` + `VUE_RASTER_STATIC_SRC_RE`), і лише якщо є хоча б одне — запускається `npx @nitra/minify-image --avif`, rewrite та cleanup AVIF-сиріт. Якщо raster-посилань нема — вихід `0` без жодного side-effect. Bump `image-avif.mdc` `1.3` → `1.4`.

## [1.13.45] - 2026-05-19

### Fixed

- `inlineTemplateLinks` tests: оновлено очікувані рядки для фікстури `__fixtures__/inline-template/fix/foo/template/snippet.json` (перейшла на форматований варіант `{ "key": "val" }` ще в 1.13.38) та для інтеграційного тесту `security.mdc` (snippet `package.json` тепер multi-line після lint-проходу). Без зміни рантайм-логіки.
- `check-ga` тестова фікстура `setupCanonicalGaProject`: додано крок `Install conftest` у `.github/workflows/lint-ga.yml`, без якого `ga.lint_ga` rego-полісі забороняє workflow і `check()` повертав 1.

## [1.13.44] - 2026-05-18

### Added

- `abie` rule: новий policy-концерн `abie.package_json_docs` — у кореневому `package.json` `devDependencies` має містити `@nitra/abie-docs` (presence-only, версію не фіксуємо). Реалізація: `npm/rules/abie/policy/package_json_docs/` (target.json + .rego + \_test.rego). Bump `abie.mdc` `1.20` → `1.21`.
- `efes` rule: перший policy-концерн `efes.package_json_docs` — у кореневому `package.json` `devDependencies` має містити `@nitra/efes-docs` (узгоджено з `graphql.mdc`, де схема береться з `node_modules/@nitra/efes-docs/schema/maya.graphql`). Реалізація: `npm/rules/efes/policy/package_json_docs/`. Bump `efes.mdc` `1.0` → `1.1`.

## [1.13.43] - 2026-05-18

### Removed

- `npm/CLAUDE.md` як path-scoped нагадування для роботи в `npm/` повністю прибрано — фінальне завершення міграції з `1.13.42` (де вже прибрали `syncNpmClaudeMd` + Rego-first STOP перенесли у `scripts.mdc`): видалено сам `npm/CLAUDE.md`, темплейт `npm/.claude-template/npm-CLAUDE.md`, останні згадки в `bin/n-cursor.js` (повідомлення про `npm/CLAUDE.md` після sync; JSDoc) і опис у `schemas/n-cursor.json` `claude-config`. Реліз-правила (PR-bump + CHANGELOG) і так живуть у `n-changelog.mdc`/`n-npm-module.mdc` (alwaysApply).

## [1.13.42] - 2026-05-18

### Added

- `efes` rule: новий (поки що порожній) пакет правил для проєктів **github.com/efes-cloud/\***. Автодетект у `auto-rules.mjs` через `EFES_REPOSITORY_URL_MARKER` (`https://github.com/efes-cloud/`) — аналогічно до `abie`. Додано `npm/rules/efes/efes.mdc` + `auto.md`, прописано порядок в `AUTO_RULE_ORDER` і покрито тестами в `auto-rules.test.mjs`.
- `efes-create-env` skill: повʼязано з правилом `efes` через `skills/efes-create-env/auto.md` (`[efes]`) — активується автоматично, коли репозиторій відповідає efes-маркеру. Тести в `auto-skills.test.mjs` фіксують позитивний і негативний випадки.

## [1.13.41] - 2026-05-18

### Fixed

- `k8s` rule: yannh-патерн для груп з крапками — у назві файлу схеми зберігається лише **перший сегмент** `group` до першої крапки (`networking.k8s.io` → `networking`, `rbac.authorization.k8s.io` → `rbac`, `flowcontrol.apiserver.k8s.io` → `flowcontrol`); попередній `<group-з-крапками-як-дефіси>` давав 404 для всіх ресурсів `*.k8s.io` (Ingress, NetworkPolicy, ClusterRole, StorageClass, FlowSchema, RuntimeClass тощо). Виправлено в `expectedSchemaUrlForTypedManifest` і `buildNetworkPolicyYaml` (`check-k8s.mjs`); опис патерну в `k8s.mdc` переписано з прикладами для усіх типових груп. Bump `k8s.mdc` `1.34` → `1.35`.

## [1.13.40] - 2026-05-18

### Fixed

- `lint-text` CLI: preflight на `shellcheck`, `patch` і `dotenv-linter` до ланцюжка cspell/shellcheck/dotenv. Канон `lint-text.yml.snippet.yml` — кроки `Install shellcheck` (apt) і `Install dotenv-linter` (curl); rego `text.lint_text`. Bump `text.mdc` `1.28` → `1.29`.

## [1.13.39] - 2026-05-18

### Fixed

- `lint-ga` CLI: preflight на `conftest` (поряд із `shellcheck`/`uv`) з install-hint; глобальний `catch` у `bin/n-cursor.js` більше не ковтає повідомлення `failConftestMissing()`. Канон `lint-ga.yml.snippet.yml` — крок `Install conftest` для CI; rego `ga.lint_ga` вимагає curl на release conftest.

## [1.13.38] - 2026-05-18

### Added

- `js-run` rule: у backend `package.json#scripts` заборонено `env $(cat …) bun` — заміна на `bun --env-file=…` (по файлу з `cat`); Rego `scriptsForbidden` `env-cat-bun`. Bump `js-run.mdc` `1.10` → `1.11`.

## [1.13.37] - 2026-05-18

### Added

- `js-run` rule: у backend `package.json#scripts` заборонено запуск через `node` — один runtime **Bun** у dev і prod; Rego `js_run.package_json` (`scriptsForbidden` у `package.json.deny.json`), frontend з `vite` у `devDependencies` пропускається. Bump `js-run.mdc` `1.9` → `1.10`.

### Changed

- `k8s` rule: канон **NetworkPolicy** egress для всіх workload-ів — kube-dns; **TCP 80/443** на `0.0.0.0/0`; інші порти лише in-cluster (`namespaceSelector: {}`, `*.svc`). Заборонено `egress: [{}]`. Оновлено `buildNetworkPolicyYaml`, rego `k8s.network_policy`, template. Bump `k8s.mdc` `1.33` → `1.34`.

## [1.13.36] - 2026-05-18

### Changed

- `k8s` rule: **NetworkPolicy** обов'язковий не лише для **Deployment**, а й для **StatefulSet**, **DaemonSet**, **Job**, **CronJob** (`workloadAppLabel`, multi-doc `networkpolicy.yaml`, autofix/validate для всіх шарів `k8s`). HPA/PDB лишаються прив'язаними до Deployment. Bump `k8s.mdc` `1.32` → `1.33`.

## [1.13.35] - 2026-05-18

### Added

- `k8s` rule: для кожного **Deployment** під `k8s` обов'язковий **NetworkPolicy** — у `components/networkpolicy.yaml` для base (разом із HPA/PDB) або `networkpolicy.yaml` поруч у не-base оверлеях. Rego-пакет `k8s.network_policy`, перевірка прив'язки за `metadata.name` / міткою `app` у JS. **`check k8s`** автоматично створює відсутній `networkpolicy.yaml` і додає його в `components/kustomization.yaml` (`resources`). Bump `k8s.mdc` `1.31` → `1.32`.

## [1.13.34] - 2026-05-18

### Changed

- `k8s` rule: винесено канонічний приклад `.kubescape-exceptions.json` з inline-fenced-блоку в `k8s.mdc` у `fix/kubescape_exceptions/template/.kubescape-exceptions.json.snippet.json`; `.mdc` тепер посилається на template markdown-лінком, `inlineTemplateLinks` підставить вміст у `.cursor/rules/n-k8s.mdc` під час sync. Dogfood новій клаузі `scripts.mdc` ("Принцип поширюється і на pure-doc канони"). Bump `k8s.mdc` `1.30` → `1.31`.

## [1.13.33] - 2026-05-18

### Fixed

- `style-lint`, `image-avif` rules: markdown-посилання на `policy/*/template/*` у канонічних `<id>.mdc` — `findMissingMdcRefs` (викликається з `run-rule.mjs`) падав, бо шаблони не були згадані в `npm/rules/<id>/<id>.mdc`. Bump: `style-lint.mdc` `1.3` → `1.4`, `image-avif.mdc` `1.2` → `1.3`.

## [1.13.32] - 2026-05-18

### Added

- `k8s` rule (`lint-k8s`): підтримка per-project винятків kubescape — якщо в корені проєкту є `.kubescape-exceptions.json`, `runKubescape` автоматично передає його через `--exceptions <file>`. Канонічний приклад — control **C-0012** (`Applications credentials in configuration files`) на ConfigMap з публічним JWT-конфігом (`HASURA_GRAPHQL_JWT_SECRET={"jwk_url": "https://…"}`): control тригериться лише на імʼя env, не на значення, тому точкове `postureExceptionPolicy` з `kind: ConfigMap` + `attributes.name` знімає false-positive без глобального вимкнення контролю. Bump `k8s.mdc` `1.29` → `1.30`. Документація — секція "Винятки kubescape" в `k8s.mdc`.

## [1.13.31] - 2026-05-18

### Changed

- `changelog` rule (`n-changelog.mdc` `2.3` → `2.4`): підтримка Python — `pyproject.toml` (`[project]` / Poetry) поряд із `package.json`; discovery воркспейсів через `getMonorepoProjectRootDirs`; PyPI-порівняння для registry-published Python-пакетів. `package-manifest.mjs` — уніфікований маніфест npm/python.

## [1.13.30] - 2026-05-18

### Changed

- `changelog` rule (`n-changelog.mdc` `2.2` → `2.3`): `alwaysApply: true` без `globs`; інверсія — не вимагати bump для `docs/`/`doc/` і шляхів з `.gitignore`. `check changelog`: інтеграційна база `dev` **або** `main` (перша наявна); на `dev`/`main` local-only пропускається; релевантні зміни фільтруються в git. Тести.

## [1.13.29] - 2026-05-18

### Changed

- `changelog` rule (`n-changelog.mdc` `2.1` → `2.2`): розширені `globs` (типові шляхи пакета + `*.rego` / `*.mdc`) — правило потрапляє в контекст агента при правках коду, не лише `package.json` / `CHANGELOG.md`; секція «Чеклист агента» для будь-якого репозиторію з правилом.
- `changelog/fix/consistency/check.mjs`: npm-published режим — якщо `version` збігається з реєстром, але в git є зміни workspace без bump (feature vs `dev` або незакомічене на `dev`) → fail. Регресійні тести.

## [1.13.28] - 2026-05-18

### Fixed

- `scripts/utils/template.mjs` (`stripJsonComments`): враховує контекст рядкових літералів. Раніше regex `\/\*[\s\S]*?\*\/` без розрізнення string-літералів агресивно вирізав блоки між `/*` і `*/`, які зустрічаються в glob-патернах JSON-значень (напр. `**/node_modules/**`, `**/k8s/**/*.yaml`), і канонічний `.cspell.json.snippet.json` чи `.oxfmtrc.json.snippet.json` після стрипу стягувався в один склеєний рядок замість 7-елементного масиву. Новий стриппер пропускає вміст `"..."` (з підтримкою backslash-escape) без змін і вирізає лише реальні JSONC-коментарі.

### Changed

- `hasura` rule (`hasura.svc_hl`): іменування Service узгоджено з `k8s.svc_hl_yaml` — headless (`spec.clusterIP: None`) має суфікс `-h-hl` (напр. `db-h` → `db-h-hl`), clusterIP у `svc.yaml` — `-h`. Target розширено на `hasura/k8s/base/svc.yaml` і `svc-hl.yaml`; додано `svc_hl_test.rego`. `hasura.mdc` і `fix/internal_urls` оновлено під headless DNS (`contract-h-hl`). Bump `hasura.mdc` `1.1` → `1.2`.

## [1.13.27] - 2026-05-18

### Fixed

- `text`, `js-lint`, `js-run` rules: додано markdown-посилання на template-файли у канонічні `<id>.mdc` — `findMissingMdcRefs` (викликається з `run-rule.mjs`) раніше падав, бо канонічні `.mdc` не містили `[name](./policy/<concern>/template/<file>)` для власних шаблонів. Bump rule versions: `text.mdc` `1.27` → `1.28`, `js-lint.mdc` `1.22` → `1.23`, `js-run.mdc` `1.8` → `1.9`.

## [1.13.26] - 2026-05-17

### Changed

- `security` rule: міграція з gitleaks на TruffleHog. Канонічний `lint-security` тепер `trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail`; allowlist переїхав із TOML-файлу `.gitleaks.toml` (`[extend].useDefault=true` + `[allowlist].paths`) у plain-text `.trufflehog-exclude` (regex-pattern на рядок). Bump `security.mdc` version `1.1` → `2.0`.

### Added

- `npm/rules/security/fix/trufflehog/check.mjs` + `template/.trufflehog-exclude.snippet.txt` — JS-частина правила перевіряє існування `.trufflehog-exclude` та subset канонічних patterns через `checkTextSubset` (Rego не пасує plain-text-формату).
- `npm/rules/security/policy/lint_security_yml/` — Rego policy `security.lint_security_yml` із template `lint-security.yml.snippet.yml`; перевіряє, що `.github/workflows/lint-security.yml` містить крок з `uses: trufflesecurity/trufflehog@main`. У `security.mdc` inline-YAML замінено на template-link для single-source-of-truth (патерн із `php`/`style-lint`/`js-lint`). Workflow обовʼязковий (`target.json: required=true` + `missingMessage`), у корені cursor створено `.github/workflows/lint-security.yml` за каноном.

### Removed

- `npm/rules/security/fix/gitleaks/` + `npm/rules/security/policy/gitleaks/` (концерн gitleaks повністю видалено разом з Rego policy `security.gitleaks`).
- Кореневий `.gitleaks.toml` (замінено на `.trufflehog-exclude`).

## [1.13.25] - 2026-05-17

### Added

- `js-lint` rule template/ міграція (Phase 15, фінал): 4 концерни — `jscpd` (snippet з minLines >=N semantic), `vscode_extensions` (snippet-array), `package_json` (partial — `type`+`scripts.lint-js` у template; engines + eslint-config semver ranges у rego), `lint_js_yml` (full-canon з required uses + per-line run substrings з template's eslint-job steps; --fix anti-patterns + checkout persist-credentials у rego).

### Closed

- Template/ migration scope (Phases 1-15): 19 з 39 template-eligible концернів мігровано у попередніх фазах + 17 нових у Phase 6-15 = усі 39 завершено (100%). Залишилися лише non-eligible (AST-walks, multi-kind YAML, cross-file gating) — за дизайном живуть у JS/rego inline.

## [1.13.24] - 2026-05-17

### Added

- `text` rule template/ міграція (Phase 14): 6 концернів — `cspell` (snippet + contains + deny з `@cspell/dict-` як forbidden substrings), `markdownlint` (3-level walker для `config.MD024.siblings_only`), `oxfmtrc` (scalar leafs + array subset-of; required_keys presence лишається в rego), `package_json` (top-level deny + deps/devDeps deny; `@nitra/cspell-dict` semver range у rego), `vscode_extensions` (snippet-array), `vscode_settings` (top-level leafs + per-language blocks).

## [1.13.23] - 2026-05-17

### Added

- `style-lint` rule template/ міграція (Phase 13): 4 policy концерни — `package_json` (contains + 2-level snippet для `stylelint.extends`; `@nitra/stylelint-config` presence лишається в rego), `vscode_extensions` (snippet-array), `vscode_settings` (top-level leaf walker для `css/less/scss.validate`), `lint_style_yml` (full-canon з substring-маркером з template's stylelint-job steps). `fix/tooling` (`.stylelintignore` partial) лишається JS-managed.

## [1.13.22] - 2026-05-17

### Added

- `image-avif.package_json` template/ міграція (Phase 12): typo-keys у `template/package.json.deny.json` (`@nitra/minify-image.disabled-avif` як приклад typo до `disable-avif`). Type-перевірки (inverse-patterns) лишилися в rego.

## [1.13.21] - 2026-05-17

### Added

- `js-run` rule template/ міграція (Phase 11): 3 концерни (інвентар недорахував `jsconfig`) — `configmap` (contains, OTEL_RESOURCE_ATTRIBUTES substrings), `package_json` (deny на bunyan/@nitra/bunyan у deps/devDeps), `jsconfig` (snippet з generic 2-level walker + top-level array як множина для `include`).
- Drift-тести у кожному `*_test.rego`.

## [1.13.20] - 2026-05-17

### Added

- `abie.clean_merged_ignore_branches` template/ міграція (Phase 10): action marker (`uses:` substring) + required `ignore_branches` tokens (`dev,ua`) тепер у `template/clean-merged-branch.yml.snippet.yml`. Rego читає expected step із template's `jobs.cleanup_old_branches.steps[0]`. Drift test покриває зміну required-branches.
- `abie.mdc` — inline `ignore_branches` фрагмент замінено на template-link.

## [1.13.19] - 2026-05-17

### Added

- `docker` rule template/ міграція (Phase 9): `docker.package_json` (snippet, scripts.lint-docker з trim_space, conditional на наявність) + `docker.lint_docker_yml` (full-canon — paths, required uses, run substrings з template's steps).
- `docker.mdc` — 2 inline-блоки замінено на template-links.

## [1.13.18] - 2026-05-17

### Added

- `js-bun-db.package_json` + `js-bun-redis.package_json` template/ міграція (Phase 8): `template/package.json.deny.json` (forbidden deps з причинами). Rego — простий deny-walker. 2 нових `*_test.rego` (8 тестів).

## [1.13.17] - 2026-05-17

### Added

- `php` rule template/ міграція (Phase 7): `php.package_json` (fragment, contains-walker для `lint-php`) + `php.lint_php_yml` (full-canon, substring-маркер `bun run lint-php` з template's php-job steps). 2 нових `*_test.rego` (8 тестів).
- `php.mdc` — 2 inline-блоки замінено на template-links.

## [1.13.16] - 2026-05-17

### Added

- `image-compress.package_json` template/ міграція (Phase 6): `template/package.json.{contains,deny}.json` + новий `package_json_test.rego` (10 тестів). Generic contains-walker для substring-перевірок lint-image + generic deny-walker для заборонених deps; інверс-патерни (`--avif` заборонений підрядок + аґреґатор `lint` має містити `bun run lint-image`) лишилися в rego.
- `image-compress.mdc` — inline `package.json` snippet замінено на template-links.

## [1.13.15] - 2026-05-17

### Added

- `npm-module` rule template/ міграція (Phase 5): усі 4 policy концерни — `emit_types_config` (fragment, 2-level walker), `root_package_json` (fragment, snippet-array `workspaces`), `npm_package_json` (partial — `files` whitelist у template, regex `types` + `devDependencies`-must-be-empty лишаються у rego), `npm_publish_yml` (full-canon workflow з per-concern field-by-field rego).
- 3 нові `*_test.rego` (раніше тестів не було для `emit_types_config`, `root_package_json`, `npm_publish_yml`) — кожен покриває canonical + 4-6 негативних + drift.

### Changed

- `emit_types_config.rego` — generic 2-level snippet walker (як `bun.bunfig` / `ga.vscode_settings`).
- `root_package_json.rego` — generic snippet-array subset-of walker (під `workspaces` і потенційні наступні масиви).
- `npm_package_json.rego` — `files` whitelist тепер subset-of через `data.template.snippet`; `types` regex + `devDependencies`-must-be-empty лишаються у rego як inverse-patterns.
- `npm_publish_yml.rego` — повний канон workflow у `template/npm-publish.yml.snippet.yml` (як ga workflow concerns), expected paths/branches/permissions/uses-marker читаються з `data.template.snippet.<path>`.
- `npm-module.mdc` — inline `npm-publish.yml` блок (35 рядків) замінено на template-link; додано окрему секцію «Канонічні конфіги» з лінками на `root_package_json`, `npm_package_json`, `emit_types_config` template-файли.
- `docs/adr/template-dir-concern-inventory.md` — усі 4 `npm-module.*` концерни позначено ✓; додано Phase 5 у прогрес; tally: 19/39 (49%).

## [1.13.14] - 2026-05-17

### Added

- `bun` rule template/ міграція (Phase 4): 2 концерни — `bunfig` (snippet-walker 2-level, `[install].linker = "hoisted"`) + `package_json` (partial — top-level deny-fields у template).
- `bunfig_test.rego` створено з нуля (раніше тестів не було) — 5 позитивних/негативних + drift.

### Changed

- `bun.bunfig.rego` — використовує той самий 2-level snippet-walker, що `ga.vscode_settings` (leaf-by-leaf + guard на non-object section).
- `bun.package_json.rego` — top-level deny-fields (`packageManager`, `dependencies`) тепер читаються з `data.template.deny`. Сентинельний value у `object.get(input, field, "__bun_missing__")` зберігає behavior «field present навіть якщо порожній обʼєкт». Логіка `@nitra/*`-only у devDependencies та lint-aggregator (cross-script) лишається у rego — це inverse-patterns, які не виносяться у template.
- `bun.mdc` — inline `bunfig.toml` snippet замінено на template-link; додано посилання на `package.json.deny.json` для документації заборонених top-level полів.
- `docs/adr/template-dir-concern-inventory.md` — `bun.*` концерни позначено ✓; додано Phase 4 у прогрес-секцію; tally: 15/39 (38%).

## [1.13.13] - 2026-05-17

### Added

- `text` rule: до ланцюжка `lint-text` додано крок `dotenv-linter` (`runDotenvLinter()` у `npm/rules/text/lint/run-dotenv-linter.mjs`). На знайдених `.env*` рекурсивно по проєкту виконується `dotenv-linter fix -r --no-backup --quiet . --exclude node_modules --exclude .envrc`, після чого симетричний `check` для фінальної перевірки. Якщо інструмент відсутній у `PATH` — друкуються підказки встановлення (`brew install dotenv-linter` для macOS).
- `text.mdc` (canonical + `.cursor/rules/n-text.mdc` mirror) описує новий крок і вимоги до `dotenv-linter` (тільки в `PATH`, **не** у `dependencies`/`devDependencies`).
- `.cspell.json` — додано слово `envrc` (направлення на direnv-файл, не key=value).
- Тест `npm/rules/text/lint/run-dotenv-linter.test.mjs` — порожнє дерево, авто-фікс `LowercaseKey`, ігнор `node_modules`/`.envrc`.

## [1.13.12] - 2026-05-17

### Added

- `ga` rule template/ міграція доповнена (Phase 3.5 — 4 full-canon workflow концерни, пропущені в 1.13.9): `clean_ga_workflows`, `clean_merged_branch`, `lint_ga`, `git_ai`. Кожен має повний YAML канон у `template/<workflow>.yml.snippet.yml`, rego читає expected-значення з `data.template.snippet.<path>` (path лишається у rego, literals — у template). Для кожного — `*_test.rego` із canonical/wrong/drift тестами.
- Wiring у `ga/fix/workflows/check.mjs`: `runAllGaRego` тепер `await loadTemplate(concernDir)` і передає `templateData` у `runConftestBatch` для кожного workflow концерну.

### Changed

- `ga.mdc` — 4 inline YAML-блоки повних workflow канонів замінено на markdown-посилання до `template/<workflow>.yml.snippet.yml`. Файл скоротився суттєво — канон тепер живе як data, а не як прозовий приклад.
- `template/clean-merged-branch.yml.snippet.yml`: `dry_run: false` (явний bool) замість `dry_run: no` — `yaml` npm (YAML 1.2) лишає `no` рядком, а Go-yaml у conftest нормалізує до `false`; пишемо канонізовану форму під runtime conftest-парсингу.
- `docs/adr/template-dir-concern-inventory.md` — додано 4 нові full-canon ga.\* концерни з ✓; оновлено summary (89 концернів, 43 з template — мігровано 13/43 = 30%).

### TODO

- `ga.workflow_common` — cross-workflow forbidden-patterns (concurrency, depcheck deny, shell line-continuation). Не fully full-canon — окремий випадок, мігрується пізніше.

## [1.13.11] - 2026-05-17

### Added

- `rego` rule template/ міграція (Phase 3): 3 концерни — `package_json` (snippet із збереженням `trim_space` tolerance), `vscode_extensions` (snippet-array), `vscode_settings` (snippet-object 2-level + окремий deny на non-object block).
- Drift-тести у кожному `*_test.rego`.

### Changed

- `rego.package_json.rego` — замість двох inline-deny (missing + wrong-value через `regex/trim_space`) тепер один snippet-walker через `data.template.snippet`.
- `rego.vscode_extensions.rego` — замість inline `"tsandall.opa"` тепер subset-of через `data.template.snippet.recommendations`.
- `rego.vscode_settings.rego` — 2-рівневий snippet-walker з гардом `is_object(inner)` для випадку, коли block існує, але не обʼєкт.
- `rego.mdc` — inline `package.json` snippet замінено на template-link; додано посилання на `.vscode/{extensions,settings}.json` template-файли. Виправлено застаріле `Цілі — npm/policy/` → `npm/rules/`.
- `docs/adr/template-dir-concern-inventory.md` — позначено 3 `rego.*` концерни як ✓; додано Phase 3 у прогрес-секцію.

## [1.13.10] - 2026-05-17

### Fixed

- `runLintRego` (`npm/rules/rego/lint/lint.mjs`) — `LINT_TARGETS` вказував на застарілий шлях `npm/policy` (не існує після Phase 1 реструктуризації), тож `bun run lint-rego` мовчки exit 0 без реальної перевірки. Тепер `LINT_TARGETS = ['npm/rules']` — `opa check --strict`, `regal lint`, `conftest verify` реально проходять по всіх 111 `.rego`-файлах. TDD-регресія у `lint.test.mjs` (broken-syntax + well-formed fixtures).

### Changed

- `.regal/config.yaml` — додано `idiomatic.directory-package-mismatch` і `imports.unresolved-reference` у `ignore` (інтенціональні конвенції проєкту: package = `<rule>.<concern>` у `<rule>/policy/<concern>/`; `data.template.*` ін'єктиться runtime через `--data`). `style.line-length.max-line-length: 220` — узгоджено з `opa fmt` (тримає малі обʼєкти single-line).
- `*_test.rego` з порушенням `test-outside-test-package` (4 файли: `js-lint.jscpd`, `js-lint.vscode_extensions`, `security.gitleaks`, `vue.package_json`) — перейменовано в `<package>_test` із явним `import data.<package>`.
- `opa fmt -w npm/rules` — auto-fix форматування.
- `docs/adr/template-dir-concern-inventory.md` — додано 4 `ga.*` концерни з відміткою `✓` (мігровано); оновлено summary-числа (85 концернів, 39 з template — 46%); додано секцію прогресу міграції.

## [1.13.9] - 2026-05-17

### Added

- `ga` rule template/ міграція (Phase 2): 4 концерни — `package_json` (contains-style), `vscode_extensions` (snippet-array), `vscode_settings` (snippet-object), `zizmor_yml` (snippet з канонічним path `rules.unpinned-uses.config.policies."*"`).
- Drift-тести (`test_data_template_drives_*`) у кожному `*_test.rego` ловлять регресію, якщо rego перестане читати з `data.template`.

### Changed

- `ga.package_json.rego` — замість двох inline-deny з `is_string` + `regex.match` тепер один generic contains-walker через `data.template.contains`.
- `ga.vscode_extensions.rego` — замість inline `"github.vscode-github-actions"` тепер subset-of через `data.template.snippet.recommendations`.
- `ga.vscode_settings.rego` — 2-рівневий snippet-walker через `data.template.snippet` (літеральні keys `[github-actions-workflow]`, `editor.defaultFormatter`).
- `ga.zizmor_yml.rego` — замість substring `json.marshal` хака тепер структурний чек `rules.unpinned-uses.config.policies."*"` із expected value з `data.template.snippet`.
- `ga.mdc` — inline `package.json` snippet і `zizmor.yml` snippet блоки замінено на markdown-посилання на template-файли; додано посилання на нові template/ для `.vscode/{extensions,settings}.json`.

## [1.13.8] - 2026-05-17

### Changed

- Перенесено частину per-document логіки з `fix` у Rego policy:
  - `js-lint`: `.jscpd.json` і `.vscode/extensions.json`;
  - `ga`: `package.json#scripts.lint-ga`, `.vscode/extensions.json`, `.vscode/settings.json`, `.github/zizmor.yml`;
  - `security`: `.gitleaks.toml` (`[extend].useDefault = true`);
  - `vue`: залежності Vue/Vite-пакетів і заборону `esbuild`.
- Відповідні JS check-и спрощено до FS/cross-file/AST/tooling частини без дублювання Rego-умов.
- `ensureNitraCursorInRootDevDependencies` тепер додає `@nitra/cursor` тільки в `package.json` поруч із запуском, якщо в ньому є `workspaces`.
- `vue.mdc` уточнює тестування через Bun Test Runner + Vue Test Utils/happy-dom замість Vitest/jsdom.

### Fixed

- `npm/package.json#devDependencies` — прибрано self-reference `@nitra/cursor`, щоб published package знову відповідав `npm-module` compact-package canon.

## [1.13.7] - 2026-05-17

### Fixed

- `inlineTemplateLinks`: `String.replace(needle, replacement)` інтерпретує `$'`, `$&` тощо у `replacement`. Через це інлайнінг `.gitleaks.toml.snippet.toml` (де є `$'''`) ламав вивід — хвіст `.mdc` реінжектився всередину блока. Перехід на function-replacer (`(_) => replacement`) усуває це. Додано регресійний тест із фікстурою `with-dollar.toml`.

## [1.13.6] - 2026-05-17

### Added

- `npm/scripts/utils/inline-template-links.mjs` — `inlineTemplateLinks(text, ruleDir)`: під час sync знаходить markdown-лінки виду `[label](./…/template/…)` у `.mdc` і замінює їх inline fenced-блоком з вмістом відповідного файла. Відсутній файл — hard error (fail loud).

### Changed

- `readBundledRuleContent` у `npm/bin/n-cursor.js` тепер пропускає текст правила через `inlineTemplateLinks` перед записом у `.cursor/rules/n-*.mdc`. Template-посилання у скопійованих правилах більше не зламані.

## [1.13.5] - 2026-05-17

### Added

- Оркестратор `run-rule.mjs` тепер викликає `findMissingMdcRefs` для кожного правила — fail, якщо файл у `template/` не згаданий як markdown-посилання у `<id>.mdc`. Поки що активно лише для `security` (єдине правило з `template/`); готова страховка для Phase 2+.

### Fixed

- `check-mdc-template-refs.test.mjs` тест 3 — фіксував дубль test 1; тепер використовує окрему `no-templates` фікстуру, що дійсно валідує "no template/ dirs → empty result".

## [1.13.4] - 2026-05-17

### Removed

- `npm/package.json#devDependencies` — повторно видалено self-reference `@nitra/cursor` (порушує canon `npm-module`: «devDependencies не публікуються користувачам пакета»). Автоматично повертався у попередніх тасках template-dir роботи; цей коміт остаточно прибирає.

## [1.13.3] - 2026-05-17

### Changed

- `security/security.mdc` — прибрано inline merge-фрагменти (package.json snippet для `lint-security`, .gitleaks.toml повний канон), замість них markdown-посилання на файли в `template/` (single source of truth). Зміст правила залишається (описи для чого потрібен gitleaks, GitHub Actions), видалено дублювання фіксованого коду.

## [1.13.2] - 2026-05-17

### Changed

- **`adr` hook output тепер MADR v4.0.0 minimal** — capture/normalize prompts генерують ADR-и з canonical headings `Context and Problem Statement`, `Considered Options`, `Decision Outcome`, `Consequences`, `More Information`. Prompts стали evidence-bound: якщо transcript не містить альтернатив або підтверджених наслідків, hook явно пише, що даних немає, замість вигадування деталей.

## [1.13.1] - 2026-05-17

### Added

- **`adr` rule: Cursor Agent Stop-hook support** — `npx @nitra/cursor` тепер merge-ить project-level `.cursor/hooks.json` і додає managed `hooks.stop` entries для `.claude/hooks/capture-decisions.sh` та `.claude/hooks/normalize-decisions.sh`. Hook-скрипти приймають Cursor payload (`transcript_path`, `conversation_id` / `generation_id`, `workspace_roots[]`) і використовують той самий ADR capture/normalize pipeline, що й Claude Code.

## [1.13.0] - 2026-05-17

### Changed

- `security/fix/gitleaks/check.mjs` читає канон з `template/`, не з inline regex.
- `security/policy/package_json/package_json.rego` читає очікувані значення з `data.template.*`, не з inline literals.
- Оркестратор `run-rule.mjs` для policy-концернів вантажить `template/` через `resolveConcernTemplateData` і передає у `runConftestBatch.templateData`.
- Снепет `.gitleaks.toml.snippet.toml` тримає канонічний title + allowlist paths (description лишається user-specific).
- **9 правил переведено з `alwaysApply: true` на `alwaysApply: false` + `globs:`** — AI-контекст у Cursor/Claude Code підвантажується лише при роботі з релевантними файлами; програмна валідація через `npx check <rule>` залишається повністю функціональною незалежно від AI-контексту. Економить контекстне вікно у сесіях, де редагують код, далекий від відповідних конфігів.
  - **`bun`** (`1.7 → 1.8`) — `globs: "**/package.json,**/bunfig.toml,**/bun.lock,**/bun.lockb"`
  - **`capacitor`** (`1.0 → 1.1`) — `globs: "**/capacitor.config.json,**/android/**,**/ios/**"`
  - **`js-bun-db`** (`1.6 → 1.7`) — `globs: "**/package.json,**/src/conn/**"`
  - **`js-bun-redis`** (`1.0 → 1.1`) — `globs: "**/package.json,**/src/conn/**"`
  - **`js-mssql`** (`1.3 → 1.4`) — `globs: "**/package.json,**/src/conn/mssql-*"`
  - **`npm-module`** (`1.12 → 1.13`) — `globs: "npm/**,**/package.json,**/hk.pkl,.github/workflows/npm-publish.yml,**/tsconfig*.json"`
  - **`tauri`** (`1.0 → 1.1`) — `globs: "**/src-tauri/**,**/tauri.conf.json"`
  - **`js-lint`** (`1.21 → 1.22`) — `globs: "**/{.oxlintrc.json,eslint.config.js,.jscpd.json,knip.json,package.json},**/*.{js,mjs,cjs,jsx,ts,tsx}"`
  - **`js-run`** (`1.7 → 1.8`) — `globs: "**/package.json,**/jsconfig.json,**/src/**/*.{js,mjs,cjs,ts,tsx}"`
- **Мотивація:** усі 9 правил мають повне покриття `npx @nitra/cursor fix <rule>` (JS-перевірка + Rego policy). Тримати їх `alwaysApply: true` без потреби палить контекст AI у сесіях, де редагується непов'язаний код. Помилка → check ловить → AI виправляє — той самий цикл, що для `security@1.12.1` і `changelog`/`image-compress`/`php`/`vue`.
- **Залишено `alwaysApply: true`** — `text` (cross-cutting cspell-словник, апостроф), `adr` (про процес capture/normalize hooks), `ci4` (0 програмних чекерів — без AI-контексту правило мертве), `abie` (має JS `applies`-гейт, у не-abie репо мовчить; файли розкидані).

## [1.12.1] - 2026-05-17

### Changed

- **`npm/rules/security/security.mdc`** — `alwaysApply: true` → `alwaysApply: false` + `globs: "**/.gitleaks.toml,**/package.json,**/.github/workflows/**/*.yml"`. AI-контекст правила тепер підвантажується лише при роботі з релевантними файлами (за зразком `changelog`/`image-compress`/`php`), а не на кожен турн. Програмна валідація через `npx @nitra/cursor fix security` залишається завжди увімкненою (через `auto.md = завжди`) і ловить помилки незалежно від AI-контексту. Версія frontmatter `1.0` → `1.1`.
- **Мотивація:** правило має повне покриття перевіркою (Rego + JS-check); тримати його `alwaysApply: true` не дає AI додаткової цінності понад те, що `check security` ловить програмно — лише марно займає контекстне вікно при роботі з кодом, не повʼязаним з конфігурацією security.

## [1.12.0] - 2026-05-16

### Added

- **Нове правило `security`** (увімкнене за замовчуванням, як `text`/`adr`) — секрет-сканер на базі [gitleaks](https://github.com/gitleaks/gitleaks). Вимагає:
  - `scripts.lint-security` у `package.json` з викликом `gitleaks detect` (або `gitleaks git`);
  - `bun run lint-security` всередині агрегованого `scripts.lint` (якщо `lint` є);
  - `.gitleaks.toml` у корені з `useDefault = true` у блоці `[extend]` (без перетирання вбудованих правил);
  - `gitleaks` **не** у `dependencies`/`devDependencies` (інструмент глобальний, як `shellcheck`/`conftest`).
- **`npm/rules/security/{security.mdc,auto.md,fix/gitleaks/check.mjs,policy/package_json/{package_json.rego,target.json,package_json_test.rego}}`** — повна структура правила за зразком `image-compress` (Rego per-document валідація + JS-частина для FS). 9 rego-тестів + 5 JS-тестів.
- **`npm/scripts/auto-rules.mjs`** — `'security'` додано в `AUTO_RULE_ORDER` (alphabetical, між `rego` і `style-lint`) і викликається `addRule('security')` без умови. `auto-rules.test.mjs` оновлено.

### Motivation

Команда вже виявляла секрети у public-репо вручну (gitleaks локально + GitHub Push Protection); правило виносить інструмент у канонічний `bun run lint`, щоб витоки ловилися ще до push. Default-on, бо «опт-ін на secret-scanning» — це anti-pattern: репо, що не вмикав security вручну, найімовірніше і є той, що зливає секрети.

## [1.11.17] - 2026-05-16

### Fixed

- **`npm/rules/js-run/fix/runtime/check-fixture.test.mjs`** — фікстури двох тестів («0, якщо `import { SQL } from 'bun'` у `src/conn/`» і «враховує `package.json#imports['#conn/*']`») приведено у відповідність до канону `js-run`: іменування файлу `pg.js` → `pg-write.js` (шаблон `pg-{read|write}[-<id>]`) та іменований експорт `db` → `pgWrite` (camelCase від basename). Раніше фікстури використовували старий формат і check.mjs справедливо повертав `1`, через що очікування `toBe(0)` падало. Решта тестів conn-канону (`mssql-write.js`/`mssqlWrite` happy-path, `mssqlWriter` negative-path) у тому ж файлі вже були канонічними — їх не торкаюся.

### Removed

- **`npm/package.json#devDependencies`** — повторно видалено `@nitra/cursor: ^1.11.16` self-reference, який повернувся в коміті `8ae6e9e auto adr` (автоматичний stop-hook fix). Той самий блок уже прибирали в `1.11.14` (див. запис нижче) — потрапив назад через автофікс. `npx @nitra/cursor fix npm-module` знову зелений.

## [1.11.16] - 2026-05-16

### Changed

- **`npm/rules/adr/adr.mdc`**, **`npm/scripts/auto-rules.mjs`**, **`npm/rules/adr/auto.md`** — правило `adr` тепер **увімкнене за замовчуванням** (`addRule('adr')` без умови, поруч з `addRule('text')`; `auto.md` = `завжди`). Раніше — opt-in вручну через `"adr"` у `rules`. Щоб вимкнути для конкретного репо — `"adr"` у `disable-rules`. Текст правила і JSDoc у `sync-claude-config.mjs` оновлено відповідно. Існуючі `.n-cursor.json` із явним `"adr"` у `rules` лишаються валідними (`mergeConfigWithAutoDetected` дедуплікує).
- **Мотивація:** ADR/Runbook/Knowledge capture виявився корисним для всіх проєктів команди, а не лише тих, де його свідомо ввімкнули; opt-out зручніший за opt-in, бо інтегрує hooks у новий репо з коробки.

## [1.11.15] - 2026-05-16

### Changed

- **`npm/.claude-template/hooks/capture-decisions.sh`** (+`.claude/hooks/capture-decisions.sh` синк) — Stop-hook тепер генерує **slug-name** для чернетки замість session-hash суфікса. Раніше: `<timestamp>-<session-id[0:8]>.md` (наприклад `20260516-090349-e513a1f0.md`). Тепер: `<timestamp>-<slug>.md` (наприклад `20260516-090349-структура-директорій-правила-fix-lint-policy.md`). **Slug береться з вже згенерованого LLM-заголовка** першого `## [ADR|Runbook|Knowledge] <heading>` блоку — без додаткового LLM-виклику, та сама вартість Stop-hook. Конвенція slug-у синхронізована з `normalize-decisions.sh:171`: малі літери, цифри, дефіс, кирилиця; англомовні технічні терміни лишаються англійською (`fix`, `lint`, `policy` — не транслітеруються). Колізії в межах однієї секунди — суфікс `-2`, `-3`, …, як у `normalize-decisions.sh:244-257`. Fallback на старий `<timestamp>-<session-id[0:8]>.md` якщо heading не спарсився (response без `## ADR|Runbook|Knowledge` префікса).
- **Мотивація:** після прогону `normalize-decisions.sh` нові чернетки створювалися з абстрактними session-hash іменами і знову вимагали LLM-`rewrite`-операцію щоб отримати читабельний slug. Тепер capture одразу пише читабельний slug → наступна нормалізація обмежується лише `delete`/`merge-into` для дублікатів (rename-операції стають рідкісними).

## [1.11.14] - 2026-05-16

### Removed

- **`npm/package.json#devDependencies`** — повністю видалено блок (містив лише self-reference `@nitra/cursor: ^1.11.9`). `npx @nitra/cursor fix npm-module` зафіксував порушення: `devDependencies` не публікуються користувачам пакета, але інструменти, що **потрібні** для розробки пакета, мають жити в кореневому `package.json` (у workspace-root) як `@nitra/cursor: workspace:*` (там уже є). Self-reference у `npm/package.json` лишався з попередньої практики, але **публікувався** у npm-tarball (хоч і ігнорувався установником, оскільки лізе у nested deps), забруднюючи метадані пакета.
- **`knip.json#workspaces.npm.ignoreDependencies: ["@nitra/cursor"]`** — workaround, доданий у 1.11.13 для приховання knip-violation на self-reference, тепер не потрібен (першопричина прибрана). Знято, щоб конфіг лишався чистим.

## [1.11.13] - 2026-05-16

### Fixed

- **`npm/rules/{bun,image-compress,js-bun-redis,js-run,php,style-lint,text}/fix/<concern>/check.mjs`** — escape `@nitra` як `\@nitra` у JSDoc-блоках (`/** … */`), де `npx @nitra/cursor fix` стояв всередині backticks. ESLint-плагін `jsdoc/escape-inline-tags` парсив `@nitra` як інлайн-тег (false-positive у backticks) і видавав 8 warnings. Виправлення — escape-символ `\` перед `@`, як уже зроблено в інших місцях коду (CHANGELOG 1.11.5 для `js-run`). Pass-повідомлення та `//`-коментарі поза JSDoc не зачіпало — там парсер не активний.
- **`npm/skills/fix/SKILL.md`** (+`.cursor/skills/n-fix/SKILL.md` синк) — заголовок секції перейменовано з **«Скоуп»** на **«Scope»**, бо cspell флагав «Скоуп» як unknown word. Англійський «Scope» зрозумілий і не вимагає розширення словника. Тіло секції без змін.

## [1.11.12] - 2026-05-15

### Removed

- **`npm/scripts/utils/discover-checkable-rules.mjs`**, **`npm/scripts/utils/run-rule.mjs`** — фаза 3 реструктуризації: dual-mode підтримка `js/` (legacy) прибрана. Після завершення масового переїзду у 1.11.10 (всі 26 правил у `rules/<id>/fix/`) інфраструктура `n-cursor fix` тепер сканує **тільки** `rules/<id>/fix/<concern>/check*.mjs`. Конкретно: (1) у `discoverCheckableRules` видалено `listJsConcerns(js/, 'js')`-виклик, утиліту `mergeJsConcerns` (fatal на дублікат `js/`+`fix/`) і поле `rootDir` у `JsConcern`-типі; (2) у `run-rule.mjs::resolveJsCheckPath` `concern.rootDir ?? 'js'` замінено на хардкод `'fix'`; (3) JSDoc на початку обох файлів і на `evaluateAppliesGate` оновлено з `js/applies/check.mjs` на `fix/applies/check.mjs`; (4) коментар на `discoverCheckScripts` у `npm/bin/n-cursor.js` оновлено — згадку legacy `js/check.mjs` прибрано. Жодне правило в `rules/` не торкається — лише сканер.
- **`npm/scripts/utils/discover-checkable-rules.test.mjs`**, **`npm/scripts/utils/run-rule.test.mjs`** — прибрано тести dual-mode: `правило з тільки JS-концерном у legacy js/`, `правило з різними концернами у js/ і fix/`, `дублікат концерну в js/ і fix/ — fatal`, `пропускає js/utils/ як концерн`, `концерн з rootDir="fix"`, `концерн без rootDir (legacy-тести) fallback до js/`, `applies-гейт у fix/applies/`. Додано: `legacy js/-структура ігнорується (concern у js/<name>/ не підхоплюється)` — гарантує, що випадковий залишок `js/`-дерева у правилі не виконається, та `правило з кількома JS-концернами в fix/ — всі присутні, відсортовані`. Тестовий хелпер `addJsConcern` / `writeConcernJs` — за замовчуванням пишуть у `fix/` без параметра rootDir.

## [1.11.11] - 2026-05-15

### Removed

- **`npm/scripts/lint-conftest.mjs`** — скрипт видалено повністю. Його єдина функція — ітерувати policy-концерни через `discoverCheckableRules` і запускати `runConftestBatch` на реальних файлах — **повністю дублювала** `npx @nitra/cursor fix` (CHANGELOG 1.11.5: «`bun.bunfig`, `text.cspell`, `npm_module.npm_publish_yml` тепер прогоняються через CLI `check <id>` без додаткового `bun run lint-conftest`»). Окремий канал залишався лише як IDE-fast-feedback, але через одне джерело правди (`target.json` поруч з `.rego`) другий entry-point не дає нічого нового. Кореневий `package.json` оновлено: скрипт `lint-conftest` прибрано, ланцюжок `lint` тепер `bun run lint-rego && bun run lint-js && …` (без `lint-conftest`).

### Changed

- **`npm/README.md`** — секція «Структура пакету» переписана під поточний layout (`rules/<id>/<id>.mdc` замість застарілих `mdc/`). Додано підсекцію **«Структура одного правила»** з принципом fix/lint/policy: технологія реалізації визначає директорію — JS для `npx @nitra/cursor fix` у `fix/<concern>/`, JS для `bun run lint-<id>` у `lint/`, rego для `npx @nitra/cursor fix` у `policy/<concern>/`. Решта `mdc/`-посилань у README також виправлені на `rules/`.
- **`.cursor/rules/conftest.mdc`** — крок 5 у workflow «нова перевірка» переписано: окремої реєстрації нового rego-пакета в TARGETS більше не потрібно (TARGETS видалено разом із `lint-conftest.mjs`); `discoverCheckableRules` автоматично підхоплює пакет за наявності `target.json` поруч з `.rego`.
- **`.cursor/rules/scripts.mdc`** — згадку `lint-conftest.mjs` прибрано зі списку «крос-правильної інфраструктури» у `npm/scripts/`.
- **`npm/rules/abie/abie.mdc`** (cross-reference) — `npx @nitra/cursor lint-conftest` → `npx @nitra/cursor fix abie`; `npm/policy/abie/` → `npm/rules/abie/policy/`; `check-abie.mjs` → `fix/<concern>/check.mjs`.
- **`npm/rules/**/fix/<concern>/check.mjs`** (10 файлів) та **`npm/rules/**/policy/<concern>/<name>.rego`** (7 файлів) — у коментарях і `pass()`-повідомленнях `bun run lint-conftest` замінено на `npx @nitra/cursor fix` (структурна валідація живить fix-канал; окремого `lint-conftest`-каналу більше немає). Для conditional rego-полісі без `target.json` (ті, що не auto-discoverable) текст коментарів переформульовано — замість «глобально у `lint-conftest` НЕ реєструється» тепер «без `target.json` поруч (не auto-discoverable через `n-cursor fix`)».

## [1.11.10] - 2026-05-15

### Changed

- **`npm/rules/<rule>/js/`** — фаза 2 реструктуризації: усі 26 правил перенесені з `rules/<id>/js/` у `rules/<id>/fix/` (JS-концерни `check*.mjs`) та `rules/<id>/lint/` (CLI-entry `lint.mjs` + helper-runner-и). Директорія `rules/<id>/js/` більше не існує ні в жодному правилі. Перелік переміщеного: 18 правил (Category A) — лише концерни у `fix/`; 7 правил (Category B) — концерни у `fix/` та lint-entry у `lint/`: `ga`, `docker`, `php`, `rego`, `k8s`, `text`, а також `abie` (6 концернів, без lint-entry). Policy-каталоги (`rules/<id>/policy/`) — не рухались. Відносні imports у всіх переміщених файлах залишились дійсними (глибина `js/` = глибина `fix/`/`lint/`). Виправлено крос-модульні imports: `rules/abie/utils/k8s-tree.mjs`, `rules/ga/lint/lint.mjs`, `rules/docker/fix/lint/discover.test.mjs`, `rules/nginx-default-tpl/fix/template/check.mjs` — усі 4 оновлено з `*/js/*` на правильні нові шляхи. Оновлено hardcoded imports у `tests/check-rule-fixtures.test.mjs`, `tests/integration-repo-checks.test.mjs`, `tests/check-empty-trees.test.mjs`.
- **`npm/bin/n-cursor.js`** — 5 static imports CLI lint-entry перенаправлено: `rules/rego/js/lint.mjs` → `rules/rego/lint/lint.mjs`, `rules/ga/js/lint.mjs` → `rules/ga/lint/lint.mjs`, `rules/docker/js/run.mjs` → `rules/docker/lint/lint.mjs`, `rules/k8s/js/run.mjs` → `rules/k8s/lint/lint.mjs`, `rules/text/js/lint.mjs` → `rules/text/lint/lint.mjs`.
- **`npm/rules/k8s/lint/run-roots.test.mjs`** — import `./run.mjs` → `./lint.mjs` (файл перейменовано в межах переїзду).

## [1.11.9] - 2026-05-15

### Changed

- **`npm/scripts/utils/discover-checkable-rules.mjs`**, **`npm/scripts/utils/run-rule.mjs`** — фаза 1 реструктуризації `rules/<id>/js/` → `rules/<id>/{fix,lint}/`: інфраструктура `n-cursor fix` тепер **dual-mode** — сканує JS-концерни одночасно у `rules/<id>/js/<concern>/` (legacy) і `rules/<id>/fix/<concern>/` (новий формат). Кожен знайдений концерн штампується полем `rootDir: 'js' | 'fix'`; `runRule` використовує його для побудови шляху імпорту через `resolveJsCheckPath`. Концерн з однаковим іменем у обох каталогах одного правила — fatal-помилка з підказкою «заверши міграцію цього концерну у fix/ і видали `js/<name>/`», щоб не лишалось напіввиконаних move-ів. `utils/` пропускається в обох коренях. Жодне правило ще не переїхало у фазі 1 — це лише підготовка інфраструктури; для зворотної сумісності `resolveJsCheckPath` має fallback `rootDir ?? 'js'`, тож тести, що збирають `jsConcerns` вручну без `rootDir`, продовжують працювати без змін. CLI-точки входу `n-cursor lint-X` (статичні `import` у `npm/bin/n-cursor.js:79-83`) переїдуть пізніше — у фазах 2/3 (move + оновлення imports).
- **`npm/scripts/utils/discover-checkable-rules.test.mjs`**, **`npm/scripts/utils/run-rule.test.mjs`** — додано покриття нового `fix/`-кореня: окремі тести на discovery концерну у `fix/`, mix `js/`+`fix/` різних концернів одного правила, fatal на дублікат, пропуск `fix/utils/`, runRule з `rootDir: 'fix'`, applies-гейт у `fix/applies/`, та fallback на `js/` для концернів без `rootDir` (зворотна сумісність із наявними тестовими фікстурами).

## [1.11.8] - 2026-05-15

### Changed

- **`npm/bin/n-cursor.js::syncSkills`** — файл `auto.md` зі скілу більше **не** копіюється у `.cursor/skills/n-<id>/`. `auto.md` — це службова мета для CLI-сторони (`scripts/auto-skills.mjs` читає його з пакета, щоб вирішити, чи автоматично активувати скіл у `.n-cursor.json`), у проєкті він зайвий і лише засмічує `.cursor/skills/`. Каталог-приймач після цієї зміни лишається без `auto.md` — тільки `SKILL.md` (і будь-які інші файли скілу, якщо зʼявляться). Раніше синхронізовані `auto.md` у `.cursor/skills/n-<id>/` CLI **не чіпає** — їх потрібно прибрати вручну (свідома вимога користувача, щоб синк не видаляв нічого без явної згоди). Заголовний коментар у `npm/bin/n-cursor.js` оновлено відповідно.

## [1.11.7] - 2026-05-15

### Changed

- **`npm/skills/fix/SKILL.md`** (+`.cursor/skills/n-fix/SKILL.md` синк) — `/n-fix` більше **не запускає** `bun run lint` і **не делегує** до `/n-lint`. Крок 6 (`bun run lint` з делегуванням, доданий у 1.11.6) повністю видалено; замість нього на початку SKILL.md додано секцію **«Scope»**, де явно зафіксовано: `/n-fix` опікується лише структурою проєкту (правила `.cursor/rules/` + `npx @nitra/cursor fix`), а лінт-порушення у самому коді (ESLint/oxlint/jscpd/cspell/knip/sonarjs/stylelint) — поза скоупом і виправляються винятково через `/n-lint`. Кроки 7→6 і 8→7 переномеровано; остаточний пункт 7 додатково нагадує, що лінт-помилки не входять у критерій успіху `/n-fix`. Мета — щоб агент, що виконує `/n-fix`, не плутав свою задачу з `/n-lint` і не запускав важкий `bun run lint` без потреби; те, що діагностує `/n-lint`, виправляється там же, а не дублюється тут.

### Fixed

- **`npm/tests/check-rule-fixtures.test.mjs`** — `nginxFixDir` оновлено з `rules/nginx-default-tpl/js/fixtures` на `rules/nginx-default-tpl/js/template/fixtures`. Після phase 2 concern-split фікстура `default.conf.template` переїхала всередину концерну `template/`, тест падав з `ENOENT no such file or directory`.

## [1.11.6] - 2026-05-15

### Changed

- **`npm/rules/npm-module/npm-module.mdc`** — переформульовано вимогу про тести й фікстури. Раніше правило вимагало тримати їх **поза** будь-яким шляхом з `"files"` (канонічно — у `npm/tests/`). Тепер тести/фікстури можуть лежати **поруч з кодом** усередині `"files"`-шляхів, але `"files"` обовʼязково має містити **негативні glob-патерни**, що виключають їх із tarball (`!**/*.test.*`, `!**/*.spec.*`, `!**/test-helpers.*`, `!**/fixtures/**`, `!**/__tests__/**`, опційно `!**/*_test.rego`). Це краще відповідає реальному layout пакета (co-located test-файли у `rules/<id>/js/<concern>/`) і прибирає роз'їзд правила з фактичним `npm/package.json`. Версію `.mdc` піднято до `1.12`.
- **`npm/rules/npm-module/js/package_structure/check.mjs::checkNoTestsInPublishedFiles`** — текст fail-повідомлення тепер однозначно радить додати негативний glob у `"files"`, без альтернативи «винеси за межі шляхів з "files"». Логіка перевірки (walk positive ∖ negative + класифікація test-style) не змінилась — пере-кваліфіковано лише підказку для агента й людини.
- **`npm/skills/fix/SKILL.md`** (+`.cursor/skills/n-fix/SKILL.md` синк), **`npm/rules/style-lint/style-lint.mdc`** — розмежовано ролі скілів: `/n-fix` відповідає за **структуру** проєкту (правила `.cursor/rules/` + `npx @nitra/cursor fix`), `/n-lint` — за **чистоту коду** (`bun run lint`). Крок 6 у `n-fix` (перебір `lint-js`/`lint-text`/`lint-style`) замінено на одиничний `bun run lint` з делегуванням до `/n-lint` — лінт-логіку (auto-fix, sonarjs-рефакторинг, заборона паралельних запусків ESLint) `n-fix` більше не дублює. У `style-lint.mdc` cross-reference «повний набір `lint-*` (навичка `n-fix`)» оновлено на «`bun run lint` (навичка `/n-lint`)».

## [1.11.5] - 2026-05-15

### Added

- **`npm/bin/n-cursor.js`** — підкоманди `lint-rego`, `lint-k8s`, `lint-docker`, `lint-text` (раніше був лише `lint-ga`). Споживчі `package.json` тепер можуть використовувати уніфіковану форму `n-cursor lint-X` замість прямих посилань на файли `bun ./npm/scripts/*.mjs`, які після phase 2 концерн-сплету переїхали у `npm/rules/<id>/js/`. `lint-text` — композитний: послідовно `cspell .` → `runShellcheckText()` → `bunx markdownlint-cli2 --fix "**/*.md" "**/*.mdc"` → `runV8rWithGlobs()`.
- **`npm/rules/text/js/lint.mjs`** — новий ентрі-модуль для канонічного `lint-text`.
- **`npm/scripts/utils/run-lint-step.mjs`** — спільний хелпер `runLintStep(title, cmd, args)` для CLI-обгорток `lint-<rule>` (раніше дублювалося у `rules/ga/js/lint.mjs` і новому `rules/text/js/lint.mjs` — jscpd-clone).

### Changed

- **`npm/rules/k8s/js/run.mjs`**, **`npm/rules/docker/js/run.mjs`** — `main()` перейменовано і експортовано як `runLintK8s` / `runLintDocker` для виклику з CLI-маршрутизатора. `isRunAsCli()`-гілка прямого запуску збережена для зворотної сумісності.
- **`npm/rules/rego/js/lint.mjs`** — авто-виклик `runLintRego()` тепер обгорнуто `if (isRunAsCli())`, інакше імпорт модуля з CLI запускав би лінт як side-effect.
- **`npm/rules/rego/policy/package_json/`** — канонічне значення `scripts.lint-rego` змінено на `"n-cursor lint-rego"` (раніше `"bun ./npm/scripts/lint-rego.mjs"`). Аналогічно `npm/rules/docker/policy/package_json/` — на `"n-cursor lint-docker"`.
- **`npm/rules/text/js/formatting/check.mjs`** — `checkLintTextScript()` тепер вимагає рівно `"n-cursor lint-text"` замість попередньої складної валідації багатоступеневого ланцюжка (`cspell` → `run-shellcheck-text.mjs` → `markdownlint-cli2` → `run-v8r.mjs`). Канонічна форма — одне посилання на CLI, а зміст ланцюжка живе у `npm/rules/text/js/lint.mjs`.
- **`npm/package.json#files`** — додано негативний glob `"!**/*_test.rego"` (раніше були лише `*.test.mjs`, `test-helpers.mjs`, `fixtures/**`). 33 rego-юніт-тестових файли (`<policy>_test.rego`) більше не потрапляють у tarball — їх виконує лише `conftest verify` у dev-репо.

## [1.11.4] - 2026-05-15

### Fixed

- **`npm/rules/nginx-default-tpl/js/template/check.mjs`** — `findDefaultConfTemplatePaths` пропускає тестові `fixtures/` за будь-яким сегментом шляху, не лише `tests/fixtures/`. Після concern-split (фази 1-4) fixtures лежать у `rules/<rule>/js/<concern>/fixtures/`, і старий патерн пропускав їх повз → check шукав Dockerfile поруч із тестовим шаблоном і фалс-фейлив.

## [1.11.3] - 2026-05-15

### Fixed

- **`npm/bin/n-cursor.js`** — `detectAutoSkills` тепер отримує **ефективний** список правил (опт-ін вручну з `.n-cursor.json:rules` ∪ auto-detected, мінус `disable-rules`), а не лише auto-detected. Без цього скіли із залежністю на правило, додане вручну (наприклад, `adr` без `auto.md`-умови), не активувалися — у репо з `"rules": ["adr", …]` скіл `adr-normalize` залишався відсутнім, попри `[adr]` у його `skills/adr-normalize/auto.md`. Тепер `adr-normalize`, `abie-clean`, `abie-kustomize`, `taze` авто-додаються коректно як при auto-detected, так і при manual-opt-in відповідних правил.

## [1.11.2] - 2026-05-15

### Fixed

- **`npm/scripts/auto-skills.mjs`** — джерело правди для автоактивації скілів тепер `skills/<skill>/auto.md`, а не hardcoded мапа в JS. Парсер розпізнає три формати: `завжди` (always-on), `[rule, rule, …]` (умова на правила), відсутній/нерозпізнаний файл (opt-in). Експортовані константи `AUTO_SKILL_ORDER` та `AUTO_SKILL_RULE_DEPENDENCIES` тепер похідні від сканування `npm/skills/` під час завантаження модуля (зберігаються для зворотної сумісності). Побічно виправлено пропуск `abie-clean` у hardcoded мапі попри `[abie]` у його `auto.md` — тепер скіл коректно автоактивується разом з правилом `abie`.

## [1.11.1] - 2026-05-15

### Fixed

- **`npm/bin/n-cursor.js`** — `runSync()` (entry для `npx @nitra/cursor` без аргументів) шукав
  `<packageRoot>/mdc` після того, як phase 1-4 перейменував каталог у `rules/`. Виправлено: тепер
  вказує на коректний шлях `<packageRoot>/rules` — більше не кидає «Не знайдено каталог правил пакету».

## [1.11.0] - 2026-05-15

### Added

- **Concern-based JS + per-policy `target.json`** — нова інфраструктура для CLI `check`:
  - `npm/rules/<id>/js/<concern>/check*.mjs` — JS-концерни замість одного плаского `js/check.mjs`. Дзеркалить `policy/<name>/`: один `<name>` = одна одиниця відповідальності (rego, JS, або hybrid).
  - `npm/rules/<id>/policy/<name>/target.json` — декларативний маніфест поруч із `<name>.rego` описує, які файли фідити в conftest (`{ "files": { "single": "..." | "walkGlob": [...] } }`). CLI читає сам і викликає `runConftestBatch` — JS не зобовʼязаний дублювати.
  - **Pure-rego правила** працюють без жодного `.mjs`: CLI знаходить полісі за `target.json` і прогонить їх через `runConftestBatch`.
  - **Applies-гейт**: `rules/<id>/js/applies/check.mjs` може експортувати `applies()`. Якщо повертає `false` — CLI пропускає правило цілком (включно з policy-концернами).
  - **JSON Schema** у `npm/schemas/target.json` для IDE-валідації `target.json`.
  - **picomatch@^4.0.4** — runtime dependency для `walkGlob`-резолверу.
- **Нові утиліти** в `npm/scripts/utils/`:
  - `discover-checkable-rules.mjs` — обхід `rules/`, повертає `{ id, jsConcerns, policyConcerns }[]`. Legacy-fallback: плаский `js/check.mjs` маппиться у концерн `legacy`, щоб не ламати ще не мігровані правила під час переходу.
  - `resolve-target-files.mjs` — резолвер `files.single` / `files.walkGlob` з спільним walk-кешем на check-прогон (повторні таргети з тим самим `ignorePaths` не роблять додаткового `walkDir`). Path-traversal у `single` блокується.
  - `run-rule.mjs` — оркестратор одного правила: applies-гейт → JS-концерни → policy-концерни. Exit-код агрегується OR-ом.

### Changed

- **`npm/bin/n-cursor.js`** — `discoverCheckScripts` тепер делегує у `discoverCheckableRules` і повертає `CheckableRule[]` замість `string[]`. `runChecks` запускає `runRule` для кожного id зі shared `walkCache` (один обхід дерева на унікальний `ignorePaths`-сигнатуру).
- **`npm/rules/rego/`** — пілот міграції на нову структуру:
  - `js/check.mjs` → `js/applies/check.mjs` з експортами `applies()` (gate за наявністю `*.rego` у дереві) і `check()` (короткий context-pass). Виклики `runConftestBatch` прибрано — їх тепер виконує CLI через `target.json`.
  - `policy/{package_json,vscode_extensions,vscode_settings}/target.json` додано (`single` + `required: true` + кастомні `missingMessage`).
- **`npm/package.json`** — додано `picomatch` у `dependencies`.

- **Правило `adr` — фаза 2 (Normalize).** Новий Stop-hook `.claude/hooks/normalize-decisions.sh` батчево нормалізує ADR-чернетки через LLM: коли кількість файлів з `session:` у frontmatter досягає `ADR_NORMALIZE_THRESHOLD` (default 30), бере до `ADR_NORMALIZE_BATCH` найстарших, отримує JSON-операції (`rewrite` / `delete` / `merge-into`) і застосовує їх до робочого дерева. **Жодних git-операцій** — розробник дивиться `git status`/`git diff` і вирішує сам. Recursion guard `ADR_NORMALIZE_RUNNING=1`, мінімальний інтервал між спробами `ADR_NORMALIZE_MIN_INTERVAL_HOURS=6`, lock-файл, skip при mid-rebase/mid-merge, `ADR_NORMALIZE_DRY=1` для dry-run. Slug-стиль — kebab-case українською; дата у фінальному ADR береться з `captured` чернетки.
- **Skill `adr-normalize`** (slash-команда `/n-adr-normalize`) — ручний запуск normalize поза порогом і поза Stop-hook (виставляє `ADR_NORMALIZE_THRESHOLD=0` і `ADR_NORMALIZE_MIN_INTERVAL_HOURS=0`, корисно для dry-run або разової чистки). Авто-додається при `adr` у `rules`.
- **`sync-claude-config`**: експортовано `ADR_NORMALIZE_HOOK_COMMAND_MARKER` і функцію `syncAdrNormalizeHookScript`; managed-група normalize додається до `hooks.Stop` поряд з capture-групою (`async: true`, `timeout: 600`) при `"adr"` у `rules`. Маркер `.claude/hooks/normalize-decisions.sh` додано в `MANAGED_HOOK_COMMAND_MARKERS`.
- **Rego-перевірка `adr.settings_json`** тепер вимагає Stop-hook групу і для capture, і для normalize; **`adr.settings_local_json`** забороняє дублі обох хуків.
- **Інкрементальна міграція правил на `target.json`** (декларативні маніфести поруч із кожним `<concern>.rego`):
  - **Single-file правила** (11): `bun`, `text`, `style-lint`, `php`, `docker`, `npm-module`, `js-lint`, `image-compress`, `capacitor`, `hasura`, `adr` — `target.json` з `single` для кожного канонічного конфіг-файлу. Сумарно 27 нових маніфестів. `bun.bunfig`, `text.cspell`, `npm_module.npm_publish_yml` тощо тепер прогоняються через CLI `check <id>` без додаткового `bun run lint-conftest`.
  - **Walk-glob правила** (6): `js-mssql`, `js-bun-db`, `js-bun-redis`, `js-run` (package_json + configmap), `vue`, `image-avif` — `walkGlob: "**/package.json"` або відповідний патерн.
  - **k8s.\* концерни** (8): `manifest`, `gateway`, `hpa_pdb`, `kustomization`, `svc_yaml`, `svc_hl_yaml`, `base_kustomization`, `base_manifest` — `walkGlob` по YAML під сегментом `k8s/`; `base_manifest` використовує негативний glob для виключення `kustomization.yaml`.
  - **abie концерни** (4): `clean_merged_ignore_branches` (single), `health_check_policy` (walkGlob `**/k8s/**/hc.yaml`), `http_route_base` (walkGlob `**/k8s/**/base/**/hr.yaml`), `base_deployment_preem` (walkGlob `**/k8s/**/base/**/*.{yaml,yml}` з виключенням `kustomization.yaml`).
- **`capture-decisions.sh` тепер пише чернетки напряму в `docs/adr/<timestamp>-<sid>.md`** (раніше — у `docs/adr/_inbox/`). Сам каталог `_inbox/` більше не створюється, але `normalize-decisions.sh` бачить його рекурсивно — старі чернетки з `_inbox/` поступово розчищаються нормалізацією. Можна також одноразово `git mv docs/adr/_inbox/*.md docs/adr/` і прибрати порожній каталог.
- **Правило `adr` (`npm/rules/adr/adr.mdc`)**: повне переписування під дві фази (capture + normalize). Видалено згадки `_inbox/`. Версія `version: '2.0'`.
- **`npm/rules/adr/js/check.mjs`**: перевірка обох hook-скриптів (canonicity), обох log-файлів у `.gitignore`.
- **`npm/scripts/lint-conftest.mjs`**: повне переписування. Замість hardcoded `TARGETS`-таблиці (~280 рядків з регексами та walker-преди­катами) скрипт викликає `discoverCheckableRules` і читає `target.json` для кожного policy-концерну. Файл-резолвер — спільний з CLI `check` (`resolveTargetFiles` + walk-кеш). Поведінка для користувача однакова (`stdio: 'inherit'` зберігається для рідного форматування conftest), але джерело правди тепер — `target.json` поруч із `.rego`. Скрипт став `async` (для `await readFile`/`discoverCheckableRules`).
- **`npm/rules/abie/`** — завершено concern-split:
  - `js/check.mjs` (1153 рядки) видалено, його логіка розпорошена по `js/{applies,firebase_hosting,hc_pairing,ua_node_selector,ua_http_route,env_dns}/check.mjs`.
  - Спільні стан і утиліти у `utils/{enabled,k8s-tree,overlay-paths,kustomization-patches,http-route,hc-yaml,env-dns,yaml}.mjs`. `k8s-tree.mjs` тримає module-level кеш `findK8sYamlFiles` + `collectDeploymentDirs` — повторні виклики з різних концернів не роблять нового обходу дерева.
  - Виклики `runConftestBatch` прибрано з JS — їх тепер виконує CLI через `target.json`.

### Fixed

- `npm/rules/adr/js/check.{mjs,test.mjs}`: виправлено `BUNDLED_HOOKS_DIR` (після phase 3 co-location шлях `'..'` указував у `npm/rules/adr/.claude-template/`, потрібно `'../../..'` — до `npm/.claude-template/`).
- **`scripts/utils/run-rule.mjs`**: kebab-id правила (`style-lint`, `image-compress`, `js-lint`, `npm-module`, `js-mssql`, `js-bun-db`, `js-bun-redis`, `js-run`, `image-avif`, `nginx-default-tpl`) тепер коректно мапиться у snake-namespace rego (`style_lint.<concern>` тощо). Раніше `namespace: <id>.<concern>` давав `style-lint.package_json`, що не збігалося з `package style_lint.package_json` у `.rego` → conftest повертав 0 violations попри реальні порушення.
- **`scripts/utils/resolve-target-files.mjs`**: виправлено інтерпретацію негативних glob-патернів. `picomatch(['pos', '!neg'])` за дефолтом трактує `!neg` як окремий позитивний матчер «не-neg» (OR-логіка), що матчило майже всі шляхи. Тепер позитивні/негативні розділяються вручну, негативи застосовуються через `!isExcluded`. Виправляє `k8s.base_manifest`-таргет, який мав виключати `kustomization.yaml`, але до фіксу матчив усе дерево.
- **`scripts/utils/discover-checkable-rules.mjs`**: коли правило має й плаский `js/check.mjs`, і concern-підкаталоги, CLI прогонить **тільки** концерни. Раніше додавалися обидва → дублюючий вивід для правил у стані часткової міграції.

## [1.9.23] - 2026-05-14

### Fixed

- `npm/package.json#files`: додано негативні glob-патерни `!**/*.test.mjs`, `!**/test-helpers.mjs`, `!**/fixtures/**`, щоб після переїзду тестів у `rules/<rule>/js/`, `scripts/`, `scripts/utils/` вони не потрапляли в опубліковану npm-tarball (вимагає правило `npm-module`).
- `npm/package.json#devDependencies`: додано `@nitra/cursor: ^1.9.22` (auto-fill від `ensure-nitra-cursor-dev-dependencies.mjs`).

## [1.9.22] - 2026-05-14

### Changed

- **Rule-centric структура пакета.** Кожне правило тепер живе в одній директорії `npm/rules/{rule}/` з усіма своїми артефактами: `{rule}.mdc`, `auto.md` (умова автоактивації), `policy/` (rego-поліси), `js/` (check.mjs + опційні run/lint + co-located \*.test.mjs + fixtures/). Видалив каталог правила — правило зникло без слідів у `bin/auto-rules.md`, `npm/policy/`, `npm/scripts/`. Дзеркальна структура для скілів у `npm/skills/{skill}/` (SKILL.md + auto.md + js/).
- **Тести співрозташовуються з джерелами.** ~50 файлів з `npm/tests/` переїхали в `npm/rules/{rule}/js/*.test.mjs` (тести правил), `npm/scripts/*.test.mjs` (тести інфраструктури), `npm/scripts/utils/*.test.mjs` (тести утиліт). `tests/helpers.mjs` → `scripts/utils/test-helpers.mjs`. `npm/tests/` залишається тільки для 3 крос-правильних інтеграційних тестів.
- **`bin/n-cursor.js`**: `BUNDLED_MDC_DIR` → `BUNDLED_RULES_DIR`. `discoverBundledRuleNames` і `discoverCheckScripts` тепер обходять підкаталоги `rules/` замість файлів у `mdc/` чи `check-*.mjs` у `scripts/`. Резолвер check-скриптів: `rules/{rule}/js/check.mjs`. `readBundledRuleContent` читає `rules/{rule}/{rule}.mdc`.
- **`scripts/utils/run-conftest-batch.mjs` та `scripts/lint-conftest.mjs`**: шляхи до rego-полісі — `rules/{rule}/policy/{name}/` (замість `policy/{rule}/{name}/`). Snake_case `policyDirRel` у JS-call sites замінено на kebab-case.
- **`npm/package.json#files`**: `mdc` і `policy` видалено, додано `rules`. `scripts.test`: `bun test tests` → `bun test` (рекурсивний пошук `*.test.mjs`).
- **`.cursor/rules/scripts.mdc`** (v1.5): додано секцію «Структура правила» з документацією rule-centric layout для майбутніх правил. Path-references у `npm/CLAUDE.md` оновлено.

### Removed

- `npm/mdc/` (24 файли) — вміст переїхав у `npm/rules/{rule}/{rule}.mdc`.
- `npm/policy/` (24 каталоги) — вміст переїхав у `npm/rules/{rule}/policy/`.
- `npm/bin/auto-rules.md`, `npm/bin/auto-skills.md` — замінено на per-rule і per-skill `auto.md` в кожному каталозі.

## [1.9.20] - 2026-05-14

### Added

- **`check-rego.mjs` orchestrator + 3 rego-полісі для `rego.mdc`:**
  - JS gate у `npm/scripts/check-rego.mjs`: walk дерева від `cwd` (з типовими skip-ами і `.n-cursor.json:ignore`); якщо немає жодного `.rego` файла — `pass` (skip) ("rego-tooling не вимагається"). Інакше — FS-existence + content-валідація 3 файлів через `runConftestBatch`.
  - `rego.vscode_extensions` — `recommendations` ∋ `tsandall.opa`.
  - `rego.vscode_settings` — `[rego]` блок з `editor.defaultFormatter: "tsandall.opa"` + `editor.formatOnSave: true`; окремі deny на «не object», «неправильний defaultFormatter», «formatOnSave не true / відсутній».
  - `rego.package_json` — `scripts.lint-rego` присутній і дорівнює `"bun ./npm/scripts/lint-rego.mjs"` (точне значення, з підтримкою whitespace через `trim_space`).
  - +20 rego-тестів (5 + 7 + 8). Глобально у `lint-conftest` НЕ реєструються — це conditional правило, gating через JS.
- **`check-tauri.mjs` orchestrator + 1 rego-полісі для `tauri.mdc`:**
  - JS detector маркера Tauri-проєкту: `src-tauri/` каталог, `tauri.conf.json` у корені, або `@tauri-apps/*` у `dependencies`/`devDependencies` кореневого `package.json`. Якщо немає — `pass` (skip).
  - `tauri.vscode_extensions` — `recommendations` ∋ обидва: `tauri-apps.tauri-vscode` і `rust-lang.rust-analyzer`. Один deny з шаблоном повідомлень + `recommendations_set` поза deny (performance hint).
  - +6 rego-тестів (canonical, додаткові розширення, кожний відсутній маркер окремо, empty, no field).
- **`conftest verify`** — **293/293 pass** (+26).

### Changed

- **CLI auto-discovery** підхоплює `check-rego.mjs` і `check-tauri.mjs` через `discoverCheckScripts()` у `bin/n-cursor.js`. Окрема реєстрація не потрібна — будь-який `check-*.mjs` стає доступним через `npx @nitra/cursor fix <rule>`.

### Verified

- **На цьому репо `npx @nitra/cursor fix rego` детектує реальні гепи у `.vscode/extensions.json` (немає `tsandall.opa`) і `.vscode/settings.json` (немає `[rego]` блока).** Це true-positive: репо має `rego` у `.n-cursor.json:rules` і містить `.rego` файли, тож канонічний tooling-набір вимагається. Фікс — додати entries у `.vscode/*` згідно `rego.mdc`.

### Not migrated (explained)

- **`changelog.mdc` format-валідація** — пропущено: `conftest` не парсить markdown без pre-processing. Структурна валідація формату `## [version] - YYYY-MM-DD` лишається в `check-changelog.mjs` (JS), яке через regex розбирає текст. Перенесення вимагало б pre-processing markdown → JSON у JS перед викликом conftest — додаткова складність без виграшу.
- **`image-compress.mdc`** — вже має повне покриття rego через `image_compress.package_json` (8 deny, тести у [npm/policy/image_compress/package_json/](npm/policy/image_compress/package_json/)). `.gitignore` cross-file checks залишаються в `check-image-compress.mjs` як FS-логіка (rego не вміє).

## [1.9.19] - 2026-05-14

### Removed

- **`abie.mdc` (`1.19 → 1.20`) — повністю прибрано підтримку `ru`-overlay:** видалено секції «overlay **ru** і nginx-sidecar для WebSocket (Hasura)», «overlay **ru** і **Service** (headless → NodePort)», «overlay **ru** і HealthCheckPolicy»; з секцій «HTTPRoute (ua / ru)», «nodeSelector (overlay)», «env-файли», «Git branches» видалено `ru`-гілку. Залишається лише `dev` + `ua`. Таблиця env-файлів — без `ru.env` / `cluster.local` / YC. У workflow `clean-merged-branch.yml` обов'язкові токени `ignore_branches`: `dev,ua` (раніше `dev,ua,ru`).
- **`check-abie.mjs` — drop ru-логіки:** видалено всі функції з суфіксом / префіксом `Ru` (`isRuKustomizationPath`, `serviceDocumentRequiresAbieRuNodePortOverlay`, `ensureRuKustomizationHealthCheckDelete`, `ensureRuAbieServiceNodePortPatches`, `ensureAbieNginxSidecarForHasura` + усі допоміжні), regex / константи для `ru` overlay (`PATCH_PARENT_REF_NS_RU_RE`, `WEBSOCKET_ANNOTATION_RE`, `REMOVE_CLUSTER_IP*_RE`, `HASURA_IMAGE_MARKER`, `NGINX_SIDECAR_*`, `ABIE_RU_HTTPROUTE_HOST_MARKERS`, `HASURA_JWT_SECRET_IN_KUSTOMIZATION`). Перейменування: `ensureUaRuAbieNodeSelectorPatches` → `ensureUaAbieNodeSelectorPatches`, `ensureUaRuAbieHttpRoutePatches` → `ensureUaAbieHttpRoutePatches`. Тип `mode` — лише `'ua'`. Файл скоротився з ≈2013 до ≈880 рядків.
- **`check-k8s.mjs` — drop `ruKustomizationHasHealthCheckDeletePatch`:** export видалено разом з допоміжними regex; решта k8s-логіки без змін.
- **`check-hasura.mjs` — only `<cluster>.internal`:** `INTERNAL_HASURA_URL_RE` більше не приймає `cluster.local`; повідомлення про помилку згадує лише GKE-формат.
- **Rego — `abie.clean_merged_ignore_branches`:** `required_branches := {"dev", "ua"}` (раніше `{"dev", "ua", "ru"}`); тести оновлено.
- **`abie.base_deployment_preem` rego — коментар:** «Overlays (ua/ru)» → «Overlay ua».
- **`.cspell.json`:** зі списку слів прибрано `napitkivmeste` та `выбирайонлайн` (мову `ru-ru` у `language` залишено для коректного спелл-чеку коментарів/документації).
- **`k8s.mdc` приклади:** у переліку overlays залишилось `ua/`, `prod/` без `ru/`.
- **`hasura.mdc` / `tests/check-hasura.test.mjs`:** приклад "неправильного" публічного домену змінено з `napitkivmeste.tech` на `vybeerai.com.ua`.

### Tests

- **`tests/check-abie.test.mjs` — переписано (1210 → ≈480 рядків):** видалено всі тести `ru`-overlay (NodePort Service, HealthCheckPolicy delete, nginx-sidecar, websocket annotation, `ru-apruv` env-URL, ru parentRef regex). Залишено dev/ua сценарії.
- **`tests/check-hasura.test.mjs`:** видалено 2 тести на `cluster.local` / `ru-apruv`.
- **`tests/check-k8s-schema.test.mjs`:** видалено `describe('ruKustomizationHasHealthCheckDeletePatch')` і `isDevLikeK8sEnvSegment('ru')` assertion.
- **`tests/check-k8s-images.test.mjs`:** ASCII-збіг `ru: "true"` як ім'я label у фікстурі перейменовано на `preem: "false"`.

## [1.9.18] - 2026-05-13

### Changed

- **`docker.mdc` (`1.8 → 1.9`) — узгоджено канонічний `lint-docker.yml` з ga.mdc:** видалено 4 застарілих кроки з прикладу workflow (`actions/setup-node@v6` + `oven-sh/setup-bun@v2` + `actions/cache@v5` + `bun install --frozen-lockfile`) і замінено на один `uses: ./.github/actions/setup-bun-deps`. Раніше docker.mdc показував саме той патерн, який `ga.mdc` явно називає «❌ НЕПРАВИЛЬНО» і який `ga.workflow_common.rego` ловить через `forbidden_step_substrings` (3 заборонені підрядки). Конфлікт виник тому, що інші правила (`lint-style.mdc`, `lint-text.mdc`, `lint-js.mdc`) уже мігровано на composite, а docker.mdc пропустили. Hadolint-install залишається як окремий `curl`-крок (так само як `Install conftest` у `lint-ga.yml`).

### Added

- **`docker.package_json` rego — канонічний `scripts.lint-docker`:** deny, якщо ключ `scripts.lint-docker` присутній, але його значення ≠ `"bun ./npm/scripts/run-docker.mjs"`. Умовну обовʼязковість (правило `docker` у `.n-cursor.json` → `scripts.lint-docker` ЗОБОВ'ЯЗАНИЙ існувати) перевіряє `check-bun.mjs` cross-file, тут rego видно лише один документ. +6 тестів через `json.patch`-фікстури (canonical / lint-docker absent / whitespace / wrong value).
- **`docker.lint_docker_yml` rego — структура `.github/workflows/lint-docker.yml`:** 4 deny — (1) `on.push.paths` має містити 3 канонічні glob-и (`**/Dockerfile`, `**/*.Dockerfile`, `**/*.dockerfile`); (2) у `run:` будь-якого кроку має бути URL з версією `v2.12.0` (узгоджено з `HADOLINT_IMAGE` у `npm/scripts/utils/docker-hadolint.mjs`); (3) у `uses:` має бути `./.github/actions/setup-bun-deps` (canonical composite per ga.mdc); (4) у `run:` має бути `bun run lint-docker`. +9 тестів через `json.patch`-фікстури.
- **`lint-conftest.mjs` TARGETS — два нові entry:** `docker.package_json` (single: `package.json`) і `docker.lint_docker_yml` (single: `.github/workflows/lint-docker.yml`), обидва з `rule: 'docker'`. Цей репо (cursor) не має `docker` у `.n-cursor.json:rules` → docker таргети тут не активуються; полісі діятиме на проєкти-споживачі.
- **15 нових rego-тестів** (6 + 9), `conftest verify` — **267/267 pass** (+15).

### Regal fixes during migration

- `idiomatic/prefer-set-or-object-rule` у `lint_docker_yml.rego`: `all_step_uses := {u | …}` (comprehension) → `all_step_uses contains u if { … }` (incremental set rule).
- `style/line-length` × 3: винесено довгі hadolint-URL і шаблон повідомлення у проміжні константи через `concat`.

## [1.9.17] - 2026-05-13

### Added

- **2 нові rego-полісі для text.mdc VSCode-канону** (мігровано з `check-text.mjs`):
  - `text.vscode_extensions` — `recommendations` має містити три розширення: `DavidAnson.vscode-markdownlint`, `oxc.oxc-vscode`, `timonwong.shellcheck`. Шаблон повідомлень + множина `recommendations_set` (винесена поза `deny`, щоб не порушити `performance/non-loop-expression`).
  - `text.vscode_settings` — `editor.formatOnSave: true` плюс шість мов-блоків (`[javascript]`/`[typescript]`/`[json]`/`[vue]`/`[css]`/`[html]`) з `editor.defaultFormatter: "oxc.oxc-vscode"`. Окремі deny для «не object» і «неправильний defaultFormatter». Канон задає мінімум — додаткові lang-блоки дозволені.
- **18 нових rego-тестів** (7 для `vscode_extensions` + 11 для `vscode_settings`): happy path, додаткові поля, відсутність кожного розширення, відсутність `formatOnSave`, неправильний defaultFormatter, відсутні lang-блоки. `conftest verify` — **252/252 pass** (+18).
- **`lint-conftest.mjs` TARGETS — два нові entry для text:** `text.vscode_extensions` (`single: '.vscode/extensions.json'`) і `text.vscode_settings` (`single: '.vscode/settings.json'`), обидва з `rule: 'text'`. Глобально активуються для всіх проєктів з `text` у `.n-cursor.json:rules`.

### Removed

- **`check-text.mjs::checkVscodeTextExtensions` / `checkVscodeTextSettings` / `checkVscodeText`** — три JS-функції видалено разом з викликом `await checkVscodeText(pass, fail)` у `check()`. Зміст delegated у rego (`text.vscode_extensions` + `text.vscode_settings`).

### Changed

- **`check-text.mjs::checkTextConfigsExistence` — розширено двома записами:** тепер вимагає FS-існування `.vscode/extensions.json` і `.vscode/settings.json` поряд з `.oxfmtrc.json` / `.cspell.json` / `.markdownlint-cli2.jsonc`. lint-conftest з rego skip-ить неіснуючі файли, тому FS-existence лишається в JS — це працює як «єдина точка контролю наявності файлу + delegated content-валідація у rego».

## [1.9.16] - 2026-05-13

### Added

- **5 нових rego-полісі для `.vscode/extensions.json` / `.vscode/settings.json`** (мігровано канон з .mdc у rego, прибрано JS-дублі):
  - `style_lint.vscode_extensions` — `recommendations` має містити `stylelint.vscode-stylelint` (style-lint.mdc).
  - `style_lint.vscode_settings` — `css.validate` / `scss.validate` / `less.validate: false`; `editor.codeActionsOnSave` свідомо не enforced (smell-test, мдс показує як рекомендацію).
  - `graphql.vscode_extensions` — `recommendations` має містити `graphql.vscode-graphql` (graphql.mdc). НЕ реєструється глобально у `lint-conftest` TARGETS — правило conditional на наявність `gql\`…\``у джерелах; викликається з`check-graphql.mjs`через`runConftestBatch` після gql-scan.
  - `nginx_default_tpl.vscode_extensions` — `recommendations` має містити `ahmadalli.vscode-nginx-conf` (nginx-default-tpl.mdc).
  - `nginx_default_tpl.vscode_settings` — `editor.formatOnSave: true` і `[nginx].editor.defaultFormatter: "ahmadalli.vscode-nginx-conf"`. Обидва nginx-полісі викликаються з `check-nginx-default-tpl.mjs` через `runConftestBatch` лише після виявлення `default.conf.template`.
- **28 нових тестів** до пʼяти полісі: 5 (style_lint.vscode_extensions) + 6 (style_lint.vscode_settings) + 5 (graphql.vscode_extensions) + 5 (nginx_default_tpl.vscode_extensions) + 7 (nginx_default_tpl.vscode_settings). `conftest verify` — **234/234 pass** (+28).

### Removed

- **`check-style-lint.mjs::checkVscodeStylelint`** — функція повністю видалена; зміст delegated у `style_lint.vscode_extensions` і `style_lint.vscode_settings`. JSDoc-преамбулу оновлено.
- **`check-graphql.mjs::checkExtensionsRecommendation` — JS-копія тіла перевірки видалена:** функція тепер є тонкою обгорткою над `runConftestBatch`, делегує `graphql.vscode_extensions`. Зник дубль JSON-парсингу й порівняння `recommendations`.
- **`check-nginx-default-tpl.mjs::checkVscodeNginx` — JS-копія тіла перевірки видалена:** функція тепер делегує `nginx_default_tpl.vscode_extensions` і `nginx_default_tpl.vscode_settings` через `runConftestBatch`. Зник дубль перевірок `editor.formatOnSave` і `[nginx].editor.defaultFormatter` у JS.

### Changed

- **`lint-conftest.mjs` TARGETS — два нові глобальні entry для style-lint:** `style_lint.vscode_extensions` (`single: .vscode/extensions.json`) і `style_lint.vscode_settings` (`single: .vscode/settings.json`), обидва з `rule: 'style-lint'`. Не-style-lint проєкти не зачіпають (filter по `activeRules` з `.n-cursor.json`).
- **graphql/nginx — НЕ реєструються глобально у `lint-conftest`:** правила conditional на per-package умовах, які lint-conftest не вміє виразити (`gql\`…\``у джерелах для graphql; наявність`default.conf.template`для nginx). Plan B: rego-authoritative + JS-orchestrator з`runConftestBatch`.

## [1.9.15] - 2026-05-13

### Added

- **`npm/policy/js_run/jsconfig/jsconfig_test.rego` — 12 нових тестів для канону `jsconfig.json`:** rego-полісі `js_run.jsconfig` (canonical compilerOptions — `lib: ["esnext"]`, `module/moduleResolution: NodeNext`, `target: esnext`, `checkJs: false`, `include: ["src/**/*"]`) існувала, але не мала тестів і не запускалась на реальних файлах. Додано happy path + 11 негативних кейсів через `json.patch`-фікстури.
- **`npm/policy/image_avif/package_json/` — структурна валідація опт-аут конфігу:** новий rego-пакет `image_avif.package_json` з 3 deny-правилами для `package.json`: значення `"@nitra/minify-image"` має бути обʼєктом (якщо присутнє), `disable-avif` має бути boolean (якщо присутнє), захист від typo `disabled-avif`. Поле опційне — більшість проєктів його не мають, deny спрацьовує лише на нелегітимну форму (typo або wrong type, що тихо ламає опт-аут). +11 тестів. Зареєстровано у `lint-conftest.mjs` TARGETS з `walk` по всіх `package.json` (з фільтром `rule: "image-avif"`).

### Changed

- **`check-js-run.mjs::checkBackendJsconfigWhenSrcPresent` — структуру `jsconfig.json` тепер валідує rego через `runConftestBatch`:** замість FS-existence-only + посилання на `lint-conftest` (яке насправді не запускалось — rego не була зареєстрована глобально), JS тепер викликає rego-пакет `js_run.jsconfig` через `runConftestBatch` після того, як визначить, що пакет — backend (без `vite` у `devDependencies`) з каталогом `src/`. Це Plan B: Rego-authoritative + JS-orchestrator. Глобальна реєстрація `js_run.jsconfig` у `lint-conftest.mjs` свідомо не додавалась — rule стосується лише workspace-пакетів певної форми, що lint-conftest filter (`activeRules` на рівні репо) не вміє виразити.

### Not done (Phase 1.5 — пізніше)

- **`rego.mdc`, `tauri.mdc`** — rego-полісі для канонічних `.vscode/extensions.json` / `.vscode/settings.json` потрібен JS-orchestrator. Ці правила conditional (rego — glob `**/*.rego`, tauri — лише Tauri-проєкти), тож запускати rego безумовно на кожний `.vscode/extensions.json` дало б false-positive порушення для всіх не-rego/не-tauri проєктів. Чисте розширення rego-полісі без `check-<rule>.mjs`-orchestrator-а тут не закриває правило.

## [1.9.14] - 2026-05-13

### Added

- **`text.markdownlint` rego — повний канон `.markdownlint-cli2.jsonc` тепер виноситься як deny:** раніше rego-полісі мала **рівно один** deny (`gitignore == true`), а решта канонічного блока з [text.mdc](mdc/text.mdc) (`config.default == true`, `MD013 == false`, `MD024.siblings_only == true`, `MD029 == false`, `MD040 == false`, `MD041 == false`) була показана як приклад, але не перевірялась. Додано 6 нових deny-правил, що покривають кожне поле канону; додаткові поля верхнього рівня (`ignores`) і додаткові MD-rules (`MD033` тощо) дозволені — канон задає мінімум. Шаблон повідомлень — через `concat` для regal style/line-length.
- **`npm/policy/text/markdownlint/markdownlint_test.rego` — 14 нових тестів:** happy path (канонічний `.markdownlint-cli2.jsonc`), дозволені розширення (`ignores`, `MD033`), порушення для `gitignore` (відсутній / `false`), `config.default` (відсутній / `false`), `MD013/029/040/041` (`true` або відсутній), `MD024` (не object / `siblings_only: false` / відсутній). `conftest verify` — **183/183 pass** (+14). `lint-conftest` на реальному `.markdownlint-cli2.jsonc` репо: 5/5 (раніше було 1/1 — додано 4 нові тестові кейси проти реального файлу).

## [1.9.13] - 2026-05-13

### Removed

- **`check-bun.mjs::isAllowedRootDevDependency` — видалено JS-копію, дубль rego:** функція експортувалася лише для тестів, у `check()` не викликалась; логіка «дозволено лише `@nitra/*` у кореневих `devDependencies`» давно живе у `npm/policy/bun/package_json/package_json.rego` (`not startswith(name, "@nitra/")`). Docstring помилково посилався на `check-text.mjs`, який цю функцію не імпортує. Тепер єдине джерело — rego; у `check-bun.mjs` додано коментар з посиланням на полісі.

### Added

- **`npm/policy/bun/package_json/package_json_test.rego` — rego-тести для bun.package_json:** 12 нових `test_*`-кейсів через `json.patch`-фікстури — happy path (без `devDependencies`, з кількома `@nitra/*`), 4 негативні `devDependencies` (`@cspell/dict-uk-ua`, `@cspell/cspell-lib`, `lodash`, `@types/node`), mixed-devDeps з конкретним повідомленням про `lodash`, заборона `packageManager`, заборона кореневих `dependencies` (порожній обʼєкт теж), агрегований `lint`-скрипт (відсутній / не покриває `bun run` / без `&& oxfmt .`). Покривається `bun run lint-rego` (169/169 pass).

### Changed

- **`npm/tests/check-bun.test.mjs` — прибрано `describe('isAllowedRootDevDependency')`:** імпорт і блок тестів видалено; залишено інтеграційні `check-bun`-тести у тимчасових каталогах (FS / cross-file частина).
- **Аудит інших `check-*.mjs`**: пройдено всі 22 скрипти на наявність дубля з rego (export не викликається внутрішньо + наявне `npm/policy/<rule>/<name>/<name>.rego`). Знайдено лише цей кейс; `httpRouteMatchesNginxDefaultTpl` у `check-nginx-default-tpl.mjs` залишається — не має rego-counterpart і свідомо лишений для майбутнього використання згідно docstring. Інші експорти або викликаються у відповідному `check()` / приватних helper-ах, або не мають rego-копії.

## [1.9.12] - 2026-05-13

### Removed

- **`check-js-lint.mjs` — видалено дубльовані JS-копії канону `lint-js`:** експорти `CANONICAL_LINT_JS`, `isCanonicalLintJs`, `normalizeLintJsScript`, `nitraEslintConfigMeetsMinVersion` і константу `WHITESPACE_RE` видалено. Ці функції експортувалися, але **не використовувалися** у `check()` — пер-документна перевірка кореневого `package.json` (канонічний `lint-js`, `@nitra/eslint-config ≥ 3.9.2`, `type: "module"`, `engines.{node,bun}`) давно мігровано до rego-полісі `npm/policy/js_lint/package_json/`. Залишені експорти створювали два джерела істини: при оновленні канону (`bunx knip --no-config-hints`) доводилось правити і `.rego`, і `.mjs`-константу, що відкриває дрифт. Тепер канон лише в rego, JS-копії немає. У `check-js-lint.mjs` додано коментар з посиланням на rego-полісі.

### Added

- **`npm/policy/js_lint/package_json/package_json_test.rego` — rego-тести для канону `lint-js`:** перенесено покриття з JS-тестів (`normalizeLintJsScript`, `isCanonicalLintJs`, `nitraEslintConfigMeetsMinVersion`) у rego через `json.patch`-фікстури: 16 нових `test_*`-кейсів — happy path, неправильний порядок команд, відсутність `bunx knip`, відсутність `--no-config-hints`, `type` не `module`, `engines.node < 24`, `engines.bun < 1.3`, `@nitra/eslint-config` < 3.9.2, `workspace:*` дозволено. Покривається `bun run lint-rego` (`conftest verify`).

### Changed

- **`npm/tests/check-js-lint.test.mjs` — прибрано тести для видалених JS-копій:** видалено блоки `describe('normalizeLintJsScript / isCanonicalLintJs')` і `describe('nitraEslintConfigMeetsMinVersion')` разом з імпортами. Залишилися тести `verifyOxlintRcAgainstCanonical` (там JS усе ще authoritative — потрібен readFile + рекурсивне порівняння канон-блока).

## [1.9.11] - 2026-05-13

### Changed

- **`lint-js` — `bunx knip --no-config-hints` у каноні (js-lint.mdc `1.20 → 1.21`):** до канонічного `lint-js`-скрипта додано прапор `--no-config-hints`, щоб knip не друкував щоразу інформаційну секцію «Configuration hints» (`Remove from ignoreDependencies/ignoreBinaries`). Hints не впливають на exit code і часто стосуються свідомо доданих ignore (`graphql` як peer-залежність) — щоразу їх читати немає сенсу. Оновлено: `CANONICAL_LINT_JS` у `check-js-lint.mjs`, `canonical_lint_js` у `npm_module_unused.../js_lint.package_json.rego`, приклади `lint-js`-скрипта і CI-блока у `npm/mdc/js-lint.mdc` + дзеркало `.cursor/rules/n-js-lint.mdc`, реальний `package.json#scripts.lint-js` у корені, реальний `.github/workflows/lint-js.yml`. Rego-deny `lint-js.yml: у run немає bunx knip` ловиться через `contains` — новий рядок з прапором проходить як раніше.

## [1.9.10] - 2026-05-13

### Added

- **`npm/scripts/utils/knip-canonical.json` — канонічний baseline `knip.json` для проєктів-споживачів:** покриває типові false-positives `bunx knip` для наших правил — `entry` зі CLI-конфігами (eslint/stylelint/oxlint/jscpd/markdownlint-cli2/commitlint), `project` для `**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}`, `ignore` для `**/__fixtures__/**`, `ignoreDependencies` (`@nitra/cspell-dict`, `/@cspell\/dict-.+/`), `ignoreBinaries` для CLI з канону `bunx`/`npx` (`actionlint`, `cspell`, `depcheck`, `eslint`, `git-ai`, `jscpd`, `markdownlint-cli2`, `oxfmt`, `oxlint`, `shellcheck`, `uvx`, `v8r`, `zizmor`). Структурно поряд з `oxlint-canonical.json` / `oxlint-canonical-skeleton.json` у `npm/scripts/utils/`.
- **`js-lint.mdc` — секція про канонічний `knip.json` (версія `1.19 → 1.20`):** правило тепер вимагає `knip.json` у корені проєкту як стартовий baseline з канонічного файлу пакета. Перевіряється **лише наявність** — зміст подальших модифікацій локально не валідується (`entry` / `project` / `ignore` / `ignoreDependencies` / `ignoreBinaries` дозволені будь-які). Дзеркало — `.cursor/rules/n-js-lint.mdc`. Прибрано згадку про обовʼязковий `ignoreDependencies: ["graphql"]` як зміст-вимогу (тепер це лише стартова рекомендація через канон).
- **`check-js-lint.mjs::checkKnipConfig` — auto-create з канону:** якщо `knip.json` відсутній у корені, чек копіює `KNIP_CANONICAL_JSON_PATH` у `knip.json` і повідомляє pass про створення. Раніше функція падала з fail на відсутність і додатково перевіряла `ignoreDependencies ∋ "graphql"` — обидві перевірки замінено на FS-existence + копію канону (side effect, описано у `js-lint.mdc`).

## [1.9.9] - 2026-05-13

### Changed

- **AGENTS.md — додано `bunx knip` до секції Commands:** `build-agents-commands.mjs` тепер завжди додає рядок `- **knip (невикористані залежності та експорти)**: \`bunx knip\``після`npx @nitra/cursor fix`; оновлено тест (`items.length`3 → 4, перевірка`toContain('bunx knip')`).
- **`knip.json` — `graphql` у `ignoreDependencies`:** повернуто `graphql` до кореневого `ignoreDependencies` (peer-залежність, яку knip фолсово репортить як unused; вимога `js-lint.mdc` / `check-js-lint.mjs`).

## [1.9.8] - 2026-05-12

### Changed

- **Корінь монорепо:** локальне перевизначення `sonarjs/cognitive-complexity` у `eslint.config.js` прибрано — поріг і severity задаються в `@nitra/eslint-config`.

## [1.9.7] - 2026-05-12

### Changed

- **js-lint (mdc v1.18 → v1.19) — `depcheck` мігровано на `knip`:** канонічний `lint-js` тепер `bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip` (раніше — без `bunx knip`); крок `bunx knip` додано і в приклад workflow `lint-js.yml`. У корені має бути `knip.json` з мінімальним `ignoreDependencies: ["graphql"]` (peer-залежність, яку `knip` не розпізнає як використану). Пакет `knip` окремо в `devDependencies` не оголошуй — `bunx` тягне його ad-hoc. `CANONICAL_LINT_JS` у `npm/scripts/check-js-lint.mjs` і `canonical_lint_js` у `npm/policy/js_lint/package_json/package_json.rego` оновлено; додано `checkKnipConfig` (наявність файла + `ignoreDependencies` містить `graphql`) і `deny`-правило у `npm/policy/js_lint/lint_js_yml/` на відсутність `bunx knip` у `run:` кроці lint-js workflow.

- **ga (mdc v1.8 → v1.9) — заборона `depcheck` у workflow-файлах:** додано полісі `ga.workflow_common.deny` на будь-який виклик `depcheck` (через `npx`/`bunx`/`npm exec`/`pnpm exec` чи як standalone-команду) у `run:` кроку `.github/workflows/*.yml`. Перевірка невикористаних залежностей виконується разом з рештою лінтерів у `bun run lint-js` (`bunx knip`), окремий depcheck-крок у workflow зайвий. У `npm/mdc/ga.mdc` додано буліт «`depcheck`: не використовувати» з посиланням на `js-lint.mdc` і `ga.workflow_common`.

- **ci (тільки в цьому репо) — lint-ga встановлює conftest; knip.json налаштовано під монорепо:** `.github/workflows/lint-ga.yml` отримав крок `Install conftest` (curl-витяг релізу), бо `check-ga.mjs::runAllGaRego` ходить у `runConftestBatch` і hard-fail без бінарника. Кореневий `knip.json` розширено `workspaces.npm.entry` (всі CLI/scripts/tests як entry points — інакше knip false-positive репортить їх як unused), `ignoreBinaries` для `cspell`/`oxfmt`/`stylelint`/`vite` (всі через `bunx`/`npx`, не з deps), і `ignoreDependencies` для workspace self-refs. Це налаштування специфічне для цього репо; інші проєкти налаштовують `knip.json` під свою структуру.

### Removed

- **js-run (mdc v1.6 → v1.7) — секцію «depcheck у GitHub Actions з path-фільтром» прибрано:** правило про обовʼязковий `npx depcheck --ignores="graphql,bun"` з `working-directory` у path-scoped workflow більше не діє — `depcheck` повністю мігровано на `knip` (див. js-lint.mdc), окремий крок у per-package workflow не потрібен. Файл `npm/scripts/utils/depcheck-workflow.mjs` видалено. У `npm/scripts/check-js-run.mjs` прибрано `checkDepcheckInWorkflows`, імпорти `findDepcheckViolationsForPackage` / `readAllWorkflowFiles` і параметр `workflows` у `checkWorkspacePackage`. У `npm/tests/check-js-run-fixture.test.mjs` видалено `describe('check-js-run: depcheck у path-scoped workflow', …)` (9 тест-кейсів) і допоміжну `writeRepoWithCronJobAndWorkflow`. У `.github/workflows/npm-publish.yml` прибрано крок `npx depcheck --ignores="graphql,bun,bun:test,@nitra/cursor"` з `working-directory: npm` — `lint-js` workflow покриває цю перевірку через `bunx knip`.

## [1.9.6] - 2026-05-12

### Changed

- **js-lint — ігнорувати `.claude/worktrees/` для jscpd і всіх лінтів:** правило `js-lint.mdc` (v1.18) тепер документує, що каталог `.claude/worktrees/` (робочі копії, які Claude Code створює через superpowers-skill `using-git-worktrees`) має бути виключений з лінт-перевірок. Канонічне місце — `.gitignore` (паралельні воркті — це за визначенням не-комітні робочі копії; `gitignore: true` у `.jscpd.json` уже є, тож запис у `.gitignore` каскадно вимикає сканування). Як страховку на випадок запуску jscpd без `gitignore: true` рекомендовано додати `.claude/worktrees/**` у `ignore` `.jscpd.json` — приклад у правилі оновлено. Без цього `bunx jscpd .` фіксує дзеркальні «клони» між кореневим репо і його worktree-копією у `.claude/worktrees/<name>/…`.

## [1.9.5] - 2026-05-12

### Changed

- **npm-module — компактний пакет: whitelist `files`, без `devDependencies`, тести/фікстури поза опублікованим деревом:** правило `npm-module.mdc` тепер вимагає максимально компактний tarball. (1) Поле `"files"` у `npm/package.json` обовʼязкове як whitelist (без нього npm пакує майже все). (2) `npm/package.json` не повинен містити `devDependencies` — інструментарій для розробки тримаємо у кореневому `package.json` монорепо, щоб `npm install @nitra/<pkg>` не тягнув його кінцевим користувачам. (3) Тести й фікстури не повинні потрапляти у tarball: канонічне місце — `npm/tests/` (не додається до `"files"`); це стосується і test-style каталогів (`tests/`, `__tests__/`, `fixtures/`, `__fixtures__/`, `spec/`, `test/`), і файлів за патернами `*.test.*` / `*.spec.*`, і JS/TS-файлів з імпортами test-фреймворків (`bun:test`, `node:test`, `vitest`, `@jest/globals`, `mocha`, `jest`, `ava`, …). **Виняток — Rego (`*_test.rego`):** за конвенцією conftest юніт-тест лежить поруч з полісі у тому самому `package`, тож rego-тести дозволені всередині опублікованого `policy/`-каталогу і входять у tarball.
- **npm-module — пер-документні deny у rego (Rego-authoritative):** `npm/policy/npm_module/npm_package_json/npm_package_json.rego` розширено двома deny: (а) `"files"` як whitelist обовʼязковий (відсутній / не масив / порожній); (б) `"devDependencies"` мають бути відсутні або порожні. Додано `npm_package_json_test.rego` з happy-path + 7 негативних кейсів (`json.patch` фікстури). Покривається `bun run lint-rego` (`conftest verify`) і `bun run lint-conftest` (батч проти реального `npm/package.json`). Раніше я помилково реалізував ці перевірки у JS — це порушує `.cursor/rules/conftest.mdc` (Rego-default для пер-документних структурних перевірок). Тепер виправлено: JS-функцію `checkPackageCompactness` видалено з `check-npm-module.mjs` разом з виклик-сайтом.
- **npm-module — `check-npm-module.mjs` лишає лише FS/AST-частину:** функція `checkNoTestsInPublishedFiles` резолвить позитивні patterns поля `files`, віднімає негативні (підтримка `!…` glob з `*` / `**` / `?`), і для кожного файлу-кандидата ловить test-style ім'я каталога/файлу або імпорт тест-фреймворку через oxc-parser (`module.staticImports` + `require()` + динамічний `import()`). `*_test.rego` свідомо не входить у `TEST_FILE_PATTERNS` — дозволений виняток для conftest-конвенції (юніт-тест поруч з полісі у тому самому `package`).
- **npm/package.json — приведено до правила:** видалено секцію `devDependencies` (`@nitra/cursor` вже є у корені як `workspace:*`). `policy/**/*_test.rego` свідомо лишаються у tarball — як виняток для conftest-конвенції.
- **conftest.mdc + npm/.claude-template/npm-CLAUDE.md — гостріший Rego-first сигнал:** у `.cursor/rules/conftest.mdc` додано STOP-блок перед `Edit` будь-якого `check-<rule>.mjs` (стосується і нових перевірок, і розширення вже існуючих; типовий ляп — `if (pkg.<field>) fail(…)` у JS замість ще одного `deny contains` у відповідному rego-пакеті). Перший пункт алгоритму уточнено прикладом «заборона/наявність ключа верхнього рівня типу `devDependencies` / `scripts.<name>`». У `npm-CLAUDE.md` секцію «Перш ніж писати `check-*.mjs`» переписано у self-check з 3 пунктів і червоним прапором. Регенеровано `npm/CLAUDE.md`.

## [1.9.4] - 2026-05-11

### Removed

- **graphql — вимога `scripts.dump-schema` у `package.json` прибрана:** правило `graphql.mdc` більше не вимагає канонічний скрипт `dump-schema` (раніше — `bunx graphqurl http://localhost:4040/v1/graphql -H 'X-Hasura-Admin-Secret: secret' --introspect > schema.graphql`) у корені проєкту за наявності gql tagged template literals. У `.mdc` відповідну буліт-точку та JSON-фрагмент видалено; фраза про «стандартний спосіб оновлення локальної `schema.graphql`» теж прибрана з підсумкового речення. Каталог `npm/policy/graphql/` (єдиний файл `package_json/package_json.rego` з deny-правилами на відсутність/неканонічний `scripts.dump-schema`) видалено повністю. Запис реєстру `graphql.package_json` (policyDir `graphql`, rule `graphql`, single `package.json`) прибрано з `npm/scripts/lint-conftest.mjs` (заголовок секції перейменовано — `graphql` вилучено). JSDoc-преамбулу `npm/scripts/check-graphql.mjs` оновлено: видалено абзац про rego-порт перевірки `dump-schema` і згадку `scripts.dump-schema` з JSDoc функції `check()`. Сам JS-чек і так не торкався `package.json` — після видалення rego-полісі ніяких runtime-перевірок `dump-schema` не лишається. У кореневому `package.json` репо cursor скрипт `dump-schema` теж видалено, оскільки тримати його як shim без правила немає сенсу.

## [1.9.3] - 2026-05-11

### Fixed

- **k8s — `pathHasK8sSegment` тепер відносно кореня репо; `.github/` явно поза скоупом:** функція `pathHasK8sSegment(filePath)` у `npm/scripts/check-k8s.mjs` та `npm/scripts/run-k8s.mjs` розбивала **абсолютний** шлях і шукала компонент `k8s`. У проєктах, де сам корінь репо називається `k8s/` (напр. `/Users/.../abie/k8s/`), сегмент `k8s` присутній в абсолютному шляху **усіх** файлів — і весь репозиторій, включно з `.github/workflows/*.yml`, потрапляв у `findK8sYamlFiles` як k8s-маніфести, після чого `checkK8sYamlFile` падав на «розширення .yml — перейменуй на .yaml» (територія `ga.mdc`, де канон протилежний). Виправлено: (1) сигнатура тепер `pathHasK8sSegment(filePath, root?)` — коли `root` передано, шлях спершу нормалізується через `node:path` `relative(root, filePath)`, і компоненти беруться **відносно кореня** (порожній relative — це сам root, повертає false); (2) `findK8sYamlFiles` у `check-k8s.mjs` і `check-abie.mjs`, а також `findK8sRoots` у `run-k8s.mjs` тепер передають `root` і додатково мають defense-in-depth ранній `return` для шляхів, що починаються з `.github/`; (3) `k8s.mdc` явно фіксує: правило стосується каталогів `k8s` відносно кореня; `.github/workflows/` і `.github/actions/` — поза скоупом (їх веде `ga.mdc`). Без `root` (юніт-тести з відносним шляхом) функція веде себе як раніше. Додано тести у `tests/check-k8s-schema.test.mjs` (worst-case з префіксом `/home/test/some/k8s/`) і `tests/run-k8s-roots.test.mjs` (інтеграційний — `findK8sRoots` у репі, корінь якого називається `k8s/`).

## [1.9.2] - 2026-05-11

### Changed

- **k8s — modeline `$schema` тепер опційний; `file:…` заборонено як плейсхолдер:** правило `k8s.mdc` уточнено — рядок `# yaml-language-server: $schema=…` обов'язковий **лише** коли для поєднання `apiVersion`/`kind` існує надійна публічна схема (kustomization / yannh / datree CRDs-catalog). Якщо публічної схеми немає, modeline **не додається зовсім** (раніше п. 5 розділу «Визначення схеми YAML» допускав `file:` за узгодженням — це створювало фальшиву видимість валідації, а автовиправлення n-fix залишало плейсхолдер `# yaml-language-server: $schema=file:.`). У `check-k8s.mjs`: (1) файли без modeline більше не падають як «перший рядок має бути коментарем», натомість `pass` із позначкою «без modeline — перевірка $schema пропущена»; (2) `$schema=file:…`тепер реєструється як помилка з підказкою прибрати modeline; (3) modeline нижче першого рядка все ще порушення; (4)`HttpBackendGroup`(Yandex ALB) як виняток без modeline залишається без змін.`lint-k8s`(kubeconform з прапорцем ignore-missing-schemas) продовжує покривати валідацію і для файлів без modeline. JSDoc на початку`check-k8s.mjs` оновлено.

## [1.9.1] - 2026-05-11

### Added

- **rego `k8s.base_kustomization` — defense-in-depth deny на HPA/PDB у `base/kustomization.yaml::resources:`:** додано пер-документне правило, що відмовляє, якщо `resources:` локально містить запис із basename `hpa.yaml`/`pdb.yaml`/`hpa.yml`/`pdb.yml` (у будь-якому підкаталозі). Канон k8s.mdc — HPA/PDB у sibling `components/` (Kustomize Component) і підключаються з overlay. Рекурсивний обхід дерева `resources:`/`components:`/`bases:` (із зануренням у вкладені kustomization.yaml) лишається у JS-оркестраторі `verifyK8sBaseKustomizeHasNoHpaPdb` (потребує fs-доступу). Rego-deny ловить найпоширеніший локальний випадок навіть якщо JS-крок упаде з винятку раніше. 5 нових rego-тестів (`hpa.yaml`/`pdb.yaml`/`hpa.yml` у `resources:`, чистий `resources:`, lookalike basename `myhpa.yaml`); `opa test` зелений (10/10).

### Fixed

- **`check-k8s.mjs`:** додано константу `GATEWAY_API_GROUP_PREFIX = 'gateway.networking.k8s.io/'`. Її відсутність кидала `ReferenceError` у `indexOneK8sYamlForHasuraCanon` (на лінії з `av.startsWith(GATEWAY_API_GROUP_PREFIX)`), яку ловив outer try/catch у `bin/n-cursor.js` і **тихо пропускав** усі наступні JS-валідатори в `check-k8s.mjs::check()` — серед них `validateKustomizeHpaPdbOnlyWithBaseDeployment`, `validateConfigMapNameMatchesDeployment`, `validateDeploymentHpaPdbAndTopology`, `validateProdKustomizationOverrides`. Наслідок у репах споживачів: правило «HPA/PDB заборонені у `k8s/base/`» не спрацьовувало (хоча `verifyK8sBaseKustomizeHasNoHpaPdb` логіку містив правильну), бо exception вилітав раніше за чергу JS-кроків. Rego-крок (`runAllK8sRego`) ішов **до** crash-точки й тому продовжував працювати — пер-документні перевірки залишалися активними, а cross-file JS — ні.

## [1.9.0] - 2026-05-11

### Changed

- **mdc frontmatter — `alwaysApply: false` + `globs` для файлово-чітких правил:** `ga` (`.github/workflows/*.yml`), `vue` (`**/*.vue`), `php` (`**/*.php`), `style-lint` (`**/*.{css,scss,vue}`), `nginx-default-tpl` (`**/default.{conf.template,tpl.conf}`), `image-avif` (`**/*.{png,jpg,jpeg,gif,avif,vue,html}`), `image-compress` (`**/*.{png,jpg,jpeg,gif,svg}`), `changelog` (`**/{CHANGELOG.md,package.json}`), `hasura` (`**/hasura/**,**/*.env`), `graphql` (`**/*.{vue,js,mjs,cjs,ts,tsx,jsx}`). Раніше тільки `docker`, `k8s`, `rego` тримали file-scoped формат; решта вантажилася в контекст Cursor завжди (`alwaysApply: true`). Тепер правило підтягується лише коли в контексті є файл за патерном — менше «шуму» у промптах для несуміжних задач. Версії bump-нуто на патч-крок у кожному `*.mdc`. Проєктно-широкі правила (`bun`, `npm-module`, `ci4`, `text`, `js-lint`) і opt-in (`abie`, `adr`) лишилися `alwaysApply: true` без globs.

## [1.8.229] - 2026-05-11

### Removed

- **k8s / `k8s.kustomize_managed`:** правило «`metadata.namespace` заборонено у YAML, досяжних через граф Kustomize» зняте — воно конфліктувало з `k8s.base_manifest`, який натомість **вимагає** `metadata.namespace` у `…/k8s/base/…` для namespaced kind. Перетин предикатів був порожній, що давало ~50 хибних помилок у канонічних деревах `base + overlays` (adminer, run/nginx, reference-grant, otel, dremio, gateway тощо). Видалено: правило з `mdc/k8s.mdc` (бульйт «Де не дублювати `metadata.namespace`»), rego-полісь `npm/policy/k8s/kustomize_managed/`, JS-helpers `metadataNamespaceForbiddenViolation` і `collectKustomizeManagedRelPaths` разом з відповідними тестами та плумінгом `kustomizeManagedRel` через `runAllK8sRego` / `checkK8sYamlFile`. Логіка `base_manifest` (`metadata.namespace` обов'язковий у `k8s/base/`) лишається; у overlays Kustomize це значення буде перезаписано полем `namespace:` з `kustomization.yaml`.

## [1.8.228] - 2026-05-10

### Changed

- **k8s / Plan B (rego-authoritative, повна централізація):** rego-крок переїхав на початок `check-k8s.mjs::check()` через новий helper `runAllK8sRego` — батч-виклик `runConftestBatch` для 9 пакетів (`k8s.manifest`, `k8s.gateway`, `k8s.hpa_pdb`, `k8s.kustomization`, `k8s.svc_yaml`, `k8s.svc_hl_yaml`, `k8s.base_kustomization`, `k8s.base_manifest`, `k8s.kustomize_managed`). JS у `check-k8s.mjs` робить лише cross-file orchestration + autofix + modeline. Cross-file orchestrators `validateHasuraConfigMapRemoteSchemaPermissions` і `validateHasuraHttpRouteCanon` рефакторнуто: JS відбирає paired-with-Hasura-Deployment файли, далі батч-conftest на `k8s.hasura_configmap`/`k8s.hasura_httproute`. Видалено JS-orchestrator-функції-дублі (≈10 шт): `scanForbiddenManifestsInYamlDocuments`, `failIfIngressInDocument`, `failIfAutoscalingV1InDocument`, `validateK8sYamlPolicyDocuments`, `failIfK8sPolicyNamespaceRulesViolated`, `failIfK8sPolicyResourceRulesViolated`, `runK8sYamlPolicyAndGatewayScans`, `scanGatewayApiRouteBackendRefsInYamlBody`, `failIfGatewayRouteUsesNonHeadlessService`, `validateKustomizationResourcesSortedAlphabetically`, `validateKustomizationPatchesStructuralSort`, `validateInlinePatchesSorted`, `validateKustomizationJson6902NoRemoveAddSamePath`, `auditJson6902OneKustomizationYamlFile`, `auditJson6902ForKustomizationYamlDoc`, `auditKustomizationPatchesJson6902`, `auditOneKustomizationJson6902Patch`, `auditJson6902PatchExternalFile`, `failIfJson6902RemoveAddConflictOnSamePath`, `verifyBaseKustomizationNamespaceOnFile`, `ensureBaseKustomizationHasNamespace`, `readFirstConfigMapDoc`. Видалено публічний predicate `isForbiddenAutoscalingV1Manifest` + його тест (rego `k8s.manifest` авторитативно). Решта predicates лишилися як публічні exports для back-compat (`hpaManifestViolations`, `pdbManifestViolations`, `deploymentTopologySpreadConstraintsViolation` все ще активно використовуються JS cross-file для expected-name/dev-like; інші — тестові shim, можна прибрати окремо).
- **`checkK8sYamlFile`** залишає тільки modeline + `$schema`-URL перевірки; per-document валідація (Ingress/autoscaling/v1 заборонено, Service GCP-анотації, Deployment resources/Hasura image/topologySpread, Gateway API backendRef правила, HCP, svc/svc-hl, namespace правила) — у rego, виконано на початку `check()`.

## [1.8.227] - 2026-05-10

### Changed

- **conftest.mdc (alwaysApply):** канонізовано патерн «Rego-authoritative + JS-orchestrator» (Plan B) як основний для всіх перевірок у репо. Розділ «Гібрид» переписано: замість «JS authoritative + rego-копія» (Plan A) — тепер чітко: пер-документне правило існує **рівно в одному місці** (rego), а `check-<rule>.mjs` делегує його через `runConftestBatch` (`npm/scripts/utils/run-conftest-batch.mjs`), один спавн на namespace. Додано конкретний шаблон `check()` (rego-крок перший, JS cross-file — після) і опис інтеграції з `lint-<rule>.mjs` (external-tools wrapper викликає `await checkX()` як останній крок). Реальні приклади — abie (пілот) і ga (повна централізація). Новий «червоний прапор» забороняє лишати JS-копію rego-правила «про всяк випадок» — це плодить дрифт.

## [1.8.226] - 2026-05-10

### Changed

- **ga / Plan B (rego-authoritative, повна централізація):** rego-крок переїхав із `lint-ga.mjs` у `check-ga.mjs::check()` як **перший крок**. Раніше `bun run lint-ga` сам викликав 4 per-workflow conftest + 1 batch для `ga.workflow_common`, а `npx @nitra/cursor fix ga` цю частину не робив — тепер вся ga-логіка (rego + JS cross-file) в одному `check-ga.check()`. `lint-ga.mjs::runLintGaCli` спрощено: preflight (shellcheck/uv) → actionlint → zizmor → `await checkGa()`. Видалено: `CONFTEST_TARGETS`, `GA_POLICY_DIR`, `runConftestStep`, `runConftestWorkflowCommon` — і непотрібні імпорти `existsSync`/`readdirSync`/`dirname`/`join`/`fileURLToPath`. `runLintGaCli` тепер `async`; `bin/n-cursor.js` оновлено на `await runLintGaCli()`. Тест `lint-ga.test.mjs` оновлено: `await fn()` замість `fn()`. Тест `check-ga.test.mjs::"exit 1 коли shellcheck відсутній"` переведений на точковий виклик експортованої `checkShellcheckInstalled` (бо `withBinRemovedFromPath('shellcheck')` на macOS заодно видаляв `/opt/homebrew/bin` де conftest, ламаючи hard-fail у `runConftestBatch`).
- **`check-ga.mjs::checkShellcheckInstalled`:** додано `export` (потрібен для точкового тесту після рефактору).
- **тестова фікстура `setupCanonicalGaProject` у check-ga.test.mjs:** додано секцію `concurrency` (з канонічними `group` і `cancel-in-progress: true`) у workflow `clean-ga-workflows.yml`, `clean-merged-branch.yml`, `git-ai.yml` — `ga.workflow_common` rego тепер запускається у `check()`, а ці workflow раніше не мали concurrency у фікстурі (правило `lint-ga.yml` уже мало). Це **правильна** реакція: rego-перевірка тепер ловить порушення на тих самих фікстурах, на яких раніше не запускалась.

## [1.8.225] - 2026-05-10

### Added

- **utility `runConftestBatch`:** новий `npm/scripts/utils/run-conftest-batch.mjs` — спавнить `conftest test` одним викликом для batched-списку файлів, парсить `--output json`, повертає структуровані `{filename, namespace, message}` порушення. Hard-fail зі install-hint якщо `conftest` не у PATH (узгоджено з рішенням Plan B). Використовується з `check-*.mjs` для делегування пер-документної валідації у Rego-полісі без помітного сповільнення (один спавн на namespace, не на файл).

### Changed

- **abie / Plan B (rego-authoritative, pilot):** `npm/scripts/check-abie.mjs` рефакторнуто — пер-документна валідація 4 правил тепер делегується rego через `runConftestBatch`, JS залишає лише cross-file-оркестрацію (walking, path-фільтрацію, парність файлів). Видалені JS-функції-предикати (тепер єдине джерело істини — rego): `abieBaseHttpRouteHostnamesErrors`, `deploymentDocumentHasAbieBasePreemNodeSelector`, `parseCleanMergedIgnoreBranches`, `ignoreBranchesIncludesRequired`, `validateAbieHcPolicy`, плюс хелпери `collectAbieHostnames`, `isAllowedAbieBaseDevHostname`, `isAbiePreemTruthy`, `processBaseHttpRouteDoc`, `httpRouteHasNonEmptyHostnames`, `findHealthCheckPolicyInDocs` і константа `ABIE_REQUIRED_IGNORE_BRANCHES`. Імпорти `flattenWorkflowSteps`, `getStepUses`, `parseWorkflowYaml` (`./utils/gha-workflow.mjs`) теж прибрано — orphan після видалення JS-парсера workflow.
- **abie.health_check_policy (rego):** виправлено divergence з JS — тепер targetRef.name перевіряється точним match-ем `<hcp.metadata.name>-hl` (з нормалізацією: якщо name вже закінчується на `-hl`, береться як є). До цього rego перевіряло лише суфікс `-hl`, що дозволяло `targetRef.name=bar-hl` для HCP з `name=foo` — це не дзеркалило JS.
- **`validateAbieHcYaml` → `validateAbieHcModeline`:** export перейменовано — JS-частина перевірки hc.yaml тепер обмежується modeline (`# yaml-language-server: $schema=…`); парсинг YAML і структурна валідація HCP делеговано rego.
- **`npm/tests/check-abie.test.mjs`:** прибрано тести видалених JS-предикатів (8 тестів) — їх покриття тепер забезпечують `_test.rego` фікстури через `conftest verify`.
- **`npm/tests/cross-check-rego-abie.test.mjs`:** видалено — після Plan B JS-сторони для крос-чеку немає; `_test.rego` фікстури в кожному abie-пакеті дають аналогічне покриття.

## [1.8.224] - 2026-05-10

### Added

- **golden cross-check тести JS↔rego (abie):** додано `npm/tests/cross-check-rego-abie.test.mjs` (25 тестів), який для кожної пари (JS-предикат у `check-abie.mjs` ↔ rego-пакет у `npm/policy/abie/`) подає однаковий вхід у обидва імплементації через `opa eval --format json` і перевіряє інваріант **«обидва бачать порушення або обидва ні»**. Покриває: `deploymentDocumentHasAbieBasePreemNodeSelector` ↔ `abie.base_deployment_preem`; `parseCleanMergedIgnoreBranches`+`ignoreBranchesIncludesRequired` ↔ `abie.clean_merged_ignore_branches`; `abieBaseHttpRouteHostnamesErrors` ↔ `abie.http_route_base`; rego-only golden-фікстури для `abie.health_check_policy` (бо JS-функція `validateAbieHcPolicy` приватна). Тест автоматично пропускається, якщо `opa` не у PATH. Sanity-check ламанням rego навмисно — drift детектується.

## [1.8.223] - 2026-05-10

### Added

- **abie / нові rego-пакети:** `npm/policy/abie/base_deployment_preem/` (Deployment у `…/k8s/.../base/...` має `spec.template.spec.nodeSelector.preem` зі значенням, що вважається істинним — boolean `true` або рядок `"true"`); `npm/policy/abie/clean_merged_ignore_branches/` (у workflow `.github/workflows/clean-merged-branch.yml` крок `phpdocker-io/github-actions-delete-abandoned-branches` має `with.ignore_branches` з токенами `dev,ua,ru`, case-insensitive). Реєстрація в `lint-conftest.mjs` TARGETS: walk-pattern для base-resource YAML і single-target для workflow.
- **abie / `_test.rego` фікстури:** додано юніт-тести для всіх 4 abie-пакетів — нових (`base_deployment_preem_test.rego`, `clean_merged_ignore_branches_test.rego`) і існуючих (`http_route_base_test.rego`, `health_check_policy_test.rego`). 35 тестів покривають happy paths і deny-кейси.

### Changed

- **abie.health_check_policy (rego):** виправлено помилковий шлях `spec.config.httpHealthCheck` → правильний `spec.default.config.httpHealthCheck` (узгоджено з `validateAbieHcPolicy` у `check-abie.mjs`). Розширено перевірками: точна `apiVersion: networking.gke.io/v1`, `metadata.name` непорожній, `spec.default.config.type: HTTP`, `targetRef.kind: Service`. Cross-file звірка `<deployment.name>-hl` лишається у JS.
- **abie.mdc:** додано розділ «Швидкий gate через conftest (Rego)» зі списком rego-пакетів і опису того, що cross-file логіка (парність HCP↔Deployment, обчислений `<name>-hl`, валідація ru/ua-overlay JSON6902 patches, env→cluster DNS, cross-namespace backendRefs) лишається у `check-abie.mjs`.
- **lint-conftest.mjs TARGETS:** `abie.health_check_policy` і `abie.http_route_base` — `policyDir` уточнено до конкретного підкаталогу (`abie/health_check_policy`, `abie/http_route_base`) замість загального `abie`. Додано шляховий regex `K8S_BASE_RESOURCE_PATH_RE` для базових ресурсних YAML.

## [1.8.222] - 2026-05-10

### Added

- **k8s / rego-полісі:** розширено `npm/policy/k8s/manifest/manifest.rego` (Deployment cpu+memory у `requests`, Hasura image pin із білим списком тегів, канонічний `topologySpreadConstraints` з мітки `app` самого Deployment). Додано `manifest_test.rego` із вхідними фікстурами; rego тестується через `conftest verify` (опційний крок у `bun run lint-rego`). JS у `check-k8s.mjs` лишається authoritative — нові правила Rego — швидкий gate для одиничного маніфеста.
- **k8s / нові rego-пакети:** `npm/policy/k8s/gateway/` (Gateway API: backendRef з суфіксом `-hl`, redundant `namespace` у backendRef, HCP `targetRef.name` `-hl`); `npm/policy/k8s/kustomization/` (resources/patches алфавітне сортування, JSON6902 `remove`+`add` на той самий `path`); `npm/policy/k8s/svc_yaml/` (`Service.spec.type: ClusterIP`); `npm/policy/k8s/svc_hl_yaml/` (headless Service з суфіксом `-hl` і `clusterIP: None`); `npm/policy/k8s/base_kustomization/` (обов'язковий `namespace:`); `npm/policy/k8s/base_manifest/` (`metadata.namespace` у base, base-canon `cpu='0.02'`/`memory='128Mi'`); `npm/policy/k8s/kustomize_managed/` (заборона `metadata.namespace` у kustomize-managed файлах); `npm/policy/k8s/hasura_configmap/` (`HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"`); `npm/policy/k8s/hasura_httproute/` (канон 4 правил Hasura: `/ql` Exact + `/ql/` Exact + PathPrefix + WebSocket); `npm/policy/k8s/hpa_pdb/` (структурний gate HPA/PDB: `apiVersion`, `behavior.scaleUp/Down`, `metrics`, `selector.matchLabels`). До кожного пакета додано `*_test.rego` фікстури.
- **lint-rego:** додано опційний крок `conftest verify` у `npm/scripts/lint-rego.mjs` після `regal lint` для виконання `*_test.rego`. Якщо `conftest` не у PATH — крок мовчки пропускається з install-hint.

### Changed

- **lint-conftest:** `npm/scripts/lint-conftest.mjs` — `k8s.manifest` target тепер указує на `policyDir: 'k8s/manifest'` (вужчий policy-tree), додано targets для нових пакетів `k8s.gateway`, `k8s.hpa_pdb`, `k8s.kustomization`, `k8s.svc_yaml`, `k8s.svc_hl_yaml`, `k8s.base_kustomization`, `k8s.base_manifest`. Шляхові регекспи: `K8S_KUSTOMIZATION_PATH_RE`, `K8S_BASE_KUSTOMIZATION_PATH_RE`, `K8S_BASE_MANIFEST_PATH_RE`, `K8S_SVC_YAML_PATH_RE`, `K8S_SVC_HL_YAML_PATH_RE`. Пакети `kustomize_managed`, `hasura_configmap`, `hasura_httproute` потребують cross-file gating з `check-k8s.mjs` і не входять у `lint-conftest` walk-targets.
- **n-k8s.mdc:** додано розділ «Швидкий gate через conftest (Rego)» зі списком rego-пакетів і опису того, що cross-file логіка (резолюція kustomize-tree, парність svc.yaml/svc-hl.yaml, прив'язка ConfigMap/HTTPRoute до Hasura-Deployment, HPA/PDB by directory, env-залежні межі min/maxReplicas) лишається у `check-k8s.mjs`.
- **conftest.mdc (alwaysApply):** замість одного абзацу про «пріоритет conftest» — повний алгоритм рішення для нової перевірки: декізія-дерево (single-document → Rego за замовчуванням; cross-file/FS/autofix/text-pre-YAML → JS), workflow «спершу намалюй вхід → rego або гібрид», список «червоних прапорів» (Rego не вміє X — звір зі списком винятків). Мета: робити Rego default-вибором для нових перевірок.
- **npm/.claude-template/npm-CLAUDE.md:** додано path-scoped нагадування «Перш ніж писати `check-*.mjs`» з посиланням на алгоритм у `conftest.mdc`. Регенеровано `npm/CLAUDE.md`.

## [1.8.221] - 2026-05-10

### Changed

- **ci4.mdc:** наповнено правило людинозрозумілим описом C4-моделі як джерела істини. Markdown-файли (C4 + ADR + тести + документація) — офіційне джерело істини про проєкт. Перед змінами агент аналізує відповідні C4-файли; кожна зміна, що впливає на модель, супроводжується оновленням C4-схеми у тому ж PR. ADR описує вплив рішення на C4 (які контейнери/компоненти з'являються/зникають/змінюють відповідальність). Кожен C4-компонент має посилання на відповідні тести. C4-схеми — частина користувацької документації, не закритий артефакт. Алгоритмічної `check-ci4.mjs` поки немає — правило процесне; `## Перевірка` залишено для майбутньої формалізації.

## [1.8.220] - 2026-05-09

### Fixed

- **k8s / `prodOverlayHpaPdbOverrideNeeds`:** виключено Kustomize Component (`kind: Component`) з prod-overlay-перевірки. Раніше `<pkg>/k8s/components/kustomization.yaml` помилково тригерив `прод-оверлей має перевизначати spec.minReplicas/maxReplicas/minAvailable` — але Component є **джерелом** ресурсів для overlays, не overlay сам по собі. Прод-перезаписи живуть у `ru/` / `ua/` / `prod/` тощо, що підключають Component через `components:`. Додано ранній return за `kind: Component` у `npm/scripts/check-k8s.mjs`; уточнення додано до `npm/mdc/k8s.mdc` і регресійний тест у `npm/tests/check-k8s-schema.test.mjs`.

## [1.8.219] - 2026-05-09

### Added

- **skill `n-llm-patch`:** наповнено `npm/skills/llm-patch/SKILL.md` (та дзеркальну копію `.cursor/skills/n-llm-patch/SKILL.md`). Скіл готує самодостатній текстовий промпт для іншого Claude/Cursor-агента у цільовому проєкті: read-only аналіз CWD (`package.json`, `tree -L 2`, `README`, релевантні конфіги), формування єдиного markdown-блоку за шаблоном `Завдання → Контекст → Релевантні файли → Що треба зробити → Обмеження → Як перевірити`. Цільова LLM — Claude / Cursor agent; жодних змін у поточному репо, тимчасові артефакти — лише у `/tmp`.

### Changed

- **k8s / check-k8s:** канонічна структура HPA/PDB — через **Kustomize Component** з фіксованою назвою каталогу `components/` (sibling до `base/`). У `base/` HPA і PDB не існує: ні локальних `hpa.yaml` / `pdb.yaml`, ні через `resources` / `components`. Overlays підключають `components: [- ../components]` і додають JSON6902-патчі для прод-значень `/spec/minReplicas`, `/spec/maxReplicas`, `/spec/minAvailable`. Для кожного `Deployment` у `…/k8s/…/base/` тепер вимагається sibling каталог `…/k8s/…/components/` з валідним `kustomization.yaml` (`kind: Component`), `hpa.yaml` (dev-like `min=max=1`) і `pdb.yaml` (dev-like `minAvailable=0`).
- **k8s / check-k8s:** заборона локальних `base/hpa.yaml` і `base/pdb.yaml` (file-existence для обох). Якщо в дереві base-kustomize лишилися HPA або PDB через `resources` / `components` — fail (`HPA/PDB заборонені у base — переведіть у components/`).
- **k8s / check-k8s:** прод-overlay тригерить вимоги патчів `/spec/minReplicas`, `/spec/maxReplicas` (HPA), `/spec/minAvailable` (PDB), коли overlay-tree містить HPA/PDB (тобто overlay підключив `components/`).
- **k8s.mdc:** оновлено опис, приклади `components/kustomization.yaml`, `components/hpa.yaml`, `components/pdb.yaml` і прикладу прод-overlay із `components: [- ../components]` + JSON6902-патчами.

### Removed

- **k8s / check-k8s:** прибрано застарілий механізм `$patch: delete` для HorizontalPodAutoscaler у `base/kustomization.yaml`. Видалено функції `verifyK8sBaseKustomizeHpaDeletedWhenInherited`, `kustomizationDeclaresHpaStrategicDelete`, `patchTextDeclaresHpaStrategicDelete` і константи-регекспи `HPA_STRATEGIC_DELETE_RE`, `HPA_KIND_LINE_RE` як мертві. Відповідні тести оновлено / видалено.

## [1.8.218] - 2026-05-09

### Added

- **auto-skills:** `llm-patch` додано як always-on скіл (без секції `[rules]` в `npm/bin/auto-skills.md`). Оновлено `AUTO_SKILL_ORDER` і `ALWAYS_ON_SKILLS` у `npm/scripts/auto-skills.mjs` та відповідні очікування у `npm/tests/auto-skills.test.mjs`. Сам вміст `npm/skills/llm-patch/SKILL.md` поки лишається стартовим — наповнюється окремо.

## [1.8.217] - 2026-05-09

### Added

- **js-run / conn-нейминг:** префікс `mssql-` тепер прийнятний у `src/conn/` нарівні з `mysql-` (`mssql-read.js`, `mssql-write-<id>.js` тощо). Сам npm-пакет `mssql` і раніше згадувався у правилі (як драйвер для MS SQL Server), але філенейм ставився під спільний `mysql-` префікс — це плутало читачів коду, де `import sql from 'mssql'` сусідив з файлом `mysql-write.js`. Тепер MSSQL має власний префікс із власним camelCase-експортом (`mssql-write-b2b` → `mssqlWriteB2b`). **Backward-compat:** проєкти, що вже використовують `mysql-…` для MSSQL-файлів, валідні без змін; рекомендований, але не обов'язковий рефактор — `git mv` цих файлів на `mssql-…` і відповідне перейменування іменованого експорту (`mysqlWrite` → `mssqlWrite`) зі оновленням імпортів через `#conn/*`.
- Регекс `CONN_FILENAME_RE` у `npm/scripts/utils/conn-file-rules.mjs` розширено до `(pg|mysql|mssql)-(read|write)(-<id>)?`; повідомлення про порушення в `npm/scripts/check-js-run.mjs` оновлено під чотири альтернативи; `mdc/js-run.mdc` має окремі пункти для MySQL і MSSQL.
- Тести: `npm/tests/conn-file-rules.test.mjs` (юніт-тести `isConnFileNameValid` / `kebabToCamel` / `findConnFileRuleViolations` під `mssql-`) та два інтеграційні кейси у `npm/tests/check-js-run-fixture.test.mjs` (`mssql-write.js` з валідним і невалідним експортом).

## [1.8.216] - 2026-05-09

### Changed

- **k8s / check-k8s:** орієнтир **`DEFAULT_CONTAINER_MEMORY_REQUEST`** поза base — **`512Mi`** (замість **`512`**).

## [1.8.215] - 2026-05-09

### Changed

- **k8s / check-k8s:** канон **`resources.requests.memory`** у шарі **`…/k8s/…/base/…`** — **`128Mi`** (замість **`128`**, щоб відповідати Quantity у Kubernetes); приймається **`Mi`** без урахування регістру.

## [1.8.214] - 2026-05-09

### Fixed

- **k8s / check-k8s:** конвертація image-replace patches → `images:` падала з `byPatch.keys(...).toSorted is not a function` (а в `rewriteInlinePatchWithoutOps` — з `(intermediate value).toSorted is not a function`), бо `Map.keys()` повертає ітератор, а `Set` — не масив, і `toSorted` на них немає. Тепер ключі/елементи матеріалізуються у масив через spread (`[...byPatch.keys()].toSorted(...)`, `[...new Set(opIndices)].toSorted(...)`).

### Changed

- **k8s / check-k8s:** у шарі **`…/k8s/…/base/…`** для **Deployment** жорстко **`resources.requests.cpu: '0.02'`** та **`memory: '128'`**; поза base обов’язкові **cpu** і **memory** (орієнтир **`0.5`** / **`512`** у підказках).
- **k8s / check-k8s:** заборона **`hpa.yaml`** у каталозі **`…/base/`**; якщо HPA є в дереві base — вимагається strategic-merge **`$patch: delete`** для **HorizontalPodAutoscaler** у **`base/kustomization.yaml`**.
- **k8s / check-k8s:** прод-оверлей вимагає patches на **HPA** (`minReplicas`/`maxReplicas`) лише якщо успадковане base **не** видаляє HPA через delete-patch; **PDB** **`minAvailable`** — якщо в base є PDB.
- **k8s.mdc:** оновлено правила та приклади під цю модель.

## [1.8.213] - 2026-05-09

### Added

- Нове правило `js-bun-redis` (`npm/mdc/js-bun-redis.mdc`): заміна `ioredis` /
  `node-redis` (включно з кореневим `redis` v4 і підпакетами `@redis/*`) на
  Bun native Redis (`import { redis } from 'bun'`,
  <https://bun.com/docs/runtime/redis>).
- AST-сканер `npm/scripts/utils/redis-imports.mjs` (`oxc-parser`) ловить
  `import` / `require` / динамічний `import()` пакетів `ioredis`, `node-redis`,
  `redis`, підшляхів `ioredis/...` / `redis/...` і `@redis/*`. Не зачіпає
  сторонні `redis-*` (наприклад, `redis-mock`).
- `npm/scripts/check-js-bun-redis.mjs` запускає AST-скан по JS/TS-джерелах і
  доступний як `npx @nitra/cursor fix js-bun-redis`.
- Rego-полісі `npm/policy/js_bun_redis/package_json/` — заборона
  `ioredis` / `node-redis` / `redis` / `@redis/*` у `dependencies` будь-якого
  `package.json` у дереві; зареєстрована таргетом у
  `npm/scripts/lint-conftest.mjs` (`bun run lint-conftest`).
- Авто-увімкнення правила в `.n-cursor.json`: `npm/scripts/auto-rules.mjs`
  додає `js-bun-redis`, якщо в `dependencies` хоч одного `package.json` є
  `ioredis` або `node-redis` (умова — у `npm/bin/auto-rules.md`).
- Тести: `npm/tests/redis-imports.test.mjs` (AST-сканер) і нові кейси у
  `npm/tests/auto-rules.test.mjs` (детект `ioredis` / `node-redis`).

## [1.8.212] - 2026-05-08

### Changed

- `npm/skills/taze/SKILL.md`: повний workflow замість шаблону-заглушки. Тепер
  скіл бекапить `package.json`/`bun.lock`, виконує `bunx taze -w -r latest` +
  `bun install`, виявляє major-стрибки порівнянням з бекапом, тягне breaking
  changes з CHANGELOG модуля або git-діфу `node_modules` (з фолбеком на
  встановлення старої версії в `/tmp`), шукає використання зачепленого API в
  коді через `rg`, рефакторить несумісні місця (нетривіальні міграції — TODO),
  прибирає тимчасові файли і віддає структурований звіт користувачу.

## [1.8.211] - 2026-05-08

### Added

- Окремий шлях автодетекту для скілів — `npm/bin/auto-skills.md` +
  `npm/scripts/auto-skills.mjs` (`detectAutoSkills`). Скіли отримують свій
  словник умов (`skill - [rules]`), залежний від уже виявлених правил, тож не
  дублюють файлові ознаки з `auto-rules.md`.
- Нові авто-скіли: `publish-telegram` (завжди) і `taze` (за правилом `bun`).
- `npm/tests/auto-skills.test.mjs` — окремі тести `detectAutoSkills`
  (завжди-додавані, залежності від rule-id, `disable-skills`, фільтр за
  `availableSkills`).

### Changed

- `npm/scripts/auto-rules.mjs`: `detectAutoRulesAndSkills` → `detectAutoRules`
  (повертає лише `{ rules }`); прибрано `AUTO_SKILL_ORDER` і скіл-логіку.
  `mergeConfigWithAutoDetected` лишається спільним і приймає вже виявлені
  rules+skills, тож публічний контракт `.n-cursor.json` не змінився.
- `npm/bin/n-cursor.js` тепер послідовно викликає `detectAutoRules` і
  `detectAutoSkills` (скіли отримують `detectedRules` як вхід).
- `npm/bin/auto-rules.md` залишає тільки правила; секція скілів винесена в
  `auto-skills.md` з посиланням з `auto-rules.md`.

## [1.8.210] - 2026-05-08

### Added

- `js-bun-db` v1.6: правило тепер забороняє локальні pg-format-сумісні шими у
  файлах з Bun SQL.
  - Розділ `## pg-format: повне видалення, без шимів` у `npm/mdc/js-bun-db.mdc`:
    типові ідіоми `format(...)` → tagged template, заборонений drop-in `format()`
    і `pg`-сумісна `query(text, params)`-обгортка над `sql.unsafe(...)`.
  - Два нові AST-детектори у `npm/scripts/utils/bun-sql-scan.mjs`:
    `findPgFormatShimDefinitionInText` (функції `format` / `pgFormat` /
    `sqlFormat` / `pgFmt` з `%L`/`%I`/`%s` у тілі, плюс `quoteLiteral` /
    `quoteIdent` / `escapeLiteral` / `escapeIdent` без додаткової перевірки)
    та `findPgFormatLikeQueryWrapperInText` (`{ query(text, params) { ...
<obj>.unsafe(...) ... } }`). Скан запускається лише у файлах з
    `import { sql|SQL } from 'bun'`.
  - `npm/scripts/check-js-bun-db.mjs` рапортує `pgFormatShim` / `queryWrapper` —
    окремі лічильники й `pass`-рядки, без зміни існуючих перевірок.

## [1.8.209] - 2026-05-08

### Removed

- Дедуплікація JS-перевірок, що вже покриті Rego-полісі (запускаються через
  `bun run lint-conftest`):
  - `npm/scripts/check-bun.mjs` — без `checkBunfigHoisted`, `checkDevDependencies`,
    `checkLintAggregate`, перевірок `pkg.packageManager` і кореневого
    `pkg.dependencies`. Лишилася FS-existence (`bun.lock`, `bunfig.toml`,
    `package.json`, заборонені lockfile, директорія `.yarn/`) і cross-file гейт
    `lint-docker` / `lint-k8s` від `.n-cursor.json:rules`.
  - `npm/scripts/check-php.mjs` — без перевірок `lint-php` скрипта і `run` у
    `lint-php.yml`. Лишилися FS-existence для `composer.json`, `package.json`,
    `lint-php.yml`.
  - `npm/scripts/check-style-lint.mjs` — без перевірок `lint-style` через
    `npx stylelint`, `@nitra/stylelint-config` у `devDependencies`,
    `stylelint.extends`, `npx stylelint` у `lint-style.yml`. Лишилися VSCode-
    конфіги, `.stylelintignore`, FS-existence workflow і альтернатива зовнішнього
    конфіг-файлу `stylelint`.
  - `npm/scripts/check-graphql.mjs` — без `checkPackageDumpSchemaScript` (структура
    `scripts.dump-schema`); решта логіки (gql AST-скан, `.graphqlrc.yml`,
    VSCode-розширення) лишилася.
  - `npm/scripts/check-image-compress.mjs` — без `checkLintImageScript`,
    `checkLintAggregateIncludesImage`, `checkMinifyImageNotInDeps`. Лишилися
    `.n-minify-image.tsv` НЕ в `.gitignore` і видалення застарілого
    `.minify-image-cache.tsv`.
  - `npm/scripts/check-js-bun-db.mjs` — без `checkForbiddenDependencies`
    (`pg`/`pg-format`/`mysql2`); AST-скан коду (`new SQL(...)` всередині функції,
    `unsafe()` без маркера, динамічні `IN (…)`) лишився.
  - `npm/scripts/check-text.mjs` — без `checkOxfmtRc`, `checkCspellConfig`,
    `checkCspellJsonDictImports`, `checkMarkdownlintConfig`, `prettier`/`@nitra/cspell-dict`/`markdownlint-cli2`/`@nitra/*` гейт у
    `checkPackageJsonTextDepsUsage`. Лишилися VSCode-конфіги, `.v8rignore`,
    Prettier-файли в корені, абзац про український апостроф у `.mdc`,
    складна валідація скрипта `lint-text` і виклик `bun run lint-text` у
    workflow.
  - `npm/scripts/check-vue.mjs` — без `checkViteVersion` (vite ≥ 8). AST-скан коду
    і vite-config-перевірки лишилися.
  - `npm/scripts/check-npm-module.mjs` — без `checkNpmTypesField`,
    `emitTypesConfigIssues`, перевірок полів `npm-publish.yml`,
    `workspaces ∋ "npm"` у кореневому `package.json`. Лишилися FS-existence,
    наявність файлу зі шляху `types`, hk.pkl-перевірки, CHANGELOG-version-match,
    git-dirty-bump.
  - `npm/scripts/check-js-lint.mjs` — без `checkPackageJsonLintDeps`
    (prettier-залежність, `@nitra/eslint-config ≥ 3.9.2`),
    `checkPackageJsonTypeModule` для root, `checkEnginesNode/Bun` для root,
    канонічний `lint-js`-скрипт, валідація `lint-js.yml` (`verifyLintJsWorkflowStructure`
    - fallback). Лишилися — `.oxlintrc.json` canonical-snapshot, VSCode-розширення,
      workspace-ітерація для `type: "module"` і engines, дубль JS-кроків у `lint.yml`,
      `.jscpd.json`. Прибрано непотрібні імпорти `parseWorkflowYaml`,
      `verifyLintJsWorkflowStructure` і `OXLINT_FIX_RE`.
  - `npm/scripts/check-js-run.mjs` — без перевірок `bunyan` / `@nitra/bunyan` у
    залежностях, canonical `jsconfig.json` через `deepEqualJson`,
    `OTEL_RESOURCE_ATTRIBUTES` у `configmap.yaml`. Лишилися AST-скан коду
    (bunyan, conn-aliases, process.env, setTimeout) і FS-existence для
    `jsconfig.json` / `configmap.yaml`. Прибрано `CANONICAL_BACKEND_JSCONFIG`,
    `deepEqualJson`.
  - `npm/scripts/check-adr.mjs` — без `settingsHaveAdrHookGroup`,
    `checkProjectSettings` структурного порівняння і
    `checkLocalSettingsNoDuplicate`. Лишилися hash-порівняння bash-скрипта,
    `.gitignore`-патерн, LLM CLI у PATH, FS-existence settings.json.
    Прибрано `HOOK_COMMAND_MARKER`, `PROJECT_LOCAL_SETTINGS_PATH` (для
    settings.local — Rego policy gating).
  - `npm/scripts/check-ga.mjs` — без `verifyConcurrencyBlock`,
    `verifyNoDirectBunOrCache`, `verifyNoRunShellLineContinuationBackslash`,
    `verifyCheckoutBeforeLocalSetupBunDeps`, `validateConcurrencyOnRoot`. Тепер
    усі workflow-структурні перевірки виконуються через conftest у `lint-ga.mjs`
    (`ga.workflow_common`); лишилася лише git-залежна перевірка `on.*.paths`
    glob-ів через `git ls-files :(glob)`. Прибрано константи
    `SETUP_BUN_PATTERNS`, `FORBIDDEN_BUN_PATTERNS`, `EXPECTED_CONCURRENCY_GROUP`
    і непотрібні імпорти з `gha-workflow.mjs`.

### Changed

- Тести `check-bun.test.mjs`, `check-image-compress.test.mjs`,
  `check-js-bun-db.test.mjs`, `check-js-run-fixture.test.mjs`,
  `check-adr.test.mjs` — прибрано / `skip` тести, що дублювали Rego-полісі;
  лишилися лише FS / cross-file сценарії.
- `npm/policy/{capacitor,js_mssql,abie,k8s,hasura}/**/*.rego` — у заголовках
  policy-файлів додано позначку, що JS-чек у відповідному `check-*.mjs`
  лишається authoritative (повна semver-семантика з OR-діапазонами для
  `capacitor`/`js-mssql`; ширший набір полів і cross-file Kustomize-контекст
  для `abie`/`k8s`; cross-file env-DNS-резолюція для `hasura`). Rego там — швидкий
  гейт для одиничного файлу (наприклад через IDE).

## [1.8.208] - 2026-05-08

### Added

- `mdc/js-run.mdc` (1.6, з 1.5): новий розділ «Нейминг файлів у `src/conn/`» — префікси `ql-` (GraphQL endpoint), `pg-`/`mysql-` з обовʼязковим `read`/`write` режимом і опційним ідентифікатором підключення для multi-БД (`pg-read-smart.js`, `pg-write-contract.js`); якщо режим не очевидний з імені env — визначати за наявністю операцій зміни даних. Також правило про експорти в `src/conn/`: заборонено `export default`, лише іменований експорт у camelCase від назви файла (`ql-smart.js` → `export const qlSmart`, `pg-write-contract.js` → `export const pgWriteContract`).
- `scripts/utils/conn-file-rules.mjs` + інтеграція в `scripts/check-js-run.mjs` — для кожного файла всередині `#conn/` каталогу пакета перевіряє: (а) basename відповідає канону `ql-<id>` / `(pg|mysql)-(read|write)[-<id>]` (kebab-case `[a-z0-9-]`); (б) відсутній `export default`; (в) серед іменованих експортів є рівно `<camelCase(basename)>` (`pg-write-contract.js` → `pgWriteContract`). `index.*` пропускається як reexport-барель. Розпізнає `export const/let/var`, `export function`, `export class` і `export { x as Y }` через AST на oxc-parser.

## [1.8.207] - 2026-05-08

### Added

- `npm/policy/ga/workflow_common/workflow_common.rego` — універсальні Rego-перевірки для **кожного** `.github/workflows/*.yml`: блок `concurrency` (group / cancel-in-progress), заборонені `oven-sh/setup-bun` / `actions/cache` / `bun install` у `uses`/`run` будь-якого кроку, заборонене shell-продовження `\` перед NL у `run:`, обовʼязковий `actions/checkout@…` перед локальним composite-action `setup-bun-deps`. Підключено в `lint-ga.mjs` як один прогін `conftest test <…all yml…> --namespace ga.workflow_common`.
- `npm/policy/bun/{bunfig,package_json}/*.rego` — порт `check-bun.mjs` (TOML і JSON-частина): `[install].linker == "hoisted"` у `bunfig.toml`; у кореневому `package.json` без `packageManager`, без `dependencies`, у `devDependencies` лише `@nitra/*`; агрегований `lint`-скрипт покриває всі `lint-*` через `bun run` і завершується `&& oxfmt .`.
- `npm/policy/text/{oxfmtrc,cspell,markdownlint,package_json}/*.rego` — порт `check-text.mjs`: `.oxfmtrc.json` обовʼязкові ключі і канонічні значення; `.cspell.json` `version "0.2"`, `language`, імпорт `@nitra/cspell-dict`, заборона `@cspell/dict-*`, обовʼязкові `ignorePaths`; `.markdownlint-cli2.jsonc` `gitignore: true`; `package.json` без Prettier, `@nitra/cspell-dict ^2.0.0+`, без `markdownlint-cli2` у залежностях.
- `npm/policy/style_lint/{package_json,lint_style_yml}/*.rego` — порт `check-style-lint.mjs`: скрипт `lint-style` через `npx stylelint`, `@nitra/stylelint-config` у `devDependencies`, `stylelint.extends == "@nitra/stylelint-config"`; у `lint-style.yml` хоча б один `run` з `npx stylelint`.
- `npm/policy/php/{package_json,lint_php_yml}/*.rego` — порт `check-php.mjs`: скрипт `lint-php` у `package.json`; у `lint-php.yml` хоча б один `run` з `bun run lint-php`.
- `npm/policy/npm_module/{root_package_json,npm_package_json,emit_types_config,npm_publish_yml}/*.rego` — порт `check-npm-module.mjs`: `workspaces ∋ "npm"` у кореневому `package.json`; у `npm/package.json` `types` відповідає одному з канонічних патернів і `files ∋ "types"`; `npm/tsconfig.emit-types.json` має канонічні `compilerOptions`; `.github/workflows/npm-publish.yml` має `on.push.paths ∋ "npm/**"`, `branches ∋ "main"`, `permissions.id-token: write` і крок `JS-DevTools/npm-publish` з `with.package: npm/package.json`.
- `npm/policy/k8s/manifest/manifest.rego` — порт пер-документних структурних правил `check-k8s.mjs`: `kind: Ingress` заборонено (Gateway API), `apiVersion: autoscaling/v1` заборонено (HPA → v2), у `kind: Service` заборонені анотації `cloud.google.com/neg` / `cloud.google.com/backend-config`, у `kind: Deployment` кожен контейнер `containers`+`initContainers` має непорожнє `resources.requests.cpu`. Cross-file Kustomize-логіка (svc/svc-hl, HPA/PDB, namespace base, kustomization patches) лишається в JS.
- `npm/policy/js_lint/{package_json,lint_js_yml}/*.rego` — порт `check-js-lint.mjs`: канонічний `lint-js`, `@nitra/eslint-config ≥ 3.9.2`, `engines.node ≥ 24`, `engines.bun ≥ 1.3`, `type: "module"`; у `lint-js.yml` `actions/checkout@v6` з `persist-credentials: false`, `setup-bun-deps`, `bunx oxlint/eslint/jscpd .`, без `--fix` у CI.
- `npm/policy/js_mssql/package_json/package_json.rego` — порт `check-js-mssql.mjs`: `dependencies.mssql ≥ 12.5.0` (підтримує `^12.5.0`, `>=12.5.0`, `workspace:*`).
- `npm/policy/js_bun_db/package_json/package_json.rego` — порт `check-js-bun-db.mjs`: у `dependencies` заборонені `pg`, `pg-format`, `mysql2`.
- `npm/policy/js_run/{package_json,jsconfig,configmap}/*.rego` — порт `check-js-run.mjs`: заборона `bunyan` / `@nitra/bunyan` у залежностях; `jsconfig.json` має канонічні `compilerOptions` і `include`; у k8s ConfigMap `OTEL_RESOURCE_ATTRIBUTES` містить `service.name=` і `service.namespace=`.
- `npm/policy/vue/package_json/package_json.rego` — порт `check-vue.mjs`: якщо `dependencies.vue` присутній, у `devDependencies` має бути `vite` мажорної версії ≥ 8.
- `npm/policy/graphql/package_json/package_json.rego` — порт `check-graphql.mjs`: `scripts.dump-schema` точно відповідає канонічному.
- `npm/policy/image_compress/package_json/package_json.rego` — порт `check-image-compress.mjs`: `lint-image` викликає `npx @nitra/minify-image --src=. --write` без `--avif`; агрегований `lint` містить `bun run lint-image`; `@nitra/minify-image` НЕ у `dependencies`/`devDependencies`.
- `npm/policy/hasura/svc_hl/svc_hl.rego` — порт `check-hasura.mjs` (мінімум): у `hasura/k8s/base/svc-hl.yaml` Service з `metadata.name` має закінчуватись на `-h`.
- `npm/policy/adr/{settings_json,settings_local_json}/*.rego` — порт `check-adr.mjs`: `.claude/settings.json` має містити Stop-hook з командою `.claude/hooks/capture-decisions.sh`; `.claude/settings.local.json` (якщо існує) — НЕ повинен мати дубля цього хука.
- `npm/policy/capacitor/package_json/package_json.rego` — порт `check-capacitor.mjs`: `dependencies['@capacitor/core']` мажорна ≥ 8 (підтримує `workspace:*`).
- `npm/policy/abie/{health_check_policy,http_route_base}/*.rego` — порт `check-abie.mjs`: `HealthCheckPolicy` (`networking.gke.io/v1`) має непорожній `requestPath` зі слешем, `port: 8080`, `targetRef.name` закінчується на `-hl`; `HTTPRoute` у `…/base/…` приймає лише hostnames у домені `aiml.live`.
- `npm/scripts/lint-conftest.mjs` (+ `bun run lint-conftest` у `package.json`) — єдиний раннер conftest по всіх нових polysi: для кожного namespace — single-file або walk-предикат, з gating-ом по `.n-cursor.json:rules`, як у `check-*.mjs`. Викликається в кореневому `lint` після `lint-rego`.

### Changed

- `npm/policy/ga/{lint_ga,clean_ga_workflows,clean_merged_branch,git_ai}/*.rego`: прибрано дублікати правил `concurrency` (group / cancel-in-progress / missing) — їх покриває `ga.workflow_common`. Заодно усунено мовчазний баг `not is_object(input.concurrency)` (коли поля немає, повертає `undefined`, не `true`); у `workflow_common` через `object.get(input, "concurrency", false)` дає визначене значення. Канонічна тригер-група `expected_concurrency_group` теж видалена з кожної per-workflow polysi.
- `npm/scripts/lint-ga.mjs`: до існуючих per-workflow conftest-таргетів додано фінальний прогін `ga.workflow_common` одним викликом `conftest test <усі .yml> --namespace ga.workflow_common`. Імпорт `readdirSync` з `node:fs` для перерахунку workflow-файлів.

## [1.8.206] - 2026-05-08

### Added

- `mdc/rego.mdc` (нова версія 1.1, з 1.0): VS Code-секція з рекомендованим розширенням `tsandall.opa` (LSP від автора OPA: підсвічування, hover, go-to-definition, format-on-save через `opa fmt`), `.vscode/extensions.json` і `.vscode/settings.json` сніпети для `[rego]` (`editor.defaultFormatter: tsandall.opa`, `formatOnSave: true`); опис кроків `lint-rego` (preflight `opa`+`regal`, далі `opa check --strict` і `regal lint`); `package.json`-сніпет зі скриптом `lint-rego`; install-команди (`brew install opa regal` + universal лінки); приклад `.regal/config.yaml`. Раніше файл містив лише placeholder `npx @nitra/cursor fix rego`.

### Changed

- `scripts/lint-rego.mjs`: додано preflight на `opa` (поряд з `regal`) з install-hint `brew install opa` і покликом до VS Code-розширення `tsandall.opa`; до `regal lint` додано попередній крок `opa check --strict <targets>` (типи + строгий режим: мертвий код, неоднозначні правила, незадекларовані змінні) — `opa check` ловить compile-помилки, які `regal` навмисно лишає поза скоупом. Якщо хоч один з `opa`/`regal` відсутній у `PATH` — exit 1 ще до запуску, з підказкою встановлення для обох.

## [1.8.205] - 2026-05-08

### Added

- `npm/policy/ga/lint_ga/lint_ga.rego` — порт `validateLintGaWorkflowStructure` + `validateLintGaOnTriggers`: `name` / `on.push.branches∋{dev,main}` / `on.pull_request.branches∋{dev,main}` / `on.push.paths∋{.github/actions/**,.github/workflows/**}` / `concurrency` / `jobs.lint-ga.runs-on` / `jobs.lint-ga.permissions.contents=read` / `steps` non-empty / `uses` set містить `actions/checkout@v6`, `./.github/actions/setup-bun-deps`, `astral-sh/setup-uv@v8.0.0` / `run` blob містить `bun run lint-ga`.
- `npm/policy/ga/git_ai/git_ai.rego` — порт `validateGitAiWorkflowStructure`: `name` / `on.pull_request.types∋closed` / `concurrency` / `jobs.git-ai.if` містить `merged == true` / `permissions.contents=write` / `run` blob містить `curl … usegitai.com … bash` і `git-ai ci github run`.

### Changed

- `scripts/lint-ga.mjs`: `CONFTEST_TARGETS` тепер охоплює всі 4 канонічні GA-workflow — `clean-ga-workflows.yml`, `clean-merged-branch.yml`, `lint-ga.yml`, `git-ai.yml` — кожен зі своїм `--namespace ga.<name>`.
- `scripts/check-ga.mjs`: видалено `validateLintGaWorkflowStructure`, `validateLintGaOnTriggers`, `validateGitAiWorkflowStructure`, `validateGitAiParsedYaml`, `hasPullRequestClosedTrigger`, `hasJobMergedCondition`, `checkLintGaWorkflow`, `checkGitAiWorkflow`, `checkCanonicalWorkflowsMatchRule`, локальний `isExactString` і відповідні імпорти `anyRunStepIncludes`/`flattenWorkflowSteps`/`getStepRun`/`getStepUses`. Файл скоротився з 1074 → 570 рядків (≈47%) — структурні перевірки канонічних GA-workflow повністю мігрували в conftest. У JS лишилися: file-existence (zizmor.yml, .vscode/settings.json, setup-bun-deps), `package.json` script `lint-ga`, MegaLinter-зачистка, `verifyConcurrencyBlock` для всіх workflow без винятків (включно з не-канонічними), `verifyNoDirectBunOrCache`, `verifyCheckoutBeforeLocalSetupBunDeps`, paths-globs через `git ls-files`, preflight `shellcheck`.

## [1.8.204] - 2026-05-07

### Changed

- Реструктурував `npm/policy/ga/` під namespaced sub-packages, які проходять regal: `ga/clean_ga_workflows/clean_ga_workflows.rego` та новий `ga/clean_merged_branch/clean_merged_branch.rego` (порт `validateCleanMergedBranch` з check-ga.mjs — `name` / `cron 0 1 15 * *` / `workflow_dispatch` / `concurrency` / `jobs.cleanup_old_branches` / step0 `phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3` з token / age=90 / ignore_branches main,dev / `dry_run: false` (YAML 1.1) / step1 `Get output` + `DELETED_BRANCHES` env + echo).
- `scripts/lint-ga.mjs`: `CONFTEST_TARGETS` тепер містить `clean-ga-workflows.yml` і `clean-merged-branch.yml`, conftest викликаємо з `--namespace ga.<name>` для ізоляції правил між workflow.
- `scripts/check-ga.mjs`: видалено `validateCleanGaWorkflows*` і `validateCleanMergedBranch*` — їх повністю покриває conftest у `lint-ga`. `checkCanonicalWorkflowsMatchRule` тепер валідує лише `lint-ga.yml` і `git-ai.yml` (наступні кандидати на міграцію).

### Added

- `.regal/config.yaml` у корені — вимикає `idiomatic.no-defined-entrypoint` (для conftest-полісі `deny`-правила є де-факто entrypoint-ами, формальна анотація не несе семантики).

## [1.8.203] - 2026-05-07

### Changed

- `check-k8s.mjs` (автоконверт `image-replace` patches → `images:`): тепер працює і для `patches[i].patch` із **кількома** ops, а не лише з одинокою image-replace op. Сканує всі ops у патчі, конвертує **кожну** `op: replace` на `/spec/template/spec/containers/<N>/image` (target `kind: Deployment`) у запис `images:`; якщо всі ops патча конвертовано — `patches[i]` видаляється повністю; інакше inline `patch:` переписується через `parseDocument` без конвертованих ops зі збереженням block-literal scalar (`|-`) і вихідного порядку решти ops. Реалізовано через нові функції `tryParseJson6902Array` (≥ 1 op, замість `tryParseSingleJson6902Array`) і `rewriteInlinePatchWithoutOps`; `imageReplaceDeploymentPatchInfo` повертає `{ deployName, totalOps, ops: [{ containerIndex, newImage, opIndex }] }` (раніше — одиничний `{ deployName, containerIndex, newImage }` лише за `length === 1`); `applyConversionsToDoc` групує конвертації по індексу патча й вирізає ops або сам патч за потреби. Сортування решти ops після видалення лишається поза цією зміною — за нього відповідає окрема перевірка `kustomizationInlinePatchOpsSortedViolation`.
- `mdc/k8s.mdc` (v1.26 → v1.27): уточнено крок 1 авто-перевірки в розділі «Зміна image — через `images:`, не через `patches[]`» — тепер описує і випадок, коли в `patches[i].patch` лишаються не-image ops (їх зберігає, у вихідному порядку, без коментарів).
- `check-js-lint.mjs` + `mdc/js-lint.mdc` (v1.16 → v1.17): мінімум `@nitra/eslint-config` піднято з `^3.8.0` до `^3.9.2`. Обґрунтування: з 3.9.2 у `getConfig` вбудовано ignore для `**/adr/**`, тож ADR-документи не валідуються ESLint, і консьюмерам не треба додавати цей glob у `eslint.config.js` локально. `nitraEslintConfigMeetsMinVersion` тепер повертає `false` для діапазонів `^3.8.x`–`^3.9.1`; `workspace:*` лишається ok без змін. Pass/fail-повідомлення `checkPackageJsonLintDeps` оновлено під новий мінімум; `for...in`-бан з 3.8.0 згадується як накопичена відмінність. Тести `nitraEslintConfigMeetsMinVersion` розширено: `^3.9.2`/`^3.9.10`/`^3.10.0`/`^4.0.0` — ok; `^3.9.1`/`^3.8.0`/`^3.6.12`/`^3.4.3` — ні.
- `bin/n-cursor.js` (`reexecIfPackageVersionChanged` + `spawnSync`-виклик): `process.env.NITRA_CURSOR_REEXEC` і `...process.env` замінено на `env.NITRA_CURSOR_REEXEC` і `...env` з `node:process` (`import { cwd, env } from 'node:process'`). Підстава: правило `js-run.mdc` забороняє прямий `process.env.*` у Node-коді; `NITRA_CURSOR_REEXEC` — опційна змінна (виставляється лише при re-exec), тож імпорт `env` з `node:process` (а не з `@nitra/check-env`) — канонічна форма для опційних. Поведінка не змінена; раніше `npm/scripts/check-js-run.mjs` помилявся на `bin/n-cursor.js:1136` (правило `process-env`), тепер integration-test `check-* на реальному репозиторії` проходить.

### Added

- `tests/check-k8s-images.test.mjs`: нова форма `imageReplaceDeploymentPatchInfo` (`ops`/`totalOps`/`opIndex`); e2e-тести на multi-op patch (image + `add nodeSelector`), три не-image ops + image у hasura-стилі (`add containers/-` + `add volumes` + `replace nodeSelector`), multi-image patch (containers/0 + containers/1 → обидва конвертовано, патч видаляється), mixed patch з digest у одному з image-values (звичайний tag конвертовано, digest op лишається у патчі) і одиничний digest-image (повертає `errors`, патч на диску не змінюється).

## [1.8.202] - 2026-05-07

### Added

- `bin/n-cursor.js`: новий хелпер `reexecIfPackageVersionChanged(effectivePackageRoot)` і його виклик у `runSync` одразу після `upgradeNitraCursorToLatestAndBunInstall`. Якщо self-upgrade встановив у `node_modules/@nitra/cursor` версію, відмінну від тієї, з якої стартував поточний процес (типово — npx-кеш), CLI спавнить `process.execPath <newBin> <args…>` через `spawnSync` (`stdio: 'inherit'`), додає в env `NITRA_CURSOR_REEXEC=1` і завершується з exit-кодом дочірнього процесу. Обґрунтування: ES-модулі (`RULE_MIGRATIONS`, `detectAutoRulesAndSkills`, списки правил) уже завантажені у V8 і нова логіка з-під свіжо встановленого пакета без re-exec невидима для поточного запуску — `import()` не вирішує цього, бо процес виконується з `bin/` у npx-кеші, а не з `node_modules/`. Захист від нескінченного циклу — раннє повернення при `process.env.NITRA_CURSOR_REEXEC === '1'`; додатково нічого не робить, якщо `effectivePackageRoot === BUNDLED_PACKAGE_ROOT` (реального апгрейду не сталося), якщо `version` не вдалося прочитати з обох `package.json`, або якщо у новому корені відсутній `bin/n-cursor.js`. `runChecks` свідомо не патчиться — він не виконує self-upgrade, тож версія процесу і пакета там завжди узгоджені. Імпорт `spawnSync` із `node:child_process` — єдина нова зовнішня залежність.

## [1.8.201] - 2026-05-07

### Changed

- `check-hasura.mjs`: `INTERNAL_HASURA_URL_RE` тепер приймає **обидва** кластерні DNS-суфікси у `HASURA_GRAPHQL_ENDPOINT` — `<cluster>.internal` (GKE/GCP, наприклад `abie-dev` / `abie-ua`) **і** `cluster.local` (стандартний k8s / Yandex Cloud). Раніше regex вимагав літеральний `.internal` у кінці, тож URL виду `http://apruv-h-hl.ru-apruv.svc.cluster.local:8080` (типовий для YC-кластера ru) помилково відхилявся. `parseInternalHasuraEndpoint` для YC повертає `cluster: 'cluster.local'` як повний суфікс, для GKE — ім'я кластера без `.internal` (зворотньо сумісно з попередньою поведінкою). Текст помилки в `checkEnvFile` оновлено — згадує обидва допустимі формати.
- `abie.mdc` (v1.17 → v1.19): нова секція «Внутрішньокластерні URL у env-файлах (dev / ua / ru)». Правило стосується **будь-якого** internal URL у env-файлах abie-проєкту — не лише `HASURA_GRAPHQL_ENDPOINT`, а й KVCMS, `auth-run-hl`, `file-link-hl` тощо. Таблиця `dev.env` / `ua.env` / `ru.env` → namespace-префікс + DNS-суфікс кластера (dev → `abie-dev.internal` + `dev-…`, ua → `abie-ua.internal` + `ua-…`, ru → `cluster.local` + `ru-…`); приклади з двома сервісами в одному файлі (Hasura + KVCMS). Загальне правило про **внутрішній** URL замість публічного домену для `HASURA_GRAPHQL_ENDPOINT` лишається у `hasura.mdc` (для nitra та abie).

### Added

- `check-abie.mjs`: новий валідатор `validateAbieEnvInternalUrls` (`String.prototype.matchAll` за `ABIE_INTERNAL_URL_GLOBAL_RE`) і helper `abieEnvNameFromBasename`. У функції `check()` додано крок `ensureAbieEnvFilesMatchClusterDns`, що сканує всі `*.env`-файли (basename `dev.env` / `ua.env` / `ru.env` опційно з провідною крапкою; `.env` без імені пропускається — як у `check-hasura.mjs`) і для **кожного** знайденого URL виду `http://<svc>.<ns>.svc.<dns>` перевіряє відповідність DNS-суфікса й namespace-префікса середовищу env-файла. Помилки додаються через `fail`, без зупинки на першому файлі — звіт показує всі порушення в усіх env-файлах одразу.
- `tests/check-hasura.test.mjs`: тести `parseInternalHasuraEndpoint` для GKE-style `abie-dev.internal` / `abie-ua.internal` та YC-style `cluster.local`; негативний кейс на сторонній суфікс (`svc.example.com`); інтеграційний тест `check()` для `hasura/.ru.env` з `cluster.local`.
- `tests/check-abie.test.mjs`: 7 unit-тестів на `abieEnvNameFromBasename` і `validateAbieEnvInternalUrls` (узгоджений dev/ua/ru, URL без порту, dev URL у ua-файлі, internal-суфікс у ru-файлі, ігнорування зовнішніх `https://` / `localhost`, кілька URL з різними порушеннями) і 4 інтеграційні (`.dev.env`+`.ua.env`+`.ru.env` узгоджені — 0; ua з dev URL у KVCMS — 1; ru з `.internal` замість `cluster.local` — 1; `.env` без імені пропускається).

## [1.8.200] - 2026-05-07

### Added

- `policy/ga/clean-ga-workflows.rego` + новий PoC-крок у `scripts/lint-ga.mjs`: запускає `conftest test` на `.github/workflows/clean-ga-workflows.yml` проти Rego-полісі (структура `name` / `on` / `concurrency` / `jobs.cleanup_old_workflows.steps[0]`). Якщо `conftest` не в PATH — `ℹ` skip без помилки (паралельні JS-перевірки в `check-ga.mjs` залишаються джерелом істини). Додав `policy` у `files` пакету.
- `check-k8s.mjs`: структурний сорт `patches[]` у `kustomization.yaml` за tuple `[target.kind, target.name, target.namespace, path]` (`localeCompare('en', base)`); поля `target.group` / `target.version` у tuple не входять (діє правило «patches[].target: лише kind і name»). Додатково: вміст inline `patches[i].patch` (literal block scalar — масив JSON6902) сортується за `path`, **але лише** коли всі ops — `add` / `replace` і всі `path` попарно дизʼюнктні (жоден не префікс іншого) — інакше порядок не чіпається, бо `move` / `copy` / `test` / `remove` чи спільні шляхи семантично залежні (RFC 6902). Експортовані чисті валідатори: `kustomizationPatchesSortedViolation`, `kustomizationInlinePatchOpsSortedViolation`.
- `tests/check-k8s-schema.test.mjs`: тести на обидва нові валідатори (приклад із `k8s.mdc`: `ReferenceGrant atlas/apruv` → `apruv/atlas`; `add /spec/minReplicas` + `replace /spec/maxReplicas` → пересорт за `path`; пропуск для `test` / `move` / `copy` / `remove` і недизʼюнктних шляхів типу `/spec` vs `/spec/template`).
- `mdc/k8s.mdc`: розділ «Структурний сорт `patches[]` і inline JSON6902» з обома прикладами «❌/✅».

## [1.8.199] - 2026-05-07

### Added

- `auto-rules.mjs`: автоматична міграція застарілих rule-id у `.n-cursor.json` через карту `RULE_MIGRATIONS`. Перший зареєстрований запис — `image` → `image-compress` + `image-avif` (split з 1.8.197). Застосовується і до `rules`, і до `disable-rules`, з дедуплікацією. CLI `n-cursor.js` логує `📦 Авто-міграція .n-cursor.json: image → image-compress, image-avif` перед нормалізацією, потім записує оновлений конфіг (як і раніше — лише якщо вміст реально змінився).
- `tests/auto-rules.test.mjs`: тести `migrateRuleIds` (порядок, дедуплікація, no-op для актуальних id), `detectLegacyRuleIds`, `mergeConfigWithAutoDetected` з legacy `image` у `rules`/`disable-rules`/конфлікті з `image-compress`.

### Changed

- `n-cursor.js`: розширено імпорт з `auto-rules.mjs` (`detectLegacyRuleIds`, `RULE_MIGRATIONS`); виокремлено хелпер `logRuleMigrationsIfAny` (читає сирий конфіг, виводить пояснення, не мутує — мутацію виконує `migrateRuleIds` усередині `mergeConfigWithAutoDetected`). Завдяки цьому `npx @nitra/cursor` сам перебиває `image` на пару наступників — користувачу не треба руками правити `.n-cursor.json`.

## [1.8.198] - 2026-05-07

### Changed

- `image-compress` (mdc v1.0 → v1.1): мінімум `@nitra/minify-image` піднято з **3.2.0** до **3.3.1**. У `3.3.1` upstream CLI порівнює sha1 raster-сорсу зі збереженим у `.n-minify-image.tsv` і автоматично перегенеровує `<source>.avif` при зміні контенту оригіналу — раніше stale `.avif` лишався поки розробник не видаляв його вручну. Додано пояснювальний абзац у правило.
- `image-avif` (mdc v1.0 → v1.1): крок 1 (`npx @nitra/minify-image --src=. --write --avif`) явно требує ≥ 3.3.1 і документує, що sha1-перевірка для регенерації застарілого AVIF тепер живе у CLI; `@nitra/cursor` цю логіку **не дублює**.

## [1.8.197] - 2026-05-07

### Changed

- `image` правило розщеплене на два самостійні: **`image-compress`** (валідація `lint-image` / `.gitignore` / залежностей — стиснення raster/SVG через `@nitra/minify-image`) і **`image-avif`** (генерація AVIF-двійників, переписування raster-посилань у `.vue`/`.html` на `.avif`, прибирання AVIF-сиріт). Це дозволяє тримати компресію всюди, а AVIF — лише там, де його підтримка гарантована (адмінки), вимикаючи його для публічних сайтів через `disable-rules: ["image-avif"]` у `.n-cursor.json` чи опт-аут на рівні пакета (`"@nitra/minify-image": { "disable-avif": true }` у `package.json` сайту).
- `auto-rules.md` / `auto-rules.mjs`: автодетект `image-compress - [bun]` (всюди, де є `package.json`), `image-avif - [vue, image-compress]` (лише для проєктів з `.vue`-файлами і вже активним `image-compress`).
- Видалено `npm/scripts/check-image.mjs` і `npm/mdc/image.mdc` — їх замінили `check-image-compress.mjs` + `check-image-avif.mjs` і `image-compress.mdc` + `image-avif.mdc`.
- Канонічний `lint-image` залишається без `--avif` (його перевіряє `image-compress`); `npx @nitra/cursor fix image-avif` тепер є самостійною командою для AVIF-pipeline.

### Added

- `tests/auto-rules.test.mjs`: тест на `disable-rules: ["image-compress"]` → `image-avif` теж не додається (транзитивна залежність).

## [1.8.194] - 2026-05-07

### Fixed

- `check-image.mjs`: резолвер `resolveImagePath` був інлайн-наївний (`/path` → `<cwd>/<path>`, голий шлях → `null`), що в реальних Quasar/Vite-проєктах давало 0 rewrite-ів і помилковий ріст `failedRefs`. Замінено на `resolveImageCandidates`, який повертає **впорядкований список кандидатів**:
  - `./x.png` / `../x.png` → відносно файла-джерела;
  - `/x.png` → `<packageRoot>/public/x.png`, потім `<packageRoot>/x.png`, потім `<cwd>/x.png` (legacy fallback);
  - голий шлях з принаймні одним `/` (`assets/img.png`, `start-page-ua/logo.png`) → відносно файла-джерела + `<packageRoot>/public/<path>` (Quasar-конвенція);
  - bare без `/` → alias resolver невідомий, посилання тихо пропускаємо (без fail).
- `check-image.mjs`: `cleanupOrphanAvifs` тепер пропускає `.avif` у каталогах артефактів збірки (`build`, `android`, `ios`, `.output`, `.nuxt`, `.cache`) — раніше cleanup міг затирати продукт `bun run build` чи Capacitor sync.

### Added

- `tests/check-image.test.mjs`: 4 нових кейси — Quasar-style `src="/api-page/1.png"` через `<pkg>/public/`; `<img src="assets/images/x.png">` у `.html` через relative-to-source; `src="start-page-ua/logo.png"` у `.vue` через `<pkg>/public/`; cleanup не чіпає AVIF у `build/`/`android/`/`ios/`/`.output/`/`.nuxt/`/`.cache/`.

## [1.8.193] - 2026-05-07

### Fixed

- `check-image.mjs`: cleanup AVIF-сиріт більше не зачіпає `.avif` файли всередині пакетів з опт-аутом (`"@nitra/minify-image": { "disable-avif": true }`). Раніше: пакет з опт-аутом не сканувався на refs → його `.avif` потрапляли у список «сиріт» і видалялись, навіть якщо насправді використовувалися через alias / runtime-обчислений шлях. Тепер `checkVueAvifImports` повертає список абсолютних коренів opt-out пакетів, а `cleanupOrphanAvifs` пропускає `.avif` під ними.
- `check-image.mjs`: запис у `.vue`/`.html` тепер строго послідовний з cleanup (write-then-cleanup): перший виконує `checkVueAvifImports` (per-file `writeFile` після обробки), і тільки після цього `cleanupOrphanAvifs` читає вже оновлені `usedAvifAbs` і видаляє лише дійсних сиріт.
- `check-image.mjs`: введено агреговані лічильники `RewriteStats` (`rewrittenRefs` / `rewrittenFiles` / `failedRefs`) і єдиний фінальний рядок-підсумок `image: rewrote N references in M files; deleted K orphan AVIFs; failed to rewrite L references` — раніше підсумок дублювався per-package і не виокремлював orphan-cleanup vs failed-rewrites.

### Added

- `tests/check-image.test.mjs`: 5 нових кейсів — статичний `<img src="a.png">` авто-переписується (за наявності `a.png` і `a.png.avif`); реактивне `:src="dyn"` залишається незмінним і orphan AVIF видаляється; змішані форми у одному файлі (статичний + import + реактивний + `data-src=`) — переписуються лише покривані; opt-out пакет — AVIF всередині не вважається сиротою; ідемпотентність повторного `check image` на чистому стані.

## [1.8.192] - 2026-05-07

### Added

- `run-shellcheck-text.mjs`: для `lint-text` — перевірка наявності `shellcheck`/`patch`, авто-виправлення через `shellcheck -f diff` + `patch -p1`, фінальний прогін по tracked `*.sh` (git) або `**/*.sh` без `node_modules`.
- `text` (mdc v1.25 → v1.26): **shellcheck** у ланцюжку `lint-text`, рекомендація **`timonwong.shellcheck`**, тригер workflow **`**/\*.sh`**; тести `run-shellcheck-text.test.mjs`.

### Changed

- `check-text.mjs`: `lint-text` має містити `run-shellcheck-text.mjs`; `extensions.json` — `timonwong.shellcheck`.

## [1.8.191] - 2026-05-07

### Added

- `check-npm-module.mjs`: перший заголовок **`## [version]`** у `npm/CHANGELOG.md` має збігатися з **`version`** у `npm/package.json` (найсвіжіший реліз зверху — Keep a Changelog); якщо є незакомічені зміни під **`npm/`**, `version` у робочому `npm/package.json` має відрізнятися від **`HEAD`** (інакше ризик дописати новий функціонал без bump).

### Changed

- `npm-module` (mdc v1.9 → v1.10): розширено **«Build версія»** і **«CHANGELOG»** — чеклист для агента, заборона дописувати нові пункти в уже існуючу секцію релізу замість нового номера; впорядковано `CHANGELOG` (1.8.190 перед 1.8.189).

## [1.8.190] - 2026-05-07

### Added

- `js-run` (mdc v1.4 → v1.5): секція **`jsconfig.json`** — канонічний файл для backend-пакетів із каталогом **`src/`** (NodeNext, `include: ['src/**/*']`); для пакетів без `src/` вимога не діє.
- `check-js-run.mjs`: перевірка наявності та вмісту `jsconfig.json`, якщо в workspace-пакеті (без vite) є **`src/`**; тести у `check-js-run-fixture.test.mjs`.

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

- `image` (mdc v1.4 → v1.5): прапорець `--avif` у `lint-image` тепер **заборонений** (інакше `bun run lint` плодив би `.avif` для зображень, що ніде не вживаються); канонічний `lint-image` — `npx @nitra/minify-image --src=. --write`. AVIF-генерацію виконує **виключно** `npx @nitra/cursor fix image`. Секцію «AVIF-імпорти у `.vue`» переписано: тепер вона документує триетапну логіку `check image` — (1) запуск `npx @nitra/minify-image --src=. --write --avif`, (2) авто-заміна raster-посилань у `.vue`/`.html` на `.avif` у кожному workspace-пакеті, (3) прибирання AVIF-сиріт (файли `.avif` без жодного посилання у `.vue`/`.html` видаляються — AVIF лишається лише там, де заміна реально вдалася).
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

- `ga.mdc` (v1.4) / `check-ga.mjs`: нова перевірка локального [`shellcheck`](https://www.shellcheck.net/) у `PATH`. Без нього `actionlint` (`bunx github-actionlint`) мовчки пропускає shell-перевірки в `run:` блоках, тож локальний `bun lint-ga` дає зелений результат, який падає в CI на `ubuntu-latest` (де shellcheck передвстановлений). `npx @nitra/cursor fix ga` тепер `fail` з підказкою встановлення (`brew install shellcheck` / `apt-get install -y shellcheck` / `pacman -S shellcheck`).

### Changed

- `utils/resolve-cmd.mjs`: явно передаємо `process.env` у `spawnSync('which'/'where', ...)`, щоб у Bun зміни `PATH` у runtime (наприклад, підстановка стабів у тестах) бачилися дочірнім процесом. Без цього Bun використовував би snapshot оточення на старті.

## [1.8.165] - 2026-05-01

### Changed

- `ga.mdc` / `check-ga.mjs`: лінт workflow-ів через [`github-actionlint`](https://www.npmjs.com/package/github-actionlint) замість `node-actionlint`. Канонічний скрипт `lint-ga` тепер `bunx github-actionlint && uvx zizmor --offline --collect=workflows .`; `check-ga` вимагає у `package.json` саме `github-actionlint`.

## [1.8.164] - 2026-05-01

### Added

- `abie.mdc` (v1.16) / `check-abie.mjs`: нова перевірка `.github/actionlint.yaml`. Якщо файл відсутній — `npx @nitra/cursor fix abie` створює його з канонічним вмістом (`self-hosted-runner.labels: ['ua', 'dev', 'ru']`); якщо є — звіряє, що в `self-hosted-runner.labels` присутні мітки `ua`, `dev`, `ru` (порядок, інші мітки й формат лапок дозволені). Експортовано `ABIE_REQUIRED_ACTIONLINT_LABELS`, `parseActionlintSelfHostedLabels`, `abieMissingActionlintLabels`.

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
