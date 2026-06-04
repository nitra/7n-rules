# `package_setup.mjs` — перевірка вимог правила `image-compress.mdc`

## Огляд

Модуль `package_setup.mjs` реалізує `check`-функцію для правила `image-compress.mdc`. Правило вимагає, щоб у проєкті була налаштована оптимізація raster/SVG-зображень через CLI `@nitra/minify-image` ≥ 3.2.0 (запускається локально через `npx`).

У цьому файлі лишилися лише **FS / cross-file**-перевірки, які важко або незручно виразити декларативно у Rego:

- наявність `package.json` у корені репозиторію;
- `.n-minify-image.tsv` (committed source of truth split-cache 3.2.0 з полями sha1 / originalSize / size) **не** перебуває у `.gitignore` — файл має жити в git;
- застарілий `.minify-image-cache.tsv` (4-колонковий кеш з `@nitra/minify-image` < 3.2) видалений як з диска, так і з `.gitignore`.

Структурні вимоги до `package.json` (наявність `scripts.lint-image` з правильним викликом `npx @nitra/minify-image --src=. --write` без `--avif`, включення `bun run lint-image` в агрегований `lint`, відсутність `@nitra/minify-image` у `dependencies`/`devDependencies`) перевіряються Rego-політикою у `npm/rules/image-compress/policy/package_json/` і автофіксяться через `npx @nitra/cursor fix`.

CI-workflow для image-лінту правилом **не** вимагається — оптимізація відбувається лише локально перед комітом.

## Експорти / API

| Експорт | Тип | Призначення |
|---|---|---|
| `check(cwd?)` | `async function` | Публічна точка входу. Виконує перевірки правила `image-compress.mdc` для вказаного робочого каталогу й повертає exit-код (`0` — OK, `1` — є помилки). |

Модуль використовує ES Modules (`.mjs`), іменований експорт `check`. Default-експорту немає.

## Функції

### `readGitignoreLines(cwd)`

Приватна допоміжна функція для читання змістовних рядків `.gitignore`.

- **Сигнатура:** `async function readGitignoreLines(cwd: string): Promise<string[] | null>`
- **Параметри:**
  - `cwd` — абсолютний шлях до кореня репозиторію, де очікується `.gitignore`.
- **Повертає:**
  - `null`, якщо файл `.gitignore` відсутній;
  - масив рядків (`string[]`), кожен з яких уже `trim`-нутий, не порожній і не починається з `#`.
- **Side effects:** один синхронний `existsSync` і один асинхронний `readFile` (UTF-8) у файловій системі. Не пише нічого.
- **Поведінкові деталі:** коментарі визначаються лише за префіксом `#` на початку trim-нутого рядка; in-line коментарі (після `#` всередині рядка) не вирізаються.

### `checkHashCacheNotIgnored(pass, fail, cwd)`

Перевіряє, що файл `.n-minify-image.tsv` **не** перерахований у `.gitignore`. Файл є закомічуваним source of truth для split-cache 3.2.0 (зберігає sha1 + originalSize + size для slow-path і метрики lifetime savings), тому має потрапляти в git.

- **Сигнатура:** `async function checkHashCacheNotIgnored(pass: (msg: string) => void, fail: (msg: string) => void, cwd: string): Promise<void>`
- **Параметри:**
  - `pass` — callback, що викликається при успіху з людиночитаним повідомленням;
  - `fail` — callback, що викликається при провалі з повідомленням і вказівкою на дію;
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<void>`. Реєстрація результату здійснюється через `pass`/`fail` (зовнішній reporter).
- **Side effects:** одне читання `.gitignore` через `readGitignoreLines`.
- **Логіка:**
  - якщо `.gitignore` є й містить точний рядок `.n-minify-image.tsv` → `fail` з вимогою прибрати рядок;
  - інакше (файл відсутній або рядка немає) → `pass`.
- **Важливо:** сам факт існування `.n-minify-image.tsv` не вимагається. На новому проєкті без обробки зображень файла ще немає — і це нормально.

### `checkLegacyCacheRemoved(pass, fail, cwd)`

Перевіряє, що застарілий 4-колонковий кеш `.minify-image-cache.tsv` (з `@nitra/minify-image` < 3.2) повністю видалений з проєкту.

- **Сигнатура:** `async function checkLegacyCacheRemoved(pass: (msg: string) => void, fail: (msg: string) => void, cwd: string): Promise<void>`
- **Параметри:**
  - `pass` — callback для успішного звіту;
  - `fail` — callback для помилки;
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<void>`.
- **Side effects:** один `existsSync` на файл у корені; за умови, що файла нема, додатково читає `.gitignore`.
- **Логіка (виконується послідовно з `early return`):**
  1. Якщо `<cwd>/.minify-image-cache.tsv` **існує на диску** → `fail` з готовим bash-snippet для повного видалення (`git rm --cached … && rm -f …`) і нагадуванням прибрати рядок з `.gitignore`. Подальші перевірки в цій функції пропускаються.
  2. Інакше читає `.gitignore`; якщо там є точний рядок `.minify-image-cache.tsv` → `fail` з вимогою прибрати застарілий ігнор.
  3. Інакше → `pass` («міграція на split-cache завершена»).

