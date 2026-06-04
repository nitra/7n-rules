# lint.mjs — PHP lint runner

## Огляд

Модуль `lint.mjs` реалізує крок `lint-php` згідно з правилом `php.mdc`. Він виконує статичний та безпековий аналіз PHP-проєкту, який лежить у поточному робочому каталозі (`process.cwd()`), послідовно прогоняючи такі інструменти:

1. `composer audit --no-interaction` — обовʼязковий аудит залежностей через Composer.
2. `vendor/bin/php-cs-fixer fix --dry-run --diff` — перевірка стилю без модифікації файлів.
3. `vendor/bin/phpcs --standard=Security ...` — перевірка зі стандартом Security для типових директорій коду.
4. `vendor/bin/phpstan analyse --no-progress` — статичний аналіз.
5. `vendor/bin/psalm --no-cache` — додатковий статичний аналіз.

Ключові властивості модуля:

- Якщо в корені репозиторію **немає** `composer.json` — скрипт нічого не запускає й завершується успіхом (`pass` + код виходу 0).
- Якщо `composer.json` є, але `composer` недоступний у `PATH` — це фатальна помилка (`fail`).
- Інструменти з `vendor/bin/*` запускаються лише за наявності відповідного бінарника; відсутній інструмент **не** є помилкою, лише пропускається з відповідним `pass`-повідомленням.
- Помилка будь-якого запущеного інструмента (ненульовий exit code) призводить до негайного завершення з кодом помилки — наступні кроки **не** виконуються (fail-fast).
- Результат акумулюється через `createCheckReporter()`, а підсумковий код виходу дає `reporter.getExitCode()`.

Файл одночасно є модулем (з експортами для повторного використання й тестування) та CLI-точкою входу (через `isRunAsCli(import.meta.url)`).

## Експорти / API

Модуль експортує дві функції:

- `getPhpcsCodePaths(root: string): string[]` — обчислює список директорій для PHPCS.
- `run(): number` — основна точка входу; повертає код виходу (0 — OK, 1 — є помилки).

Функції `vendorBin`, `runTool` і вкладена `runOptionalVendorTool` є приватними (не експортуються) і використовуються тільки всередині модуля.

Коли модуль виконується безпосередньо як CLI (через `node` чи `bun`), у блоці `if (isRunAsCli(import.meta.url))` викликається `run()`, а результат присвоюється `process.exitCode`.

## Функції

### `getPhpcsCodePaths(root)`

Сигнатура: `getPhpcsCodePaths(root: string): string[]`

Параметри:

- `root` — абсолютний шлях до кореня репозиторію.

Повертає: масив відносних шляхів (рядків) до директорій, які варто передати у `phpcs`.

Алгоритм:

1. Перебирає константу `PHPCS_CODE_DIR_CANDIDATES = ['app', 'src', 'lib', 'public', 'www']`.
2. Для кожного імені `d` будує абсолютний шлях `join(root, d)` і перевіряє, що шлях існує **і** є директорією (`existsSync` + `statSync(...).isDirectory()`).
3. Якщо знайдено хоча б одну директорію — повертає масив усіх знайдених імен (як **відносні** імена, не абсолютні шляхи).
4. Якщо жодної не знайдено — повертає `['.']` (тобто PHPCS буде запущений по всьому кореню).

Side effects: лише читання файлової системи через `existsSync`/`statSync`. Файлів не модифікує.

### `vendorBin(root, name)` (private)

Сигнатура: `vendorBin(root: string, name: string): string | null`

Параметри:

- `root` — корінь репозиторію.
- `name` — імʼя файла у `vendor/bin` (наприклад, `phpstan`).

Повертає: абсолютний шлях `<root>/vendor/bin/<name>`, якщо файл існує; інакше `null`.

Side effects: `existsSync` (лише читання).

### `runTool(label, abs, args, pass, fail)` (private)

Сигнатура: `runTool(label: string, abs: string, args: string[], pass: (msg: string) => void, fail: (msg: string) => void): boolean`

Параметри:

- `label` — людиночитна назва кроку (наприклад, `"PHPStan"`), використовується в повідомленнях.
- `abs` — абсолютний шлях до CLI-бінарника.
- `args` — аргументи командного рядка.
- `pass` — callback для запису успіху в репортер.
- `fail` — callback для запису помилки в репортер.

Повертає: `true`, якщо процес завершився з кодом 0; `false` — інакше.

Алгоритм:

1. Запускає `spawnSync(abs, args, { stdio: 'inherit', shell: false })`. `stdio: 'inherit'` означає, що stdout/stderr дитячого процесу пробрасуються користувачу напряму.
2. Якщо `r.status === 0` — викликає `pass(\`lint-php: ${label} — OK\`)` і повертає `true`.
3. Інакше визначає код: якщо `r.status` — число, то воно; інакше `1` (захист від `null`, який трапляється, наприклад, при сигналі або провалі запуску).
4. Викликає `fail(\`lint-php: ${label} — помилка (код ${code}, php.mdc)\`)` і повертає `false`.

Side effects: запускає дочірній процес, успадковує stdio батьківського процесу.

### `run()`

Сигнатура: `run(): number`

Параметри: немає.

Повертає: код виходу — `0` (успіх) або `1` (хоча б одна помилка). Реальний код визначає `reporter.getExitCode()`.

Алгоритм (по кроках):

1. Створює репортер: `const reporter = createCheckReporter()`; деструктуризує `pass` і `fail` з нього.
2. Бере поточний робочий каталог: `const root = process.cwd()`.
3. Якщо `composer.json` у корені **відсутній** — викликає `pass('lint-php: немає composer.json у корені — кроки PHP пропущено')` і повертає `reporter.getExitCode()` (фактично 0).
4. Резолвить бінарник `composer` через `resolveCmd('composer')`. Якщо не знайдено — викликає `fail` з повідомленням про відсутність у `PATH` і виходить.
5. Запускає `composer audit --no-interaction` через `runTool`. Якщо крок провалився — негайно повертає поточний код виходу (далі нічого не виконується).
6. Оголошує вкладену функцію `runOptionalVendorTool(binName, label, args): boolean` (див. нижче).
7. Послідовно викликає `runOptionalVendorTool` для:
   - `php-cs-fixer` → label `"PHP-CS-Fixer (dry-run)"`, args `['fix', '--dry-run', '--diff']`.
   - `phpcs` → label `"phpcs (Security)"`, args `['--standard=Security', '--ignore=*/vendor/*,*/node_modules/*,*/.git/*', ...getPhpcsCodePaths(root)]`.
   - `phpstan` → label `"PHPStan"`, args `['analyse', '--no-progress']`.
   - `psalm` → label `"Psalm"`, args `['--no-cache']`.
8. Після кожного кроку, якщо він повернув `false` (тобто `runTool` зафейлився; пропуск через відсутність бінарника `false` **не** дає), функція негайно повертає `reporter.getExitCode()`.
9. Якщо всі кроки успішні — повертає `reporter.getExitCode()`.

Порядок кроків зафіксований: PHP-CS-Fixer → PHPCS → PHPStan → Psalm. Перший провал зупиняє конвеєр.

Side effects:

- Читає `process.cwd()` і файли в ньому.
- Резолвить `composer` через `PATH`.
- Спавнить дочірні процеси з успадкованим stdio.
- Не модифікує жодних файлів (PHP-CS-Fixer запускається в `--dry-run --diff`).
- Підсумково повертає число; не викликає `process.exit` самостійно (це робить CLI-обгортка через `process.exitCode`).

### `runOptionalVendorTool(binName, label, args)` (вкладена в `run`)

Сигнатура: `runOptionalVendorTool(binName: string, label: string, args: string[]): boolean`

Параметри:

- `binName` — імʼя файла у `vendor/bin`.
- `label` — назва кроку для повідомлень.
- `args` — аргументи CLI.

Повертає: `true`, якщо крок успішний **або** пропущений (бінарника немає); `false`, якщо крок виконано й він зафейлився.

Алгоритм:

1. Резолвить абсолютний шлях через `vendorBin(root, binName)`.
2. Якщо `null` — викликає `pass(\`lint-php: vendor/bin/${binName} — відсутній, крок пропущено\`)` і повертає `true`.
3. Інакше делегує `runTool(label, abs, args, pass, fail)` і повертає його результат.

Side effects: ті самі, що в `vendorBin` + `runTool` для виконуваного кроку.

## Залежності

### Стандартна бібліотека Node.js

- `node:child_process` → `spawnSync` — синхронний запуск дочірніх процесів.
- `node:fs` → `existsSync`, `statSync` — перевірка існування файлів і визначення, чи це директорія.
- `node:path` → `join`, `resolve` — побудова шляхів (`join` — для відносних, `resolve` — для абсолютних).

### Внутрішні модулі репозиторію (відносні шляхи)

- `../../../scripts/cli-entry.mjs` → `isRunAsCli` — детектор того, що поточний модуль запущений як CLI (порівнює `import.meta.url` зі стартовим файлом).
- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика репортера з полями `pass`, `fail`, `getExitCode()`. Усі повідомлення формату `lint-php: <label> — ...` йдуть саме через нього.
- `../../../scripts/utils/resolve-cmd.mjs` → `resolveCmd` — пошук бінарника в `PATH` (повертає шлях або `null`/`undefined`).

### Зовнішні CLI-залежності (виконувані файли)

- `composer` — має бути у `PATH`, якщо в проєкті є `composer.json`.
- `vendor/bin/php-cs-fixer`, `vendor/bin/phpcs`, `vendor/bin/phpstan`, `vendor/bin/psalm` — опційні; відсутній бінарник пропускає відповідний крок.

### Правило / контекст

- `php.mdc` — правило з `.cursor/rules/`, на яке посилається модуль (тексти повідомлень містять `php.mdc`).

## Потік виконання / Використання

### Запуск як CLI

```bash
node npm/rules/php/lint/lint.mjs
# або через bun
bun npm/rules/php/lint/lint.mjs
```

При CLI-запуску виконується блок:

```js
if (isRunAsCli(import.meta.url)) {
  process.exitCode = run()
}
```

Це означає, що процес завершиться з кодом, що повернула `run()` (0 або 1). Викид `throw` не очікується — усі помилки інструментів повідомляються через `fail`, а не через виключення.

### Імпорт як модуля

```js
import { run, getPhpcsCodePaths } from './lint.mjs'

const exitCode = run()
if (exitCode !== 0) {
  // обробка помилки
}
```

`getPhpcsCodePaths` корисна для тестування або для повторного використання логіки вибору директорій.

### Сценарії

1. **Немає `composer.json`** — повертає 0, нічого не запускає, пише в репортер `pass`-повідомлення.
2. **Є `composer.json`, але немає `composer`** — повертає 1, у репортері є `fail`.
3. **Є `composer.json` і `composer`, немає жодного `vendor/bin/*`** — запускається лише `composer audit`; якщо він пройде, повертає 0, інші кроки відмічаються як пропущені.
4. **Усі інструменти встановлені** — послідовний прогін: `composer audit` → `php-cs-fixer` → `phpcs` (за директоріями з `getPhpcsCodePaths`) → `phpstan` → `psalm`. Будь-який ненульовий exit-code дочірнього процесу перериває ланцюг і повертає 1.
5. **`composer.json` є, директорій `app`/`src`/`lib`/`public`/`www` немає** — PHPCS отримує єдиний шлях `.`.

### Особливості

- `spawnSync` запускається з `shell: false` — параметри передаються як масив, shell-інʼєкції неможливі.
- `stdio: 'inherit'` — повний вивід інструментів іде в термінал користувача; репортер додає лише підсумкові `pass/fail`-рядки.
- Fail-fast: модуль не агрегує помилки кількох інструментів; на першій помилці виходить.
- Усі повідомлення українською, із префіксом `lint-php:` для легкої грепабельності.
- Функція `run` не приймає аргументів — корінь визначається через `process.cwd()`, що дозволяє запускати її з будь-якого workspace без передавання шляху.
