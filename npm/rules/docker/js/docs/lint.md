# lint.mjs — перевірка Dockerfile / Containerfile (hadolint + правила docker.mdc)

## Огляд

Модуль `npm/rules/docker/js/lint.mjs` реалізує комплексну перевірку файлів `Dockerfile` / `Containerfile` у репозиторії згідно з правилом `docker.mdc`. Він:

- знаходить усі `Dockerfile`, `Dockerfile.*`, `Containerfile`, `Containerfile.*` від кореня проєкту (з повагою до cursor-ignore шляхів);
- запускає на кожному з них нативний `hadolint` через утиліту `lintDockerfileWithHadolint` (PATH / кеш / авто-install через `ensureTool`, без `docker run`);
- додатково застосовує власні семантичні перевірки:
  - усі `oven/bun`, `alpine`, `nginx`, `node` з Docker Hub мають іти через `mirror.gcr.io` (делегується `getMirrorGcrHint`);
  - Dockerfile має бути **multistage** (мінімум 2 `FROM`);
  - фінальний `FROM` має бути дозволеним runtime-образом (alpine, scratch, debian:_slim_, php, python, nginx-unprivileged, openresty; для проєктів із нативним `.node`-аддоном також `mirror.gcr.io/oven/bun:*`);
  - якщо у Dockerfile є `bun install` і фінальний stage — alpine (backend), очікується `bun build --compile` у build stage, і у фінальному stage не повинно бути викликів `bun`;
  - для проєктів із нативним `.node`-аддоном (sharp / @img/\* / argon2) компіляція через `bun build --compile` заборонена — застосовується окрема перевірка `getNativeAddonNoCompileHint`;
  - фінальний stage має містити `USER <non-root>` (виняток — nginx-unprivileged, який і так від uid=101);
  - для `mirror.gcr.io/nginxinc/nginx-unprivileged` у `FROM` тег має бути саме `alpine-slim`;
  - додаткова перевірка nginx non-root (`getNginxUnprivilegedUserHint`).

Кореневий `.hadolint.yaml` підхоплюється hadolint автоматично. Модуль є точкою входу `check(cwd)` для CLI-перевірок і повертає exit code (0 — OK, 1 — є зауваження або помилка запуску).

## Експорти / API

| Експорт                                           | Тип                  | Призначення                                                                         |
| ------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `isDockerfileName(name)`                          | named function       | Перевіряє, чи basename відповідає Dockerfile / Containerfile (включно з суфіксами). |
| `findDockerfilePaths(root, ignorePaths?)`         | named async function | Збирає абсолютні шляхи до Dockerfile/Containerfile у репозиторії.                   |
| `parseFromStages(fileContent)`                    | named function       | Парсить інструкції `FROM` і повертає масив `{ line, image }`.                       |
| `splitDockerfileStages(fileContent)`              | named function       | Розбиває Dockerfile на масив stage-ів `{ from, stageContent }`.                     |
| `getMultistageAndRuntimeHint(fileContent, opts?)` | named function       | Перевіряє multistage та дозволеність фінального runtime-образу.                     |
| `getBunCompileHint(fileContent)`                  | named function       | Перевіряє правило компіляції bun у бінарник на backend runtime.                     |
| `getNginxAlpineSlimTagHint(fileContent)`          | named function       | Перевіряє тег `alpine-slim` для nginx-unprivileged.                                 |
| `getNonRootRuntimeHint(fileContent)`              | named function       | Перевіряє наявність `USER <non-root>` у фінальному stage.                           |
| `check(cwd?)`                                     | named async function | Точка входу: обходить репозиторій, запускає всі перевірки, повертає exit code.      |

Внутрішні (не експортуються): `isAllowedFinalRuntimeImage`, `readNearestDependencies`, `checkDockerfile`, а також модульні константи (`NEWLINE_RE`, `BUN_INSTALL_RE`, `BUN_BUILD_COMPILE_RE`, `BUN_WORD_RE`, `USER_LINE_RE`, `NGINX_UNPRIVILEGED_MIRROR_PREFIX`, `RUNTIME_IMAGES`, `DEBIAN_VIA_MIRROR_RE`, `BUN_RUNTIME_IMAGE`).

