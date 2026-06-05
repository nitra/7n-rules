# docker-native-addon.mjs

## Огляд

Модуль `docker-native-addon.mjs` — це dep-специфічний чек-модуль правила `docker` для виявлення антипатерну, коли проєкт залежить від нативного `.node`-аддона з динамічним завантаженням біндингу (через динамічний `require`), і одночасно намагається бути запакованим через `bun build --compile` у Dockerfile.

Контекст проблеми:

- Деякі npm-пакети (передусім `sharp`, а також пакети у scope `@img/*`, `argon2`) містять нативний `.node`-аддон, який вантажиться у рантаймі через **динамічний** виклик `require`, наприклад `require(\`@img/sharp-${platform}/sharp.node\`)`. Ім'я модуля формується з підстановки змінних.
- Компілятор `bun build --compile` виконує статичний трейсинг імпортів і **не** бачить такі динамічні `require`, тож **не вшиває** відповідний нативний біндинг у standalone-бінарник.
- Результат — рантайм-помилка на кшталт `Could not load the "sharp" module using the linuxmusl-arm64 runtime`. Підтверджено реальними docker-збірками (`bun 1.3.14`, `sharp 0.34.5`) і відтворюється також на `darwin-arm64`, тобто проблема не пов'язана з різницею musl/glibc.
- Установка системного `apk add vips` **не** лікує проблему: вона дає системний `libvips`, але самого файлу `sharp.node` усе одно бракує.

Канонічне рішення для таких проєктів (за правилом `docker.mdc`, секція «компіляція»): **не** компілювати в standalone-бінарник, а shipити `node_modules` як є й запускати застосунок через `bun <entry>` на базі образу `mirror.gcr.io/oven/bun:alpine`. Це визнаний виняток із загального правила «лише `alpine`/`scratch` у фінальному stage» — тут потрібен саме bun-рантайм.

Це окрема гілка від генеричного compile-правила (`getBunCompileHint` у `../js/lint.mjs`): для проєктів **без** нативних аддонів канон лишається — standalone-бінарник на `alpine`.

Сусідній модуль `./docker-mirror.mjs` слугує взірцем структури dep-специфічного чек-модуля.

## Експорти / API

Модуль експортує два константи (іменовані експорти) і три функції (іменовані експорти):

| Експорт                                                  | Тип                                                               | Призначення                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `NATIVE_ADDON_PACKAGES`                                  | `readonly ['sharp', 'argon2']`                                    | Точні імена відомих нативних аддонів.                                                         |
| `NATIVE_ADDON_SCOPES`                                    | `readonly ['@img/']`                                              | Scope-префікси, чиї пакети трактуються як нативні аддони.                                     |
| `isNativeAddonPackage(name)`                             | `(name: string) => boolean`                                       | Чи ім'я npm-пакета є нативним аддоном (точно або за scope-префіксом).                         |
| `getNativeAddonDeps(dependencies)`                       | `(dependencies: unknown) => string[]`                             | Відсортовані імена нативних аддонів, знайдених у `package.json#dependencies`.                 |
| `getNativeAddonNoCompileHint(fileContent, nativeAddons)` | `(fileContent: string, nativeAddons: string[]) => string \| null` | Текст hint-помилки, якщо у Dockerfile є `bun build --compile` при наявності нативного аддона. |

Default-експорт відсутній.

## Функції

### `isNativeAddonPackage(name)`

Сигнатура:

```js
isNativeAddonPackage(name: string): boolean
```

Параметри:

- `name` — ім'я npm-пакета (рядок). Очікується очищене ім'я ключа з `package.json#dependencies`, наприклад `"sharp"` або `"@img/sharp-linuxmusl-arm64"`.

Повертає:

- `true`, якщо `name` присутній у списку `NATIVE_ADDON_PACKAGES` (точне співпадіння), **або** починається з будь-якого з префіксів `NATIVE_ADDON_SCOPES` (наприклад, `@img/`).
- `false` в усіх інших випадках.

