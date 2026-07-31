---
type: JS Module
title: wasm-plugins.mjs
resource: npm/scripts/lib/lint-surface/wasm-plugins.mjs
docgen:
  crc: 592abaef
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Резолвер wasm-плагінів plugin contract v3 (`n-rules:plugin@3.0.0`, задача K
фази 6, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
§3.3/§3.4) — читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо, для
кожного запису питає napi-міст `wasmPluginConcerns()` (`crates/rules-napi`)
і будує мапу «ключ концерну (`ruleId/concernId`) → абсолютний шлях `.wasm`».

Формат конфігу — дві форми запису (schema `npm/schemas/n-rules.json`):
```json
"wasmPlugins": [
  { "name": "lang-js-pilot", "path": "./target/wasm32-wasip2/release/plugin_lang_js_pilot.wasm" },
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

TODO(v3-wasm-first-party-pins): вбудована таблиця `name → url + sha256` для
власних плагінів (спека §3.4, рішення Н) — прийде з першим published
плагіном; до того ручний пін у `.n-rules.json` обов'язковий для будь-якого
плагіна.

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

- resolveWasmConcernMap — Лениво резолвить мапу «ключ концерну → абсолютний шлях .wasm» з секції
`wasmPlugins` (доккомент модуля). Плагін з відсутнім/битим `.wasm`, недосяжним
`url`, sha256-mismatch чи `describe()`, що кидає — пропускається з
`console.warn`, не валить резолв решти плагінів.

`async` — retrieval канонічного піна (`url`+`sha256`) неминуче мережевий;
єдиний виклик-сайт (`detect.mjs`) вже `async`, контракт виклику не ламається.
  `fetchFn` (дефолт — глобальний `fetch`), `cacheDir` (дефолт — `resolvePluginCacheDir`), `env` (дефолт — `process.env`)
- resetWasmConcernMapForTests — Тестовий хук: скидає модульний кеш [`resolveWasmConcernMap`] — ізольовані
тести пишуть власний `.n-rules.json` на кожен `withTmpDir` і мають бачити
свіжий резолв, не кеш попереднього тесту.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/wasm-plugins.test.mjs` (resolveWasmConcernMap — читання конфігу; resolveWasmConcernMap — path-форма і CI-гейт (спека §3.4)) — немає .n-rules.json → порожня мапа; невалідний JSON у .n-rules.json → порожня мапа (skip-not-crash); wasmPlugins не масив → порожня мапа; невалідні записи (без name/path, без url+sha256, битий sha256) відфільтровуються; відсутній .wasm-файл за шляхом → warn і пропуск запису (skip-not-crash); ще 13

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