## Типи

```
/**
 * @typedef {{
 *   line: number
 *   image: string
 * }} FromStage
 */
```

`FromStage` — описує одну `FROM`-інструкцію: 1-based номер рядка і строковий image-ref (як у Dockerfile, з можливим тегом та `@digest`).

## Функції

### `isDockerfileName(name)`

- **Сигнатура:** `(name: string) => boolean`
- **Параметри:** `name` — basename файлу.
- **Повертає:** `true`, якщо ім'я (case-insensitive) дорівнює `dockerfile` / `containerfile` або починається з `dockerfile.` / `containerfile.` (наприклад `Dockerfile.prod`); інакше `false`.
- **Side effects:** немає.

### `findDockerfilePaths(root, ignorePaths = [])`

- **Сигнатура:** `(root: string, ignorePaths?: string[]) => Promise<string[]>`
- **Параметри:**
  - `root` — корінь репозиторію, від якого виконується обхід;
  - `ignorePaths` — масив каталогів, повністю виключених з обходу (наприклад `node_modules`, `.git`); передається в `walkDir`.
- **Повертає:** відсортований (через `localeCompare`) масив абсолютних шляхів до знайдених Dockerfile/Containerfile.
- **Side effects:** I/O на читання директорій через `walkDir`.

### `parseFromStages(fileContent)`

- **Сигнатура:** `(fileContent: string) => FromStage[]`
- **Параметри:** `fileContent` — повний вміст Dockerfile/Containerfile.
- **Повертає:** масив `FromStage` для кожного рядка, де `getFromImageToken` повернув непорожній image-ref. Номер рядка — 1-based.
- **Side effects:** немає (чиста функція).

### `isAllowedFinalRuntimeImage(lastLower, hasNativeAddon = false)` _(внутрішня)_

- **Сигнатура:** `(lastLower: string, hasNativeAddon?: boolean) => boolean`
- **Параметри:**
  - `lastLower` — image-ref останнього `FROM` без digest, у нижньому регістрі;
  - `hasNativeAddon` — чи має проєкт нативний `.node`-аддон (sharp / @img/\* / argon2).
- **Повертає:** `true`, якщо образ дозволений як фінальний runtime:
  - `scratch` або `scratch:*`;
  - якщо `hasNativeAddon` — додатково `mirror.gcr.io/oven/bun` або `mirror.gcr.io/oven/bun:*`;
  - `mirror.gcr.io/library/debian:<tag>` за умови, що `<tag>` містить підрядок `slim`;
  - будь-який з `RUNTIME_IMAGES` (alpine, php, python, nginx-unprivileged, openresty) як точне співпадіння або з тегом `:*`.
- **Side effects:** немає.

### `splitDockerfileStages(fileContent)`

- **Сигнатура:** `(fileContent: string) => Array<{ from: FromStage, stageContent: string }>`
- **Параметри:** `fileContent` — вміст Dockerfile.
- **Повертає:**
  - порожній масив, якщо `FROM` немає;
  - інакше масив об'єктів `{ from, stageContent }`: рядки від `FROM` поточного stage (включно) до рядка перед наступним `FROM` (а для останнього — до кінця файлу), з'єднані через `\n`.
- **Side effects:** немає.

### `getMultistageAndRuntimeHint(fileContent, opts?)`

- **Сигнатура:** `(fileContent: string, opts?: { hasNativeAddon?: boolean }) => string | null`
- **Параметри:**
  - `fileContent` — вміст Dockerfile;
  - `opts.hasNativeAddon` — чи проєкт залежить від нативних `.node`-аддонів.
