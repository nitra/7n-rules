---
type: JS Module
title: wasm-plugins.mjs
resource: npm/scripts/lib/lint-surface/wasm-plugins.mjs
docgen:
  crc: 79593d0c
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Резолвер wasm-плагінів plugin contract v3 (`n-rules:plugin@3.0.0`, задача K
фази 6, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
§3.3) — читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо, для
кожного запису питає napi-міст `wasmPluginConcerns()` (`crates/rules-napi`)
і будує мапу «ключ концерну (`ruleId/concernId`) → абсолютний шлях `.wasm`».

Формат конфігу — dev-пін (не фінальна дистрибуція спеки §3.4):
```json
"wasmPlugins": [{ "name": "lang-js-pilot", "path": "./target/wasm32-wasip2/release/plugin_lang_js_pilot.wasm" }]
```
TODO(v3-wasm-pilot): `url` + `sha256` hash-пін (спека §3.4, рішення Ж) —
наступний крок, поза обсягом пілоту; `path` тут — repo-relative шлях до вже
зібраного `.wasm`, без завантаження/кешу за хешем.

Свідомо ОКРЕМА секція від `plugins` (масив npm-імен Plugin API v2,
`npm/scripts/lib/resolve-plugins.mjs`) — той ключ уже зайнятий закритим
контрактом (schema `npm/schemas/n-rules.json`, читачі
`read-n-rules-config-lite.mjs`/`resolve-plugins.mjs`/`n-rules-cli.mjs`),
перевикористання зламало б і schema-валідацію (v8r), і мовчазно відфільтрувало б
записи в чинних читачах (`typeof p === 'string'`).

Skip-not-crash (спека §3.3, рішення З): запис із відсутнім/битим `.wasm`
ніколи не кидає — пропускається з warn-попередженням, `runConcernDetector`
(`detect.mjs`) падає назад на `main.mjs`, якщо той існує для того самого
concern-а (перехідне поводження, задокументоване там же).

## Публічний API

- resolveWasmConcernMap — Лениво резолвить мапу «ключ концерну → абсолютний шлях .wasm» з секції
`wasmPlugins` (доккомент модуля). Плагін з відсутнім/битим `.wasm` чи
`describe()`, що кидає — пропускається з `console.warn`, не валить резолв
решти плагінів.
- resetWasmConcernMapForTests — Тестовий хук: скидає модульний кеш [`resolveWasmConcernMap`] — ізольовані
тести пишуть власний `.n-rules.json` на кожен `withTmpDir` і мають бачити
свіжий резолв, не кеш попереднього тесту.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/wasm-plugins.test.mjs` (resolveWasmConcernMap — читання конфігу) — немає .n-rules.json → порожня мапа; невалідний JSON у .n-rules.json → порожня мапа (skip-not-crash); wasmPlugins не масив → порожня мапа; невалідні записи (без name/path) відфільтровуються; відсутній .wasm-файл за шляхом → warn і пропуск запису (skip-not-crash); ще 4

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