### `check(cwd?)`

Експортована публічна функція — точка входу для агрегатора правил `@nitra/cursor`.

- **Сигнатура:** `export async function check(cwd: string = process.cwd()): Promise<number>`
- **Параметри:**
  - `cwd` — необов’язковий шлях до кореня репозиторію; за замовчуванням `process.cwd()`.
- **Повертає:** exit-код як `number` (`0` — все ок; `1` — є хоча б один `fail`). Значення формує `reporter.getExitCode()` з `createCheckReporter`.
- **Side effects:**
  - друк звіту в stdout/stderr через reporter (формат залежить від `createCheckReporter`);
  - читання файлів `package.json`, `.gitignore`, `.minify-image-cache.tsv` у `cwd`. Жодного запису на диск.
- **Поведінкові деталі:**
  1. Створює локальний `reporter` через `createCheckReporter()` і дістає з нього `pass`/`fail`.
  2. **Guard:** якщо в корені нема `package.json` — друкує `fail` із підказкою додати файл і **негайно повертає** `reporter.getExitCode()` (≈ `1`). Інші перевірки в цій ітерації не виконуються.
  3. Якщо `package.json` є — `pass` з нагадуванням, що структуру `scripts` перевіряє Rego через `npx @nitra/cursor fix → image_compress.package_json`.
  4. Виконує `checkHashCacheNotIgnored` (await).
  5. Виконує `checkLegacyCacheRemoved` (await).
  6. Повертає `reporter.getExitCode()`.

## Залежності

### Зовнішні (Node.js core)

- `node:fs`
  - `existsSync` — синхронна перевірка існування `package.json`, `.gitignore`, застарілого кешу;
- `node:fs/promises`
  - `readFile` — асинхронне читання `.gitignore` у кодуванні UTF-8;
- `node:path`
  - `join` — кросплатформена побудова шляхів від кореня репозиторію.

### Внутрішні

- `../../../scripts/lib/check-reporter.mjs`
  - `createCheckReporter()` — створює об’єкт із методами `pass(msg)`, `fail(msg)` і `getExitCode()`. Інкапсулює формат друку результатів і агрегацію статусу.

### Файли проєкту, з якими взаємодіє

- `<cwd>/package.json` — лише перевірка існування;
- `<cwd>/.gitignore` — читання й пошук рядків `.n-minify-image.tsv`, `.minify-image-cache.tsv`;
- `<cwd>/.minify-image-cache.tsv` — лише перевірка існування (legacy-файл, який має бути відсутній);
- `<cwd>/.n-minify-image.tsv` — **не** перевіряється напряму на диску, лише на присутність у `.gitignore`.

### Зовнішня політика

- `npm/rules/image-compress/policy/package_json/` — Rego-правила, які перевіряють і автофіксять структуру `package.json` (script `lint-image`, агрегований `lint`, відсутність залежності `@nitra/minify-image`).

## Потік виконання / Використання

### Як викликається

`check(cwd)` запускається оркестратором `@nitra/cursor` як одна з перевірок правила `image-compress.mdc`. У типовому сценарії команда `npx @nitra/cursor check` або `npx @nitra/cursor fix` обходить активні правила, для кожного імпортує його `check` і збирає звіт.

Можливий також прямий ESM-імпорт:

```js
import { check } from '@nitra/cursor/npm/rules/image-compress/js/package_setup.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Послідовність кроків усередині `check`

1. Створюється `reporter`, з нього дістаються `pass`/`fail`.
2. Перевірка наявності `package.json` (guard з early return при відсутності).
3. `await checkHashCacheNotIgnored(pass, fail, cwd)` — гарантує, що split-cache не виключений із git.
4. `await checkLegacyCacheRemoved(pass, fail, cwd)` — гарантує, що legacy-кеш не висить ні на диску, ні в `.gitignore`.
5. Повертається `reporter.getExitCode()`.

### Типові сценарії результату

- **Свіжий проєкт без зображень.** `package.json` є, `.gitignore` не містить ні `.n-minify-image.tsv`, ні `.minify-image-cache.tsv`, файлів на диску немає → три `pass`, exit-код `0`.
- **Проєкт з обробленими зображеннями (3.2+).** На диску є закомічений `.n-minify-image.tsv`, у `.gitignore` його немає, legacy-файла немає → exit-код `0`.
- **Незавершена міграція з 3.1 → 3.2.** На диску ще лежить `.minify-image-cache.tsv` → `fail` з готовим bash-snippet для очищення; exit-код `1`.
- **Помилково додано split-cache в `.gitignore`.** `.gitignore` містить `.n-minify-image.tsv` → `fail` з вимогою прибрати рядок; exit-код `1`.
- **Немає `package.json`.** Перша ж перевірка повертає `fail` і виконання обривається на guard-у; жодних інших перевірок не запускається; exit-код `1`.

### Розподіл відповідальності з Rego

| Перевірка | Де реалізована |
|---|---|
| Наявність `package.json` | `package_setup.mjs` |
| `.n-minify-image.tsv` не в `.gitignore` | `package_setup.mjs` |
| `.minify-image-cache.tsv` відсутній (диск + `.gitignore`) | `package_setup.mjs` |
| `scripts.lint-image` коректний (без `--avif`) | Rego (`policy/package_json/`) |
| `bun run lint-image` в агрегованому `lint` | Rego (`policy/package_json/`) |
| `@nitra/minify-image` не в `dependencies`/`devDependencies` | Rego (`policy/package_json/`) |

## Rebuild Test

Якщо файл `package_setup.mjs` втрачено, відтворіть його за такою специфікацією:

1. **Розташування:** `npm/rules/image-compress/js/package_setup.mjs` (ESM, розширення `.mjs`).
2. **Імпорти:**
   - `existsSync` з `node:fs`;
   - `readFile` з `node:fs/promises`;
   - `join` з `node:path`;
   - `createCheckReporter` з `../../../scripts/lib/check-reporter.mjs`.
3. **Константи модульного рівня:**
   - `HASH_CACHE_FILENAME = '.n-minify-image.tsv'`;
   - `LEGACY_CACHE_FILENAME = '.minify-image-cache.tsv'`.
4. **Приватна `readGitignoreLines(cwd)`:** будує шлях `<cwd>/.gitignore`; якщо файла нема — `return null`; інакше читає UTF-8, розбиває по `\n`, `trim` кожного рядка, фільтрує порожні й ті, що починаються з `#`; повертає масив.
5. **Приватна `checkHashCacheNotIgnored(pass, fail, cwd)`:** читає рядки `.gitignore`; якщо вони є й містять `HASH_CACHE_FILENAME` — `fail` (з підказкою прибрати рядок), інакше `pass` («не в .gitignore — має бути в git»).
6. **Приватна `checkLegacyCacheRemoved(pass, fail, cwd)`:**
   - якщо `<cwd>/<LEGACY_CACHE_FILENAME>` існує на диску — `fail` з готовим bash-snippet (`git rm --cached … 2>/dev/null || true && rm -f …`) і нагадуванням про `.gitignore`, потім `return`;
   - інакше читає `.gitignore`; якщо містить `LEGACY_CACHE_FILENAME` — `fail` (прибрати застарілий ігнор), потім `return`;
   - інакше `pass` («міграція на split-cache завершена»).
7. **Експортована `check(cwd = process.cwd())`:**
   - `const reporter = createCheckReporter()`; деструктурує `{ pass, fail }`;
   - якщо `<cwd>/package.json` не існує — `fail` («додай — image-compress.mdc») і одразу `return reporter.getExitCode()`;
   - інакше `pass` («package.json є; структуру перевіряє npx @nitra/cursor fix → image_compress.package_json»);
   - `await checkHashCacheNotIgnored(pass, fail, cwd)`;
   - `await checkLegacyCacheRemoved(pass, fail, cwd)`;
   - `return reporter.getExitCode()`.
8. **Інваріанти:**
   - модуль не пише на диск нічого;
   - `pass`/`fail` приймають лише `string` і викликаються рівно один раз на гілку логіки;
   - функція `check` завжди повертає `number`, навіть на guard-шляху;
   - усі шляхи будуються через `join(cwd, ...)`, ніяких рядкових конкатенацій.
9. **Текст повідомлень** містить посилання на правило `image-compress.mdc` і термін `split-cache 3.2.0`, щоб користувач у звіті бачив джерело вимоги.