- **Повертає:**
  - `null`, якщо `FROM` немає або всі вимоги задоволені;
  - повідомлення про відсутність multistage (`'має бути multistage build: мінімум 2 інструкції FROM (build stage + runtime stage)'`), якщо лише один `FROM`;
  - повідомлення `'фінальний FROM має бути дозволеним runtime-образом (див. docker.mdc: multistage), зараз: <image> (рядок N)'`, якщо фінальний образ не пройшов `isAllowedFinalRuntimeImage`.
- **Side effects:** немає.

### `getBunCompileHint(fileContent)`

- **Сигнатура:** `(fileContent: string) => string | null`
- **Параметри:** `fileContent` — вміст Dockerfile.
- **Тригер активації:** у файлі є `bun install` / `bun i` (за `BUN_INSTALL_RE`) **та** фінальний `FROM` починається з `mirror.gcr.io/library/alpine:` **та** він не є nginx-unprivileged / openresty (frontend).
- **Повертає:**
  - `null`, якщо немає stage-ів, немає `bun install`, фінал не alpine, або фінал — frontend (nginx/openresty);
  - повідомлення `'є `bun install`, але немає `bun build --compile` …'`, якщо у файлі немає `bun build --compile`;
  - повідомлення `'фінальний stage не має містити Bun …'`, якщо у `stageContent` останнього stage зустрічається слово `bun` (RUN/CMD/ENTRYPOINT з `bun`).
- **Side effects:** немає.

### `getNginxAlpineSlimTagHint(fileContent)`

- **Сигнатура:** `(fileContent: string) => string | null`
- **Параметри:** `fileContent` — вміст Dockerfile.
- **Повертає:**
  - `null`, якщо немає `FROM` з префіксом `mirror.gcr.io/nginxinc/nginx-unprivileged` або всі такі `FROM` мають тег `alpine-slim`;
  - повідомлення про відсутній явний тег (`FROM <prefix>` без `:tag`);
  - повідомлення про неправильний тег (наприклад `:latest`, `:alpine`).
- **Side effects:** немає.

### `getNonRootRuntimeHint(fileContent)`

