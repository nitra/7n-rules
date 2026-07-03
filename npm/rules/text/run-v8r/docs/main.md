---
type: JS Module
title: main.mjs
resource: npm/rules/text/run-v8r/main.mjs
docgen:
  crc: 3da23be6
---

## Огляд

Пакетна перевірка синтаксису та відповідності JSON-схем для файлів `json`/`json5`/`yaml`/`yml`/`toml` за один виклик `lint-text`, замість п'яти окремих `v8r`-процесів (по одному на розширення, бо `v8r` завершується кодом 98, якщо хоч один із переданих `glob` не знаходить файлів). Каталог схем `@nitra/cursor` (`npm/schemas/v8r-catalog.json`) описує локальні (не-http) схеми як шляхи ВІДНОСНО `npm/schemas/` — усі власні (`n-cursor.json`, `rule-meta.json`, `skill-meta.json`, `concern.json`, `target.json`) і сторонні (`npm/schemas/vendor/`: `package.json`, `tsconfig.json`, `oxlintrc.json`, `cspell.json`, `knip.json`, `jscpd.json` тощо) схеми вендорені — `v8r` ніколи не фетчить їх по мережі.

Перед кожним запуском модуль матеріалізує тимчасовий v8r-конфіг-файл із полем `customCatalog` (абсолютні локальні шляхи, обчислені через `import.meta.url`) і передає його через змінну середовища `V8R_CONFIG_FILE`, а не через прапор `-c` — `-c`-каталог `v8r` на кожен файл валідує проти `schema-catalog.json`-метасхеми, яка вимагає `format: "uri"` для `url`; абсолютний локальний шлях цій вимозі не відповідає, а `file://`-URI відповідав би формату, але `v8r` фетчить `url` через `got` (лише http/https). `customCatalog` (ключ `location`, без `format: "uri"`-обмеження) пропускає цю метавалідацію.

## Поведінка

- `DEFAULT_V8R_GLOBS` — стандартні glob-и для `.json`, `.json5`, `.yml`, `.yaml`, `.toml`.
- `V8R_CATALOG_PATH` — абсолютний шлях до джерельного `npm/schemas/v8r-catalog.json`.
- `RESOLVED_V8R_CONFIG_PATH` — фіксований шлях у `os.tmpdir()` для тимчасового v8r-конфігу.
- `resolveCustomCatalogSchemas()` — читає джерельний каталог, повертає масив схем у форматі v8r `customCatalog.schemas` (ключ `location`, локальні шляхи — абсолютні).
- `writeResolvedV8rConfig()` — записує `{ customCatalog: { schemas } }` у `RESOLVED_V8R_CONFIG_PATH` (побічний ефект: файлова операція запису, поза rollback-механізмом лінт-пайплайна).
- `runV8rWithGlobs(globs?)` — послідовно запускає `v8r` для кожного glob-у з `V8R_CONFIG_FILE`, вказаним на резольвнутий конфіг; при коді 0/98 вивід приховано, інакше друкується й повертається код першого невдалого прогону.

## Публічний API

- `DEFAULT_V8R_GLOBS`, `V8R_CATALOG_PATH`, `RESOLVED_V8R_CONFIG_PATH` — константи.
- `resolveCustomCatalogSchemas()` — обчислені схеми customCatalog.
- `writeResolvedV8rConfig()` — матеріалізація тимчасового конфігу, повертає його шлях.
- `runV8rWithGlobs(globs?)` — точка входу перевірки.

## Гарантії поведінки

- Записує один тимчасовий JSON-файл у `os.tmpdir()` (`RESOLVED_V8R_CONFIG_PATH`) на кожен виклик `runV8rWithGlobs`; жодних записів поза tmpdir і в цільове дерево проєкту.
- Без мережевих запитів: усі схеми, на які посилається каталог, — локальні файли (`npm/schemas/` + `npm/schemas/vendor/`).