Алгоритм:

1. Якщо `NATIVE_ADDON_PACKAGES.includes(name)` — повернути `true`. Аргумент `name` кастомним каста `/** @type {never} */` сатисфіє `readonly`-літерал-тип константи.
2. Інакше повернути результат `NATIVE_ADDON_SCOPES.some(scope => name.startsWith(scope))`.

Side effects: відсутні. Чиста функція.

### `getNativeAddonDeps(dependencies)`

Сигнатура:

```js
getNativeAddonDeps(dependencies: unknown): string[]
```

Параметри:

- `dependencies` — значення поля `dependencies` з `package.json`. Тип навмисно `unknown` — функція сама перевіряє форму вхідних даних.

Повертає:

- Відсортований за локалізованим порядком (`String#localeCompare`) масив ключів `dependencies`, відфільтрованих через `isNativeAddonPackage`.
- Порожній масив `[]`, якщо `dependencies` має невалідну форму (falsy, не об'єкт, або масив), або якщо серед ключів немає нативних аддонів.

Алгоритм:

1. Якщо `!dependencies` (null/undefined/інше falsy), або `typeof dependencies !== 'object'`, або `Array.isArray(dependencies)` — повернути `[]`.
2. Зібрати ключі через `Object.keys(dependencies)`.
3. Відфільтрувати через `isNativeAddonPackage`.
4. Повернути копію, відсортовану через `.toSorted((a, b) => a.localeCompare(b))` (іммутабельне сортування, не мутує вихідний масив ключів).

Side effects: відсутні. Чиста функція; виклик `Object.keys` не мутує вхід.

### `getNativeAddonNoCompileHint(fileContent, nativeAddons)`

Сигнатура:

```js
getNativeAddonNoCompileHint(fileContent: string, nativeAddons: string[]): string | null
```

Параметри:

- `fileContent` — повний вміст Dockerfile або Containerfile як рядок.
- `nativeAddons` — масив імен нативних аддонів, попередньо знайдених у `dependencies` (результат `getNativeAddonDeps`).

Повертає:

- Рядок з повідомленням-підказкою про порушення, якщо тригер спрацював.
- `null`, якщо порушень не виявлено.

Тригер (умови, що мають виконатись усі одночасно):

1. `nativeAddons` — масив (`Array.isArray`) і непорожній.
2. У `fileContent` знайдено патерн `bun build --compile` за регуляркою `BUN_BUILD_COMPILE_RE` = `/\bbun\s+build\b[^\n]*\s--compile\b/iu` (нечутлива до регістру, юнікод-режим; шукає `bun build ... --compile` у межах одного рядка, бо `[^\n]*` забороняє перехід).

Якщо тригер не спрацював — повертається `null`.

Формування повідомлення (коли тригер спрацював):

1. Створюється масив `problems` з одним обов'язковим повідомленням про антипатерн `bun build --compile` + нативний аддон. Список аддонів вставляється через `nativeAddons.join(', ')`. Повідомлення містить інструкцію канонічного фіксу: прибрати compile-крок, ship-нути `node_modules` і запускати через `bun <entry>` на базі `mirror.gcr.io/oven/bun:alpine` (з посиланням на `docker.mdc`). Entry-файл рекомендується брати з `--outfile`-таргета, `package.json#main` або `scripts.start`; якщо однозначно визначити неможливо — лишити TODO-маркер, **не вгадувати**.
2. Якщо у `fileContent` додатково присутній патерн `apk add ... vips` (регулярка `APK_ADD_VIPS_RE` = `/\bapk\s+add\b[^\n]*\bvips\b/iu`) — додається друге повідомлення про те, що цей `apk add vips` зайвий: системний `libvips` не лікує брак `sharp.node`, його треба видалити разом із compile-кроком.
3. Усі повідомлення з'єднуються через роздільник `'\n     - '` (новий рядок + 5 пробілів + `- `), щоб формат був придатний для рендеру в pretty-output лінтера як вкладений список.

Side effects: відсутні. Чиста функція; жодних звернень до файлової системи, мережі чи глобального стану.

## Залежності

Зовнішні залежності модуля відсутні: ні npm-пакетів, ні Node-core модулів (`fs`/`path`/тощо) не імпортується. Файл — самодостатній.

Внутрішні константи модуля (приватні, не експортуються):

- `BUN_BUILD_COMPILE_RE` — `/\bbun\s+build\b[^\n]*\s--compile\b/iu`. Виявляє наявність флагу `--compile` біля `bun build` у межах одного рядка Dockerfile.
- `APK_ADD_VIPS_RE` — `/\bapk\s+add\b[^\n]*\bvips\b/iu`. Виявляє пакет `vips` серед аргументів `apk add` у межах одного рядка.

Зв'язки з іншими модулями репозиторію:

- Логічно є частиною правила `docker` (`npm/rules/docker/...`). Викликається з check-обгортки правила, яка читає Dockerfile/`package.json` і запускає `getNativeAddonDeps` + `getNativeAddonNoCompileHint`.
- Тематично пов'язаний із `../js/lint.mjs#getBunCompileHint` — там обробляється канон **без** нативних аддонів. Це окрема гілка з різним кінцевим артефактом (standalone-бінарник vs `bun <entry>`).
- За структурою копіює `./docker-mirror.mjs` — той самий клас dep-специфічного чек-модуля.

## Потік виконання / Використання

Типовий сценарій інтеграції модуля у правило `docker`:

1. Чекер правила читає `package.json` проєкту й бере поле `dependencies` (як `unknown`).
2. Викликає `getNativeAddonDeps(dependencies)` — отримує відсортований список нативних аддонів (можливо порожній).
3. Якщо список порожній — гілка перевірки завершується мовчки, нативно-аддонного антипатерну тут немає.
4. Якщо список непорожній — чекер читає вміст Dockerfile/`Containerfile` як рядок і викликає `getNativeAddonNoCompileHint(fileContent, nativeAddons)`.
5. Якщо результат — рядок, чекер додає його як помилку (зі схемою «hint») і пропонує канонічний фікс (відмова від `bun build --compile`; за наявності зайвого `apk add vips` — і його видалення).
6. Якщо результат — `null`, чекер вважає Dockerfile сумісним з нативним аддоном.

Приклад використання (псевдокод):

```js
import { getNativeAddonDeps, getNativeAddonNoCompileHint } from './docker-native-addon.mjs'

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const nativeAddons = getNativeAddonDeps(pkg.dependencies)
if (nativeAddons.length > 0) {
  const dockerfile = await readFile('Dockerfile', 'utf8')
  const hint = getNativeAddonNoCompileHint(dockerfile, nativeAddons)
  if (hint) reportError(hint)
}
```

Властивості та інваріанти, на які покладаються виклики:

- `getNativeAddonDeps` толерує будь-який вхід (`unknown`) і не кидає помилку.
- `getNativeAddonNoCompileHint` толерує невалідний `nativeAddons` (через `Array.isArray`-перевірку) — повертає `null`, замість того щоб впасти.
- Усі функції — чисті, без I/O, тож їх легко юніт-тестувати: достатньо передати рядкові константи й перевірити форму результату.
- Регулярки навмисно прості (одна-рядкові, через `[^\n]*`), щоб уникати false-positive на багаторядкових heredoc/RUN-блоках; ціна — потрібно, щоб `bun build --compile` і `apk add vips` були записані в межах одного рядка (стандартна практика Dockerfile).

Розширення модуля:

- Додати новий точний пакет — внести його у `NATIVE_ADDON_PACKAGES`.
- Додати новий scope, увесь вміст якого треба вважати нативним аддоном, — внести префікс у `NATIVE_ADDON_SCOPES` (з кінцевим `/`).
- Додаткові підказки про супутні зайві системні залежності (за аналогією з `apk add vips`) додавайте через нові регулярки + умовний `problems.push(...)`.