- **Сигнатура:** `(fileContent: string) => string | null`
- **Параметри:** `fileContent` — вміст Dockerfile.
- **Логіка:**
  - бере останній stage через `splitDockerfileStages`;
  - проходить рядки і запам'ятовує останній `USER <token>` (regex `USER_LINE_RE`, з лапок видаляються `"`/`'`);
  - якщо `USER` відсутній і фінальний образ — `mirror.gcr.io/nginxinc/nginx-unprivileged:*`, повертає `null` (виняток для nginx-unprivileged, який стартує від uid=101);
  - якщо `USER` відсутній — повертає повідомлення про необхідність `USER <non-root>`;
  - якщо `USER` дорівнює `root` або `0` (без врахування регістру) — повертає повідомлення про заборону root.
- **Повертає:** `string | null` (повідомлення помилки або `null`).
- **Side effects:** немає.

### `check(cwd = process.cwd())`

- **Сигнатура:** `(cwd?: string) => Promise<number>`
- **Параметри:** `cwd` — корінь репозиторію; за замовчуванням `process.cwd()`.
- **Логіка:**
  1. Створює репортер `createCheckReporter()`.
  2. Завантажує `ignorePaths` через `loadCursorIgnorePaths(root)`.
  3. Знаходить усі Dockerfile/Containerfile через `findDockerfilePaths`.
  4. Якщо файлів немає — `pass('Немає Dockerfile / Containerfile — перевірку hadolint пропущено')` і виходить.
  5. Інакше виводить `Знайдено файлів для hadolint: N` і послідовно викликає `checkDockerfile(reporter, root, abs)` для кожного.
  6. Повертає `reporter.getExitCode()`.
- **Повертає:** `0` — все OK, `1` — є зауваження або помилка запуску.
- **Side effects:** читання файлової системи, синхронний/асинхронний запуск hadolint через `lintDockerfileWithHadolint` (нативний бінарник через `ensureTool`).

### `readNearestDependencies(abs, root)` _(внутрішня)_

- **Сигнатура:** `(abs: string, root: string) => Promise<Record<string, unknown>>`
- **Параметри:**
  - `abs` — абсолютний шлях до Dockerfile;
  - `root` — корінь репозиторію (зупинка піднімання).
- **Логіка:** піднімається від `dirname(abs)` вгору, шукаючи `package.json`. Як тільки знаходить — повертає `dependencies` (або `{}`, якщо `dependencies` відсутні / не об'єкт). Якщо досягає `root` або вищого каталогу без `package.json` — повертає `{}`.
- **Повертає:** `dependencies` найближчого `package.json` або порожній об'єкт.
- **Side effects:** I/O на читання `package.json`; помилки `readFile` поглинаються (catch без оголошення).

### `checkDockerfile(reporter, root, abs)` _(внутрішня)_

- **Сигнатура:** `(reporter: ReturnType<typeof createCheckReporter>, root: string, abs: string) => Promise<void>`
- **Параметри:**
  - `reporter` — інстанс репортера з `pass` / `fail`;
  - `root` — корінь репо (для розрахунку posix-relative шляху);
  - `abs` — абсолютний шлях до Dockerfile.
- **Логіка (послідовно):**
  1. `rel = posixRel(root, abs) || basename(abs)`.
  2. Читає вміст файлу (`readFile(abs, 'utf8')`).
  3. Визначає `nativeAddons` через `getNativeAddonDeps(await readNearestDependencies(abs, root))`; `hasNativeAddon = nativeAddons.length > 0`.
  4. `getMirrorGcrHint(content)` → `fail` з префіксом `mirror.gcr.io`.
  5. `getMultistageAndRuntimeHint(content, { hasNativeAddon })` → `fail` з префіксом `multistage`.
  6. Якщо `hasNativeAddon` — `getNativeAddonNoCompileHint(content, nativeAddons)` → `fail` з префіксом `native-addon`; інакше — `getBunCompileHint(content)` → `fail` з префіксом `compile`.
  7. `getNonRootRuntimeHint(content)` → `fail` з префіксом `non-root`.
  8. `getNginxAlpineSlimTagHint(content)` → `fail` з префіксом `nginx tag`.
  9. `getNginxUnprivilegedUserHint(content)` → `fail` з префіксом `nginx non-root`.
  10. `lintDockerfileWithHadolint(root, abs)` (синхронний виклик з результатом `{ ok, stdout, stderr, via }`): якщо `ok` — `pass(`${rel} (${via})`)`, інакше `fail` з хвостом stdout+stderr.
- **Повертає:** `Promise<void>`.
- **Side effects:** I/O на читання Dockerfile/package.json, запуск hadolint, виклики `reporter.pass`/`reporter.fail`.

## Константи / regex

- `NEWLINE_RE = /\r?\n/` — розділення на рядки (CRLF/LF).
- `BUN_INSTALL_RE = /\bbun\s+(?:install|i)\b/iu` — детект `bun install` / `bun i`.
- `BUN_BUILD_COMPILE_RE = /\bbun\s+build\b[^\n]*\s--compile\b/iu` — детект `bun build … --compile`.
- `BUN_WORD_RE = /\bbun\b/iu` — будь-яке слово `bun`.
- `USER_LINE_RE = /^\s*USER\s+([^\s#]+)/iu` — інструкція `USER`.
- `NGINX_UNPRIVILEGED_MIRROR_PREFIX = 'mirror.gcr.io/nginxinc/nginx-unprivileged'`.
- `RUNTIME_IMAGES` — `const`-кортеж дозволених фінальних runtime-образів: `mirror.gcr.io/library/alpine`, `…/library/php`, `…/library/python`, `…/nginxinc/nginx-unprivileged`, `…/openresty/openresty`.
- `DEBIAN_VIA_MIRROR_RE = /^mirror\.gcr\.io\/library\/debian:(.+)$/i` — debian через mirror, для перевірки `slim` у тегу.
- `BUN_RUNTIME_IMAGE = 'mirror.gcr.io/oven/bun'` — bun як фінальний runtime (легітимний лише для нативних `.node`-аддонів).

## Залежності

### Зовнішні (Node.js standard library)

- `node:fs/promises` → `readFile`.
- `node:path` → `basename`, `dirname`, `join`.

### Внутрішні модулі репозиторію

- `../lib/docker-mirror.mjs` → `getMirrorGcrHint`, `getFromImageToken`.
- `../lib/docker-native-addon.mjs` → `getNativeAddonDeps`, `getNativeAddonNoCompileHint`.
- `../lib/docker-nginx-user.mjs` → `getNginxUnprivilegedUserHint`.
- `../lib/docker-hadolint.mjs` → `lintDockerfileWithHadolint`, `posixRel`.
- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` (з методами `pass`, `fail`, `getExitCode`).
- `../../../scripts/lib/load-cursor-config.mjs` → `loadCursorIgnorePaths`.
- `../../../scripts/utils/walkDir.mjs` → `walkDir`.

### Зовнішні бінарники

- `hadolint` — запускається як нативний бінарник через `ensureTool` (PATH / кеш / авто-install). `docker run` не використовується.

## Потік виконання / Використання

1. Викликається `check(cwd)` (наприклад, з CLI-обгортки правил `docker`).
2. `loadCursorIgnorePaths(root)` повертає шляхи з cursor-конфігу, які треба ігнорувати при обході.
3. `findDockerfilePaths(root, ignorePaths)` за допомогою `walkDir` обходить дерево і збирає всі Dockerfile/Containerfile, відсортовані.
4. Якщо файлів немає — репорт `pass` і exit 0.
5. Інакше для кожного знайденого Dockerfile послідовно виконується `checkDockerfile`, який:
   - читає вміст,
   - підіймається до найближчого `package.json` для визначення `hasNativeAddon`,
   - запускає шість статичних перевірок (mirror, multistage/runtime, compile **або** native-addon, non-root, nginx tag, nginx user),
   - запускає `hadolint` через `lintDockerfileWithHadolint` і репортує результат.
6. Усі помилки агрегуються в репортері; підсумковий код повертає `reporter.getExitCode()` (0/1).

### Приклад (псевдокод використання)

```
import { check } from './lint.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Точкове використання окремих функцій

- `parseFromStages(content)` — для тестів або інтроспекції stage-ів.
- `splitDockerfileStages(content)` — отримати масив `{ from, stageContent }` для подальшого аналізу.
- `getMultistageAndRuntimeHint`, `getBunCompileHint`, `getNginxAlpineSlimTagHint`, `getNonRootRuntimeHint` — окремі правила можна викликати ізольовано (наприклад у юніт-тестах у `npm/rules/docker/js/tests/`).

## Контрактні нюанси та винятки

- Якщо `FROM` у Dockerfile взагалі немає, перевірки `getMultistageAndRuntimeHint`, `getBunCompileHint`, `getNonRootRuntimeHint` повертають `null` (нема чого перевіряти).
- Для проєктів із нативним `.node`-аддоном (`sharp`, `@img/argon2` тощо):
  - `bun build --compile` заборонено — спрацьовує `getNativeAddonNoCompileHint`, а не `getBunCompileHint`;
  - фінальний `FROM` на `mirror.gcr.io/oven/bun:*` легітимний (`isAllowedFinalRuntimeImage` з `hasNativeAddon=true`).
- `nginx-unprivileged` без явного `USER` не вважається порушенням non-root (uid=101 за замовчуванням), але тег має бути саме `alpine-slim`.
- `scratch` (як точне співпадіння або з тегом) завжди дозволено як фінальний runtime.
- `debian` дозволено лише через `mirror.gcr.io/library/debian:<tag>` де `<tag>` містить `slim`.
- `posixRel` нормалізує шлях для уніфікованого виводу в репорті; якщо повертає порожній рядок — використовується `basename(abs)`.
