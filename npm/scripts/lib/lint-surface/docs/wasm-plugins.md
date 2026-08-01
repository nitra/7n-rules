---
type: JS Module
title: wasm-plugins.mjs
resource: npm/scripts/lib/lint-surface/wasm-plugins.mjs
docgen:
  crc: ae3be0e5
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 5
---

## Огляд

Резолвер wasm-плагінів plugin contract v3 (`n-rules:plugin@3.0.0`, задача K
фази 6 + N1, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
§3.3/§3.4) — читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо, для
кожного запису питає napi-міст `wasmPluginManifest()` (`crates/rules-napi`)
і будує мапу «ключ концерну (`ruleId/concernId`) → `{ wasmPath, toolPaths }`»
(значення — НЕ голий рядок шляху, доккомент [`buildWasmConcernMap`] нижче).

**Run-tool контур (задача N1, рішення Д спеки)**: `manifest.tools` —
задекларовані зовнішні tool-залежності плагіна (напр. `"shellcheck@^0.9"`).
Для кожного запису резолвер кличе ensure-tool контур (`ensureToolAsync`,
`../ensure-tool.mjs`, injectable через `opts.ensureToolFn`) — будує мапу
«ім'я тула (без semver-суфікса декларації) → абсолютний шлях», яку
`run_wasm_concern` (napi) перетворює на host-бічний `ToolResolver`
(`crates/rules-plugin-host/src/tool_resolver.rs`). Тул, якого ensure-tool
не знає (немає в `TOOLS`-реєстрі) чи не зміг поставити (мережа,
rate-limit) — `console.warn`, ПРОПУСКАЄТЬСЯ з мапи (skip-not-crash на
рівні ОДНОГО tool-у, не плагіна) — виклик `run-tool` у самому
wasm-компоненті просто отримає типізовану помилку в `tool-output`
(`ToolResolver::run`, доккомент host-боку), не крашиться.

Формат конфігу — дві форми запису (schema `npm/schemas/n-rules.json`):
```json
"wasmPlugins": [
  { "name": "lang-js", "path": "./target/wasm32-wasip2/release/plugin_lang_js.wasm" },
  { "name": "acme-plugin", "url": "https://…/plugin.wasm", "sha256": "…64 hex…" }
]
```
`path` — dev-петля: repo-relative чи абсолютний шлях до вже зібраного
`.wasm`, без завантаження й без hash-перевірки. Дозволена лише поза CI
(`env.CI` truthy) — у CI dev-шлях пропускається з warn (спека §3.4: «`file:`
без hash-перевірки — лише поза CI»); детермінований CI-прогін мусить
резолвити канонічний пін.

