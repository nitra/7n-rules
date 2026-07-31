---
type: JS Module
title: build-wasm-plugins.mjs
resource: npm/scripts/build-wasm-plugins.mjs
docgen:
  crc: 7d280fcf
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Локальна dev-петля й CI-крок «зібрати first-party wasm-плагіни» (задача O1
фази 6 v2, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
§3.4, рішення Н) — для кожного крейта з [`FIRST_PARTY_WASM_PLUGINS`] спавнить
його `build.sh` (той самий генеричний build-скрипт, що й скіл `wasm-plugin`,
доккомент `crates/plugin-lang-js/build.sh`), копіює зібраний Component Model
`.wasm` у `npm/wasm-plugins/<package-name>.wasm` і генерує
`npm/wasm-plugins/builtin-pins.json` — вбудовану таблицю `name → {file,
sha256}`, яку `wasm-plugins.mjs` (`readBuiltinPinsConfig`) читає ПОРЯД із
модулем (шлях від `import.meta.url`, працює і в repo, і в installed-пакеті).

Запуск (вручну, з кореня `@7n/rules`):
  node npm/scripts/build-wasm-plugins.mjs

Той самий скрипт викликає CI-крок `npm-publish.yml` (build-native, ubuntu-рядок —
wasm-компонент платформо-незалежний, окремої матриці не потрібно) перед
`actions/upload-artifact`, і `release-publish` завантажує згенеровану теку
назад перед `npm publish npm/package.json`.

sha256 у `builtin-pins.json` рахується від байтів ставленої (скопійованої)
копії у `npm/wasm-plugins/` — той самий вміст, що піде в опублікований
пакет; `wasm-plugins.mjs` звіряє саме цей hash при кожному резолві
(захист від пошкодженої інсталяції, доккомент модуля).

`spawnFn`/`wasmPluginsDir`/`repoRoot` — ін'єкції для тестів
(`npm/scripts/tests/build-wasm-plugins.test.mjs`), той самий DI-мотив, що
`release-smoke.mjs`: юніт-тести підміняють `cargo`/`build.sh` фейковим
`spawnFn` замість реального тулчейну, `main()` виконується автоматично
лише при прямому запуску як CLI (`isRunAsCli`, `cli-entry.mjs`) — імпорт
модуля тестами не тригерить побічний ефект реальної збірки.

## Публічний API

- WASM_PLUGINS_DIR — Дефолтний абсолютний шлях до `npm/wasm-plugins/` — та сама тека, яку читає `wasm-plugins.mjs` (`WASM_PLUGINS_DIR`).
- FIRST_PARTY_WASM_PLUGINS — First-party wasm-плагіни, вбудовані піни для яких CLI шипить у пакеті
(рішення Н) — один запис сьогодні (`lang-js`, задача N2,
`crates/plugin-lang-js`). Новий first-party плагін додається одним рядком
тут; той самий реєстр читає й CI-крок (той самий скрипт, `node
npm/scripts/build-wasm-plugins.mjs`).
- readCargoPackageName — Ім'я cargo-пакета крейта — з `Cargo.toml`, той самий парсинг, що
`build.sh` (`grep -m1 '^name'`), щоб wasm-stem (`name` з дефісами,
замінені на підкреслення — cargo-конвенція виводу артефакту) не розходився
з тим, що реально зібрав `cargo build`.
- readCargoTargetDir — `target_directory` крейта через `cargo metadata` — той самий канон, що
`build.sh` (доккомент файлу: працює і для крейта-члена workspace, і для
самостійного репозиторію), тож обчислюємо тут же, без хардкоду
`../../target`.
- buildAndStage — Збирає один first-party плагін (`build.sh` крейта) і копіює артефакт у
`<wasmPluginsDir>/<package-name>.wasm`.
- main — Точка входу — збирає всі `plugins` (дефолт [`FIRST_PARTY_WASM_PLUGINS`]) і
пише `builtin-pins.json` у `wasmPluginsDir`.

## Сценарії використання

- `npm/scripts/tests/build-wasm-plugins.test.mjs` (readCargoPackageName; readCargoTargetDir) — парсить; немає поля; парсить target_directory з cargo metadata (fetchFn-ін; cargo metadata впав (status != 0) → кидає; happy path: build.sh → cargo metadata → копія в wasmPluginsDir + sha256; ще 4

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
