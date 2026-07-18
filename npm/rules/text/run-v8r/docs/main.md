---
type: JS Module
title: main.mjs
resource: npm/rules/text/run-v8r/main.mjs
docgen:
  crc: 7abeb17f
  model: manual
---

## Огляд

Пакетна перевірка синтаксису та відповідності JSON-схем для файлів `json`/`json5`/`yaml`/`yml`/`toml` за один виклик `lint-text`, замість п'яти окремих `v8r`-процесів (по одному на розширення, бо `v8r` завершується кодом 98, якщо хоч один із переданих `glob` не знаходить файлів). Каталог схем `@7n/rules` (`npm/schemas/v8r-catalog.json`) описує локальні (не-http) схеми як шляхи ВІДНОСНО `npm/schemas/` — усі власні (`n-rules.json`, `rule-meta.json`, `skill-meta.json`, `concern.json`, `target.json`) і сторонні (`npm/schemas/vendor/`: `package.json`, `tsconfig.json`, `oxlintrc.json`, `cspell.json`, `knip.json`, `jscpd.json` тощо) схеми вендорені — `v8r` ніколи не фетчить їх по мережі. Вендоровані схеми self-contained: усі `$ref` внутрішні (зовнішні `v8r` резолвив би через `got` відносно `$id` — мережею на кожен прогін); зовнішні залежності інлайняться при вендорингу (у `vendor/package.json` вкладено eslintrc/prettierrc/ava/… як `definitions.vendored-<name>`), інваріант закріплено guard-тестом `npm/rules/text/tests/run-v8r-catalog.test.mjs`.

Перед кожним запуском модуль матеріалізує тимчасовий v8r-конфіг-файл із полем `customCatalog` (абсолютні локальні шляхи, обчислені через `import.meta.url`) і передає його через змінну середовища `V8R_CONFIG_FILE`, а не через прапор `-c` — `-c`-каталог `v8r` на кожен файл валідує проти `schema-catalog.json`-метасхеми, яка вимагає `format: "uri"` для `url`; абсолютний локальний шлях цій вимозі не відповідає, а `file://`-URI відповідав би формату, але `v8r` фетчить `url` через `got` (лише http/https). `customCatalog` (ключ `location`, без `format: "uri"`-обмеження) пропускає цю метавалідацію.

## Поведінка

- `DEFAULT_V8R_GLOBS` — стандартні glob-и для `.json`, `.json5`, `.yml`, `.yaml`, `.toml`.
- `V8R_CATALOG_PATH` — абсолютний шлях до джерельного `npm/schemas/v8r-catalog.json`.
- `RESOLVED_V8R_CONFIG_PATH` — фіксований шлях у `os.tmpdir()` для тимчасового v8r-конфігу.
- `V8R_CACHE_TTL_SECONDS` — TTL HTTP-кешу v8r (доба замість дефолтних 600 с): fallback-фетчі schemastore не повторюються на кожен прогін.
- `resolveCustomCatalogSchemas()` — читає джерельний каталог, повертає масив схем у форматі v8r `customCatalog.schemas` (ключ `location`, локальні шляхи — абсолютні).
- `writeResolvedV8rConfig()` — записує `{ cacheTtl, customCatalog: { schemas } }` у `RESOLVED_V8R_CONFIG_PATH` (побічний ефект: файлова операція запису, поза rollback-механізмом лінт-пайплайна).
- `runV8rWithGlobs(globs?)` — послідовно запускає `v8r` для кожного glob-у з `V8R_CONFIG_FILE`, вказаним на резольвнутий конфіг; повертає `{ code, detail }` (не голий код): при `code` 0/98 вивід приховано, `detail` порожній; інакше `detail` друкується й повертається код першого невдалого прогону.
- `runV8rWithFiles(files)` — delta-режим: один запуск `v8r` по конкретних існуючих шляхах (код 98 неможливий), порожній список — одразу `{ code: 0, detail: '' }`.
- `extractFailureLines(combinedText)` — фільтрує `ℹ`-шум і bunx install-вивід з об'єднаного `stdout+stderr` одного запуску `v8r`, лишаючи предметну деталь (`✖ …`-заголовки, ajv-причини). Обидва потоки об'єднуються навмисно: `v8r` непослідовно розкидає деталь між ними залежно від типу помилки (schema violation — причина в stdout, заголовок у stderr; "не знайдено схему" — усе в stderr).
- `warnAboutRemoteSchemaFallback(stderrText)` — парсить stderr `v8r` і на кожен файл, чию схему знайдено мережевим fallback-ом (schemastore, не customCatalog), друкує в stdout пораду додати схему в каталог.
- `stripBunNodeShimDirs(pathValue)` — прибирає з PATH shim-теки `bun-node-*`, які `bun run --bun` додає з підміненим `node`: дочірній `v8r` (node-shebang) інакше виконувався б під bun і падав на непідтримуваному `node:sea`. Дочірній процес `v8r` завжди отримує очищений PATH.
- `lint(ctx)` — detector `text/run-v8r`: `ctx.files` → delta по відфільтрованих розширеннях, без `ctx.files` → full за `DEFAULT_V8R_GLOBS`. Порушення несе `detail` (якщо є) у тексті `fail()`-повідомлення — без нього LLM fix-worker бачив лише "щось не пройшло" й незмінно провалював усі rung-и драбини (не мав інформації, що саме виправляти).

## Публічний API

- `DEFAULT_V8R_GLOBS`, `V8R_CATALOG_PATH`, `RESOLVED_V8R_CONFIG_PATH`, `V8R_CACHE_TTL_SECONDS` — константи.
- `resolveCustomCatalogSchemas()` — обчислені схеми customCatalog.
- `writeResolvedV8rConfig()` — матеріалізація тимчасового конфігу, повертає його шлях.
- `runV8rWithGlobs(globs?)`, `runV8rWithFiles(files)` — точки входу перевірки (full/delta), повертають `{ code, detail }`.
- `extractFailureLines(combinedText)` — фільтр noise-рядків для деталі провалу.
- `warnAboutRemoteSchemaFallback(stderrText)` — попередження про мережевий fallback схем.
- `stripBunNodeShimDirs(pathValue)` — PATH без shim-тек `bun-node-*` (для дочірнього v8r).
- `lint(ctx)` — інтеграція в lint-пайплайн.

## Гарантії поведінки

- Записує один тимчасовий JSON-файл у `os.tmpdir()` (`RESOLVED_V8R_CONFIG_PATH`) на кожен виклик `runV8rWithGlobs`/`runV8rWithFiles`; жодних записів поза tmpdir і в цільове дерево проєкту.
- Схеми з каталогу — локальні файли (`npm/schemas/` + `npm/schemas/vendor/`), без мережевих фетчів. Для файлів поза каталогом v8r іде по мережевий fallback-каталог schemastore (мережа — передумова роботи, офлайн-захисту нема); повторні фетчі гасяться HTTP-кешем v8r із TTL `V8R_CACHE_TTL_SECONDS`.
