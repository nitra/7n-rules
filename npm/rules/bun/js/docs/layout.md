# layout.mjs — перевірка відповідності правилам Bun (`bun.mdc`)

## Огляд

Модуль `npm/rules/bun/js/layout.mjs` — це JS-частина rule-перевірки **bun** для CLI `@nitra/cursor`. Він перевіряє ту частину правил `bun.mdc`, яку **неможливо** покрити Rego-політиками з `npm/policy/bun/*` (тобто FS-existence та cross-file зв'язки між `.n-cursor.json` і `package.json`).

Призначений запускатися як check у кореневому репозиторії (`cwd = process.cwd()`). Перевіряє три блоки інваріантів:

1. **FS-наявність обовʼязкових файлів** монорепозиторію Bun:
   - `bun.lock` (lockfile від `bun i`);
   - `bunfig.toml` (наявність файла; структуру (`[install].linker == "hoisted"`) перевіряє Rego — `npm/policy/bun/bunfig/`);
   - `package.json` у корені.
2. **Заборонені артефакти конкурентних пакет-менеджерів** (yarn / pnpm / npm):
   - файли `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `.yarnrc.yml`;
   - директорія `.yarn/`.
3. **Двосторонній зв'язок** між `.n-cursor.json:rules` / `disable-rules` та `package.json:scripts` для правил, що мають окрему `lint-<id>`-обгортку:
   - правило активне (присутнє у `rules`) → скрипт `lint-<id>` мусить існувати;
   - правило не активне (немає в `rules` або є в `disable-rules`) → скрипту `lint-<id>` і токена `bun run lint-<id>` в агрегованому `scripts.lint` **не може** бути (інакше `bun run lint` падатиме на правилі, яке у конфізі вимкнено).

Те, що покриває **Rego** (тобто **не** перевіряється цим файлом):
- `npm/policy/bun/bunfig/` — `[install].linker == "hoisted"` у `bunfig.toml`;
- `npm/policy/bun/package_json/` — відсутність `packageManager` / `dependencies` у кореневому `package.json`, у `devDependencies` лише пакети `@nitra/*`, агрегований `lint`-скрипт покриває всі `lint-*` через `bun run` і завершується `&& oxfmt .`.

JS-копії перевірок `devDependencies` (історично — `isAllowedRootDevDependency`) **видалено**, щоб уникнути дублювання джерела істини.

Звітування винесене в `createCheckReporter()` з `../../../scripts/lib/check-reporter.mjs`: модуль не друкує сам, а викликає `pass(msg)` / `fail(msg)`, після чого повертає `reporter.getExitCode()` (`0` — все OK, `1` — є провали).

## Експорти / API

Модуль експортує **одну** іменовану функцію:

| Експорт | Сигнатура | Призначення |
| --- | --- | --- |
| `check` | `async (cwd?: string) => Promise<number>` | Точка входу check-у; повертає exit-код (`0` / `1`). |

Усе інше (`WHITESPACE_RE`, `RULE_SCRIPTS`, `loadNCursorRules`, `lintChainHasScript`, `backtickJoin`, `ownerStatus`, `checkCursorRuleScripts`) — **внутрішні** (module-private), не експортуються.

## Константи

### `WHITESPACE_RE`

```js
const WHITESPACE_RE = /\s+/u
```

Регулярний вираз для розділення значення `scripts.lint` на токени (послідовність пробільних символів). Використовується в `lintChainHasScript` для безпечного матчингу токена `bun run <script>` як **окремого** токена (а не префікса). Прапорець `u` — Unicode-сумісний матчинг пробілів.

### `RULE_SCRIPTS`

```js
const RULE_SCRIPTS = [
  { rules: ['docker'], script: 'lint-docker', doc: 'docker.mdc' },
  { rules: ['k8s'], script: 'lint-k8s', doc: 'k8s.mdc' },
  { rules: ['image-avif', 'image-compress'], script: 'lint-image', doc: 'image-avif.mdc / image-compress.mdc' }
]
```

Декларативна таблиця обгорток `lint-<id>` та їхніх правил-власників. Один скрипт може мати **кілька** власників (`lint-image` обслуговує і `image-avif`, і `image-compress`); скрипт вважається «потрібним», якщо **хоча б одне** з власних правил активне у `.n-cursor.json:rules`.

Кожен елемент має тип `RuleScript`:

```ts
type RuleScript = {
  rules: string[]    // id правил-власників (>= 1); поки активний хоча б один — скрипт обовʼязковий
  script: string     // ім'я скрипта в package.json:scripts (напр. "lint-docker")
  doc: string        // .mdc-файл (або кома-список) для повідомлення check-у
}
```

Розширення таблиці — єдиний спосіб додати нову `lint-<id>`-обгортку під перевірку двостороннього звʼязку.

## Функції

### `loadNCursorRules(cwd)`

```js
async function loadNCursorRules(cwd: string): Promise<{ rules: Set<string>, disabled: Set<string> }>
```

Зчитує `.n-cursor.json` із кореня репозиторію та повертає набори активних і явно вимкнених правил.

**Параметри:**
- `cwd` — абсолютний шлях до кореня репозиторію.

**Повертає:** `Promise<{ rules: Set<string>, disabled: Set<string> }>`:
- `rules` — `Set` рядків зі значення `rules` у JSON; якщо поле відсутнє або не масив — порожній `Set`.
- `disabled` — `Set` рядків зі значення `disable-rules`; якщо поле відсутнє або не масив — порожній `Set`.

**Поведінка при помилках (fail-safe):**
- файл `.n-cursor.json` відсутній — повертає `{ rules: new Set(), disabled: new Set() }`;
- помилка `JSON.parse` — повертає той самий «порожній» обʼєкт (через `try/catch` без логування).

**Side effects:** виключно `fs.promises.readFile` (асинхронне читання UTF-8) та `existsSync` для перевірки наявності.

### `lintChainHasScript(lintScript, target)`

```js
function lintChainHasScript(lintScript: string, target: string): boolean
```

Перевіряє, чи містить chain зі `scripts.lint` виклик саме `bun run <target>` **як окремий токен**.

**Параметри:**
- `lintScript` — значення `scripts.lint` (або порожній рядок, якщо його немає).
- `target` — ім'я скрипта без префіксів (`lint-docker`, `lint-k8s`, `lint-image`).

**Повертає:** `boolean` — `true`, якщо в розбитому за пробілами chain'і знайдено послідовність токенів `bun`, `run`, `<target>` поруч.

**Чому саме «токени», а не `String.prototype.includes`:** інакше виникне false-positive для `bun run lint-k8s-foo`, який матчиться як префікс `bun run lint-k8s`. Розбиття за `WHITESPACE_RE` усуває цю проблему — кожен токен порівнюється повним рівнем.

**Side effects:** немає (чиста функція).

### `backtickJoin(items, sep)`

```js
function backtickJoin(items: string[], sep: string): string
```

Загортає кожен елемент у backticks і зʼєднує через `sep`. Винесено окремо, щоб не нестити template literals у `pass` / `fail`-повідомленнях.

**Параметри:**
- `items` — масив ідентифікаторів (наприклад id правил).
- `sep` — роздільник (`', '` для перерахування, `'/'` для альтернативного списку).

**Повертає:** рядок виду `` `a`, `b` `` (або `` `a`/`b` ``).

**Side effects:** немає (чиста функція).

### `ownerStatus(owners, cursorRules)`

```js
function ownerStatus(
  owners: string[],
  cursorRules: { rules: Set<string>, disabled: Set<string> }
): { enabled: string[], reason: string }
```

Описує стан правил-власників скрипта для повідомлень про `reason`. Повертає або список увімкнених власників (для passing-кейсу «правило є»), або компактний опис, чому всі вимкнені (для inverse-fail).

**Параметри:**
- `owners` — id правил-власників (`>= 1`).
- `cursorRules` — `{ rules, disabled }`, отриманий від `loadNCursorRules`.

**Повертає:** `{ enabled, reason }`:
- `enabled` — підмасив `owners`, які присутні в `cursorRules.rules`.
- `reason` — людинозрозумілий текст про стан правил для логу:
  - якщо є хоча б один активний — `` правило `x` `` або `` правила `x`, `y` `` (з узгодженням числа: `правило` / `правила`);
  - якщо власник один і не активний — `` правило `x` `` + (`в disable-rules` | `відсутнє в rules`);
  - якщо власників кілька й жоден не активний — `` `a`/`b` `` + (`усі власники в disable-rules` | `жоден власник не активний у rules`); вибір ноти залежить від того, чи **всі** власники у `disable-rules`, чи лише «не в rules».

**Side effects:** немає (чиста функція).

### `checkCursorRuleScripts(reporter, scripts, cursorRules)`

```js
function checkCursorRuleScripts(
  reporter: { pass: (msg: string) => void, fail: (msg: string) => void },
  scripts: Record<string, string>,
  cursorRules: { rules: Set<string>, disabled: Set<string> }
): void
```

Перевіряє двосторонній зв'язок `rules` ↔ `scripts.lint-<id>` для всіх записів із `RULE_SCRIPTS`.

**Параметри:**
- `reporter` — обʼєкт з callback-ами `pass(msg)` / `fail(msg)` (від `createCheckReporter()`).
- `scripts` — обʼєкт `scripts` із розпарсеного `package.json`.
- `cursorRules` — `{ rules, disabled }` з `loadNCursorRules`.

**Алгоритм на кожен запис `RULE_SCRIPTS`:**

1. `status = ownerStatus(owners, cursorRules)`.
2. `present = Boolean(scripts[script])` — чи є скрипт у `package.json:scripts`.
3. `inChain = lintChainHasScript(scripts.lint, script)` — чи згаданий `bun run <script>` у chain'і `scripts.lint` (якщо `scripts.lint` не рядок — `lintScript = ''`).
4. **Якщо хоч одне правило-власник активне** (`status.enabled.length > 0`):
   - `present === true` → `pass`: `` package.json: є `<script>` (<reason> у .n-cursor.json) ``;
   - `present === false` → `fail`: `` У .n-cursor.json увімкнено <reason> — додай скрипт `<script>` у кореневий package.json (див. <doc>) ``;
   - далі `continue` (не перевіряємо inverse-кейс).
5. **Якщо жоден власник не активний:**
   - `present === true` → `fail`: `` У .n-cursor.json немає активних власників `a`/`b` — прибери скрипт `<script>` з кореневого package.json (див. <doc>) ``;
   - `inChain === true` → `fail`: `` У `scripts.lint` є `bun run <script>`, але серед `a/b` жоден не активний у .n-cursor.json — прибери з ланцюжка lint (див. <doc>) ``;
   - `!present && !inChain` → `pass`: `` package.json: `<script>` відсутній (<reason>) ``.

Зверни увагу: коли `present === true` і `inChain === true` одночасно (при неактивних власниках), будуть **два** `fail`-повідомлення — окремо про скрипт і окремо про chain. Це дозволяє лагодити обидва місця одним проходом.

**Side effects:** виклики `reporter.pass()` / `reporter.fail()` (тобто акумуляція в звіт, що формує exit-код).

### `check(cwd?)` — публічна точка входу

```js
export async function check(cwd: string = process.cwd()): Promise<number>
```

**Параметри:**
- `cwd` — корінь репозиторію. За замовчуванням — `process.cwd()`.

**Повертає:** `Promise<number>` — exit-код від `reporter.getExitCode()`: `0` (усі перевірки pass) або `1` (є хоча б один `fail`).

**Послідовність перевірок:**

1. Створюється `reporter = createCheckReporter()`; деструктуруються `{ pass, fail }`.
2. **Заборонені lockfile / конфіги конкурентних PM:** для кожного з `['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']` — `existsSync` → `fail`("Знайдено заборонений файл: ..."); інакше `pass`("Немає ...").
3. **Директорія `.yarn/`** — `existsSync` → `fail`("Знайдено директорію .yarn — видали її") / `pass`("Немає .yarn/").
4. **`bun.lock`** — `existsSync` → `pass`("bun.lock є") / `fail`("Відсутній bun.lock — запусти bun i").
5. **`bunfig.toml`** — `existsSync` → `pass` (з підказкою, що структуру перевіряє Rego через `npx @nitra/cursor fix → bun.bunfig`) / `fail` ("Відсутній bunfig.toml — створи з `[install] linker = \"hoisted\"` (bun.mdc)").
6. **Завантаження `.n-cursor.json`** через `loadNCursorRules(cwd)`.
7. **Кореневий `package.json`:**
   - якщо відсутній → `fail`("Відсутній package.json у корені") і **ранній вихід** через `return reporter.getExitCode()` (далі чекери не виконуються);
   - інакше — читається через `readFile(...,'utf8')` + `JSON.parse`.
8. **`scripts`** береться як `pkg.scripts` (з захистом від `null`/не-обʼєктів через `typeof === 'object'`); якщо `scripts` некоректний — `{}`.
9. **Виклик** `checkCursorRuleScripts(reporter, scripts, cursorRules)`.
10. **Повернення** `reporter.getExitCode()`.

**Side effects:**
- синхронні читання FS через `existsSync` (≥ 8 викликів);
- асинхронне читання `.n-cursor.json` і `package.json` через `fs/promises.readFile`;
- мутація стану `reporter` через `pass` / `fail`;
- `JSON.parse` обох конфігів — для `package.json` **без** `try/catch` (битий JSON у корені призведе до `throw` назовні; це усвідомлений вибір — кореневий `package.json` має бути валідним JSON, інакше нічого не запуститься).

## Залежності

### Зовнішні (Node.js core)

- `node:fs` → `existsSync` — синхронна перевірка FS-існування файлів і директорії `.yarn/`.
- `node:fs/promises` → `readFile` — асинхронне читання `.n-cursor.json` і `package.json` (UTF-8).
- `node:path` → `join` — побудова шляхів у `cwd`.

### Внутрішні

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика репортера з API `{ pass, fail, getExitCode }`. Це **єдина** проєктна залежність модуля; усі повідомлення йдуть через неї, exit-код — теж.

### Що **не** імпортується (свідомо)

- Rego-логіка політик `npm/policy/bun/*` — викликається окремо через `npx @nitra/cursor check` / `fix`; цей модуль ані не запускає Rego, ані не дублює його перевірки.
- Жодних спільних утиліт для роботи з `package.json` — `JSON.parse` робиться інлайн, бо схема локальна (потрібен лише `scripts`).

## Потік виконання / Використання

### Як викликається з CLI

Файл `layout.mjs` — це JS-частина rule-перевірки `bun` (директорія `npm/rules/bun/js/`). CLI `@nitra/cursor` (через свій диспатчер у `npm/cli/*` та `npm/scripts/lint/*`) автоматично знаходить такі `layout.mjs`-точки входу для всіх включених у `.n-cursor.json:rules` правил і викликає експортовану `check(cwd)`. Exit-код пробрасується назовні: якщо `check` повертає `1`, CLI рапортує `fail` цього rule-у, що далі піднімається на рівень агрегованого `bun run lint`.

### Типовий потік

```
n-cursor check / lint (CLI)
        |
        v
import { check } from 'npm/rules/bun/js/layout.mjs'
        |
        v
check(cwd)
        |
        +-> existsSync × forbidden files / .yarn          -> pass | fail
        |
        +-> existsSync bun.lock / bunfig.toml             -> pass | fail
        |
        +-> loadNCursorRules(cwd)
        |       \-> readFile '.n-cursor.json' (silent on error)
        |
        +-> readFile + JSON.parse 'package.json'
        |       (early return on missing)
        |
        +-> checkCursorRuleScripts(reporter, scripts, cursorRules)
        |       \-> for each RULE_SCRIPTS:
        |             ownerStatus -> lintChainHasScript -> pass/fail
        |
        +-> return reporter.getExitCode()  // 0 | 1
```

### Сценарій A — все OK

`.n-cursor.json`:

```json
{ "rules": ["docker", "k8s"] }
```

`package.json:scripts`:

```json
{
  "lint-docker": "n-cursor lint-docker",
  "lint-k8s": "n-cursor lint-k8s",
  "lint": "bun run lint-docker && bun run lint-k8s && oxfmt ."
}
```

- `bun.lock`, `bunfig.toml`, `package.json` — присутні.
- Жоден із заборонених файлів / `.yarn/` не існує.
- Для `docker` і `k8s` — `enabled.length > 0`, `present === true` → два `pass`.
- Для `lint-image` — жоден власник (`image-avif`/`image-compress`) не активний, скрипт відсутній, у chain'і його немає → `pass` ("`lint-image` відсутній (`image-avif`/`image-compress` — жоден власник не активний у rules)").
- Exit-код: `0`.

### Сценарій B — k8s у `disable-rules`, але `lint-k8s` залишився

`.n-cursor.json`:

```json
{ "disable-rules": ["k8s"] }
```

`package.json:scripts`:

```json
{
  "lint-k8s": "n-cursor lint-k8s",
  "lint": "bun run lint-k8s && oxfmt ."
}
```

- `ownerStatus(['k8s'], ...)` → `enabled: []`, `reason: "правило \`k8s\` в disable-rules"`.
- `present === true` → `fail`: "У .n-cursor.json немає активних власників `k8s` — прибери скрипт `lint-k8s` з кореневого package.json (див. k8s.mdc)".
- `inChain === true` → `fail`: "У `scripts.lint` є `bun run lint-k8s`, але серед `k8s` жоден не активний у .n-cursor.json — прибери з ланцюжка lint (див. k8s.mdc)".
- Exit-код: `1`.

### Сценарій C — `image-avif` активний, `lint-image` відсутній

`.n-cursor.json`:

```json
{ "rules": ["image-avif"] }
```

`package.json:scripts`: (немає `lint-image`)

- `ownerStatus(['image-avif', 'image-compress'], ...)` → `enabled: ['image-avif']`, `reason: "правило \`image-avif\`"`.
- `present === false` → `fail`: "У .n-cursor.json увімкнено правило `image-avif` — додай скрипт `lint-image` у кореневий package.json (див. image-avif.mdc / image-compress.mdc)".
- Exit-код: `1`.

### Сценарій D — відсутній `package.json`

- `pass` / `fail` по lockfile + `bun.lock` + `bunfig.toml` як завжди.
- Після `loadNCursorRules` — `existsSync(pkgPath) === false` → `fail`("Відсутній package.json у корені") і **ранній `return`**.
- `checkCursorRuleScripts` **не викликається**.
- Exit-код: `1`.

### Контракт із Rego / `.mdc`

Цей файл є JS-частиною rule `bun`. Він **доповнює** Rego-політики `npm/policy/bun/bunfig/` і `npm/policy/bun/package_json/`, які перевіряють структуру файлів (а не їх існування або crossref). Опис правила людською мовою — у `bun.mdc` (на нього посилаються `pass`/`fail`-повідомлення про `bunfig.toml`).

При додаванні нової `lint-<id>`-обгортки достатньо розширити масив `RULE_SCRIPTS` — функції `ownerStatus`, `checkCursorRuleScripts`, `lintChainHasScript` та `backtickJoin` працюють декларативно й нової JS-логіки не потребують.

## Rebuild Test

Цей блок описує, що саме треба було б реалізувати, щоб отримати функціонально еквівалентний `layout.mjs` з нуля — для перевірки повноти документації:

1. **ESM-модуль** на стандартному Node.js (без зовнішніх пакетів окрім `createCheckReporter`).
2. Імпортувати `existsSync` з `node:fs`, `readFile` з `node:fs/promises`, `join` з `node:path`, `createCheckReporter` з `../../../scripts/lib/check-reporter.mjs`.
3. Оголосити константу `WHITESPACE_RE = /\s+/u`.
4. Оголосити масив `RULE_SCRIPTS` з трьох елементів (`docker`/`lint-docker`/`docker.mdc`, `k8s`/`lint-k8s`/`k8s.mdc`, `['image-avif','image-compress']`/`lint-image`/`'image-avif.mdc / image-compress.mdc'`).
5. Реалізувати `loadNCursorRules(cwd)`:
   - перевірити `existsSync(join(cwd, '.n-cursor.json'))`; якщо ні — повернути `{ rules: new Set(), disabled: new Set() }`;
   - `try { JSON.parse(await readFile(..., 'utf8')) } catch { return empty }`;
   - витягти `rules` і `disable-rules` як масиви (з захистом `Array.isArray`), кожен елемент привести `String(...)`, обернути в `Set`.
6. Реалізувати `lintChainHasScript(lintScript, target)`:
   - якщо `lintScript` falsy → `false`;
   - інакше `lintScript.split(WHITESPACE_RE)` і пошук послідовності токенів `bun`, `run`, `target` через `tokens.some((tok, i) => ...)`.
7. Реалізувати `backtickJoin(items, sep)` як `items.map(r => '`' + r + '`').join(sep)`.
8. Реалізувати `ownerStatus(owners, cursorRules)`:
   - `enabled = owners.filter(r => cursorRules.rules.has(r))`;
   - якщо `enabled.length > 0` → reason `правил{о|а} <backtickJoin(enabled, ', ')>` (узгодження числа);
   - інакше якщо `owners.length === 1` → reason `правило \`<x>\` <в disable-rules | відсутнє в rules>`;
   - інакше — підрахунок `disabledCount`; reason `<backtickJoin(owners, '/')> — <усі власники в disable-rules | жоден власник не активний у rules>`.
9. Реалізувати `checkCursorRuleScripts(reporter, scripts, cursorRules)`:
   - `lintScript = typeof scripts.lint === 'string' ? scripts.lint : ''`;
   - для кожного запису `RULE_SCRIPTS` обчислити `status`, `present`, `inChain`;
   - якщо `status.enabled.length > 0` → `pass` (present) / `fail` (!present) і `continue`;
   - інакше: `fail` якщо `present`; `fail` якщо `inChain`; `pass` якщо `!present && !inChain`.
10. Реалізувати `export async function check(cwd = process.cwd())`:
    - `reporter = createCheckReporter()`, деструктурувати `{ pass, fail }`;
    - цикл по `['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']` → fail/pass;
    - `.yarn/` директорія → fail/pass;
    - `bun.lock` → pass/fail("Відсутній bun.lock — запусти bun i");
    - `bunfig.toml` → pass(з підказкою про Rego) / fail("Відсутній bunfig.toml — створи з [install] linker = \"hoisted\" (bun.mdc)");
    - `cursorRules = await loadNCursorRules(cwd)`;
    - перевірка `package.json` → fail + ранній `return reporter.getExitCode()` якщо відсутній;
    - `pkg = JSON.parse(await readFile(pkgPath, 'utf8'))`;
    - `scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}`;
    - `checkCursorRuleScripts(reporter, scripts, cursorRules)`;
    - `return reporter.getExitCode()`.
11. Експортувати **тільки** `check`.