`url`+`sha256` — канонічний пін дистрибуції (спека §3.4, рішення Ж).
Retrieval-модель, дзеркало `ensure-tool.mjs` (`getCacheDir`/`installFromGithub`):
1. Кеш-файл `<cacheDir>/<sha256>.wasm` (`cacheDir` — конвенція `ensure-tool.mjs`,
   `~/.cache/@7n/rules/plugins/` на macOS/Linux, `%LOCALAPPDATA%\@7n\rules\plugins\`
   на Windows; `N_RULES_PLUGIN_CACHE_DIR` — explicit override, читається першим
   для ізоляції тестів).
2. Кеш-хіт — це `existsSync` **І** реальний sha256 вмісту файлу збігається з
   очікуваним (ім'я файлу — не єдина довіра: підмінений/пошкоджений вміст під
   правильним ім'ям має тригерити перезавантаження, не мовчазний dispatch у
   зіпсований wasm).
3. Кеш-промах чи пошкоджений кеш → `fetchFn(url)` (глобальний `fetch`,
   ін'єкція для тестів), sha256 завантаженого вмісту (`node:crypto`)
   звіряється з очікуваним.
4. Mismatch після завантаження → skip-not-crash `console.warn`, запис НЕ
   кешується (наступний прогін завантажує знову, не застрягає на битому пін-і).
5. Збіг → атомарний запис у кеш: tmp-файл у тому ж `cacheDir` (той самий
   filesystem — без EXDEV на `renameSync`) + `renameSync` на фінальне ім'я,
   той самий патерн, що `installFromGithub` у `ensure-tool.mjs`.

**Вбудована таблиця first-party пінів** (задача O1 фази 6 v2, спека §3.4,
рішення Н): ТРЕТЄ, найнижче пріоритетне джерело записів `wasmPlugins` —
`npm/wasm-plugins/builtin-pins.json` (`readBuiltinPinsConfig`), поряд з
яким лежать самі `.wasm`-файли first-party плагінів. Формат:
`{ "<name>": { "file": "<basename>.wasm", "sha256": "<64 hex>" } }`.
Файл генерується `npm/scripts/build-wasm-plugins.mjs` (локальна dev-петля
й CI-крок `npm-publish.yml`) і НЕ комітиться в git — repo-дерево без
локальної збірки просто не має файлу (`readBuiltinPinsConfig` мовчить,
без `console.warn`, доккомент функції нижче). Записи `.n-rules.json`
консюмера з тим самим `name` ПОВНІСТЮ перекривають builtin-запис
(`mergeWithBuiltinEntries`) — ручний пін потрібен лише для власних/сторонніх
плагінів, не для first-party. sha256-звірка ОБОВ'ЯЗКОВА і для builtin-шляху
(`resolveEntryPath`, гілка `'file' in entry`) — той самий мотив, що й для
кеш-хіта канонічного піна нижче: захист від пошкодженої інсталяції пакету,
ім'я файлу саме по собі не є довірою.

**Dispatch-shadowing первого first-party плагіна** (`plugin-lang-js`,
`crates/plugin-lang-js`, задача N2): щойно `npm/wasm-plugins/builtin-pins.json`
присутній (локальна збірка чи встановлений з npm пакет), builtin-запис
`lang-js` резолвиться БЕЗ жодного `.n-rules.json` від консюмера — його
контрибуції (`vue/tfm-translations`, `style/gap`) потрапляють у мапу цього
модуля автоматично. Диспатч `runConcernDetector` (`detect.mjs`) перевіряє
джерела в порядку native (`NATIVE_CONCERNS`) → wasm (ця мапа) → `main.mjs`/
policy — тобто для цих двох concern-ів wasm-реалізація ПЕРЕКРИВАЄ JS-реалізацію
`plugins/lang-js/rules/{vue/tfm-translations,style/gap}/main.mjs`, щойно
builtin-таблиця зібрана. Це свідома мета (перший real-виведення дублювання
реалізацій), НЕ помилка конфігурації. JS-реалізації в `plugins/lang-js`
фізично НЕ видаляються цією зміною: пакет `@7n/rules-lang-js` має споживачів
на старих `@7n/rules` без wasm-хоста (Plugin API v2), і лишається їхнім
єдиним шляхом — видалення дублікату заплановане окремим кроком, коли весь
плагін переїде на v3 (§3.5.6 спеки, виведення Plugin API v2). Консистентність
двох реалізацій (контрибуції, форма повідомлень) звіряють
`wasm-plugin-parity.test.mjs` (біт-у-біт `violations`) і
`wasm-builtin-pins.test.mjs` (контрибуції маніфесту ⊆ задекларованих).

Свідомо ОКРЕМА секція від `plugins` (масив npm-імен Plugin API v2,
`npm/scripts/lib/resolve-plugins.mjs`) — той ключ уже зайнятий закритим
контрактом (schema `npm/schemas/n-rules.json`, читачі
`read-n-rules-config-lite.mjs`/`resolve-plugins.mjs`/`n-rules-cli.mjs`),
перевикористання зламало б і schema-валідацію (v8r), і мовчазно відфільтрувало б
записи в чинних читачах (`typeof p === 'string'`).

Skip-not-crash (спека §3.3, рішення З): запис із відсутнім/битим `.wasm`,
недосяжним `url` чи sha256-mismatch ніколи не кидає — пропускається з
warn-попередженням, `runConcernDetector` (`detect.mjs`) падає назад на
`main.mjs`, якщо той існує для того самого concern-а (перехідне поводження,
задокументоване там же).

Резолв — `async` (fetch за мережею неминуче асинхронний); єдиний виклик-сайт
(`detect.mjs`, `runConcernDetector`) вже `async`-функція, контракт виклику
не ламається — просто додається `await`. Модульний кеш зберігає `Promise`
(не готову `Map`), щоб конкурентні виклики до завершення першого резолву
(декілька concern-ів стартують паралельно) переюзали той самий in-flight
запит замість дублювання fetch/IO.

## Публічний API

- resolveWasmConcernMap — Лениво резолвить мапу «ключ концерну → [`WasmConcernMapEntry`]» з секції
`wasmPlugins` (доккомент модуля). Плагін з відсутнім/битим `.wasm`, недосяжним
`url`, sha256-mismatch чи `describe()`, що кидає — пропускається з
`console.warn`, не валить резолв решти плагінів.

`async` — retrieval канонічного піна (`url`+`sha256`) і ensure-tool контур
неминуче асинхронні; єдиний виклик-сайт (`detect.mjs`) вже `async`,
контракт виклику не ламається.
  `fetchFn` (дефолт — глобальний `fetch`), `cacheDir` (дефолт — `resolvePluginCacheDir`), `env` (дефолт — `process.env`),
  `ensureToolFn` (дефолт — `ensureToolAsync`), `nativeFn` (дефолт — `loadNative`, wiring-тести підміняють фейковим addon-ом),
  `builtinPinsDir` (дефолт — [`WASM_PLUGINS_DIR`], реальна `npm/wasm-plugins/`; тести ізолюють неіснуючим каталогом,
  щоб локальна wasm-збірка в робочому дереві не підмішувала builtin-контрибуції в контрольовані сценарії)
- resetWasmConcernMapForTests — Тестовий хук: скидає модульний кеш [`resolveWasmConcernMap`] — ізольовані
тести пишуть власний `.n-rules.json` на кожен `withTmpDir` і мають бачити
свіжий резолв, не кеш попереднього тесту.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/wasm-plugins.test.mjs` (resolveWasmConcernMap — читання конфігу; resolveWasmConcernMap — path-форма і CI-гейт (спека §3.4)) — немає .n-rules.json → порожня мапа; невалідний JSON у .n-rules.json → порожня мапа (skip-not-crash); wasmPlugins не масив → порожня мапа; невалідні записи (без name/path, без url+sha256, битий sha256) відфільтровуються; відсутній .wasm-файл за шляхом → warn і пропуск запису (skip-not-crash); ще 24

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
