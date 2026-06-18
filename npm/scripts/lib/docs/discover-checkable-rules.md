---
type: JS Module
title: discover-checkable-rules.mjs
resource: npm/scripts/lib/discover-checkable-rules.mjs
docgen:
  crc: 39016d17
---

Модуль `discover-checkable-rules.mjs` — це discovery-шар для CLI-команди `fix`. Його завдання — швидко просканувати файлову структуру каталогу `npm/rules/` та виявити «прогонні» правила, тобто правила, у яких є щонайменше один JS-концерн або policy-концерн. Правила, які складаються тільки з декларативних артефактів (`.mdc` + `auto.md`) без жодного прогонного концерну, відсіюються.

Виокремлюються два типи концернів:

- **JS concerns** — окремі файли `rules/<id>/js/<concern>.mjs`. Кожен файл — один концерн (flat-конвенція).
- **Policy concerns** — підкаталоги `rules/<id>/policy/<concern>/`, у яких присутній файл `target.json` (поруч із якого зазвичай лежить `<concern>.rego`).

Модуль свідомо не парсить вміст `target.json` і не читає JS-файли — це лише швидкий «структурний» скан (шляхи + назви) без I/O-вмісту. Парсинг покладено на runner.

Файли-помічники з префіксом `_` (зокрема каталог `_lib/`), тестові файли `*.test.mjs`, а також приховані файли/каталоги (`.`-префікс) ігноруються.

Історичний контекст конвенції розкладки JS-концернів:

- `js/<concern>/check.mjs` — версії 1.13.80–1.13.89 (вкладений каталог на концерн);
- `js/<concern>.mjs` — версії 1.13.90+ (flat: концерн = файл, а не каталог).

Допоміжні файли, тести, шаблони й дані винесені в окремі топ-level папки правила: `js/_lib/`, `tests/`, `templates/`, `data/`.

## Експорти / API

Модуль експортує дві асинхронні функції:

| Експорт                                   | Тип                                                | Призначення                                                                                    |
| ----------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `discoverOneRule(ruleDir, ruleId)`        | `async (string, string) => Promise<CheckableRule>` | Будує опис одного правила за заданим шляхом каталогу та id, без обходу `rules/`.               |
| `discoverCheckableRules(bundledRulesDir)` | `async (string) => Promise<CheckableRule[]>`       | Сканує цілий каталог `npm/rules/` і повертає масив правил, для яких є JS- або policy-концерни. |

Внутрішніми (не експортованими) залишаються функції `listJsConcerns` і `listPolicyConcerns`.

### Типи (JSDoc `@typedef`)

```text
JsConcern        { name: string }                                  // basename файла js/<name>.mjs без розширення
PolicyConcern    { name: string }                                  // imʼя підкаталогу policy/<name>/
CheckableRule    {
                   id: string,                                     // = basename каталогу rules/<id>/
                   jsConcerns: JsConcern[],                        // алфавітно
                   policyConcerns: PolicyConcern[],                // алфавітно
                 }
```

## Функції

### `listJsConcerns(jsDir)` (internal)

- **Сигнатура:** `async function listJsConcerns(jsDir: string): Promise<JsConcern[]>`
- **Параметри:**
  - `jsDir` — абсолютний шлях до каталогу `rules/<id>/js/`.
- **Повертає:** масив `JsConcern[]`, відсортований алфавітно за `name` через `Array.prototype.toSorted` із компаратором `localeCompare`.
- **Логіка:**
  1. Якщо каталог `jsDir` не існує (`existsSync` повертає `false`) — повертається `[]`.
  2. Читається вміст через `readdir(jsDir, { withFileTypes: true })` — тобто отримуються `Dirent`-обʼєкти з метаінформацією.
  3. Пропускаються:
     - сутності, що не є файлом (`!entry.isFile()`);
     - файли без розширення `.mjs`;
     - тестові файли `*.test.mjs`;
     - службові файли з префіксом `_` (наприклад вміст `_lib/`, хоча сам `_lib` як каталог не буде файлом і відсіється раніше);
     - приховані файли з префіксом `.`.
  4. Для решти файлів обчислюється `name = entry.name.slice(0, -'.mjs'.length)` — basename без розширення.
- **Side effects:** лише файлові читання (`existsSync`, `readdir`), без запису.

### `listPolicyConcerns(policyDir)` (internal)

- **Сигнатура:** `async function listPolicyConcerns(policyDir: string): Promise<PolicyConcern[]>`
- **Параметри:**
  - `policyDir` — абсолютний шлях до каталогу `rules/<id>/policy/`.
- **Повертає:** масив `PolicyConcern[]`, відсортований алфавітно за `name`.
- **Логіка:**
  1. Якщо `policyDir` не існує — повертається `[]`.
  2. Читається вміст з `withFileTypes: true`.
  3. Пропускаються будь-які записи, що не є каталогом, а також приховані каталоги (префікс `.`).
  4. Для кожного підкаталогу перевіряється наявність файла `target.json` через `existsSync(join(policyDir, entry.name, 'target.json'))`. Якщо `target.json` є — підкаталог зараховується як policy-концерн.
- **Side effects:** лише файлові читання, без запису.

### `discoverOneRule(ruleDir, ruleId)` (exported)

- **Сигнатура:** `export async function discoverOneRule(ruleDir: string, ruleId: string): Promise<CheckableRule>`
- **Параметри:**
  - `ruleDir` — абсолютний шлях до каталогу правила `rules/<id>/`;
  - `ruleId` — ідентифікатор правила, зазвичай `basename(ruleDir)`. Передається явно, бо функція не виводить його з шляху самостійно.
- **Повертає:** обʼєкт `CheckableRule` з полями `id`, `jsConcerns`, `policyConcerns`. На відміну від `discoverCheckableRules`, тут не виконується фільтрація «має бути хоч щось» — повертається опис як є (можуть бути порожні масиви концернів).
- **Логіка:** паралельно (точніше — послідовно `await`-ить) запускає `listJsConcerns(join(ruleDir, 'js'))` і `listPolicyConcerns(join(ruleDir, 'policy'))` та збирає результати в обʼєкт.
- **Використання:** викликається `runStandardRule`-flow для per-rule entry-point, коли потрібно отримати опис конкретного правила, а не сканувати весь каталог.
- **Side effects:** лише читання файлової системи.

### `discoverCheckableRules(bundledRulesDir)` (exported)

- **Сигнатура:** `export async function discoverCheckableRules(bundledRulesDir: string): Promise<CheckableRule[]>`
- **Параметри:**
  - `bundledRulesDir` — абсолютний шлях до кореневого каталогу всіх правил (зазвичай `npm/rules/`).
- **Повертає:** масив `CheckableRule[]`, відсортований алфавітно за `id`. Включаються тільки правила, у яких `jsConcerns.length > 0 || policyConcerns.length > 0`.
- **Логіка:**
  1. Якщо `bundledRulesDir` не існує — повертається `[]`.
  2. Читається вміст каталогу з `withFileTypes: true`.
  3. Пропускаються сутності, які не є каталогом, та приховані каталоги (префікс `.`).
  4. Для кожного підкаталогу формується `ruleDir = join(bundledRulesDir, entry.name)` і викликається `discoverOneRule(ruleDir, entry.name)`.
  5. Правила, у яких немає жодного JS- або policy-концерну (декларативні-only), відсіюються.
- **Side effects:** лише читання файлової системи (без запису, без мережевих викликів).

## Залежності

Виключно зовнішні стандартні модулі Node.js:

- `node:fs` → `existsSync` — синхронна перевірка існування шляху;
- `node:fs/promises` → `readdir` — асинхронне читання вмісту каталогу (з `withFileTypes: true` повертає `Dirent[]`);
- `node:path` → `join` — кросплатформова конкатенація шляхів.

Внутрішніх імпортів з інших модулів проєкту немає. Це робить модуль чистим discovery-шаром без бізнес-логіки, що дозволяє безпечно його тестувати ізольовано (потрібна лише підготовлена файлова структура у тимчасовому каталозі).

Зворотні залежності (хто використовує цей модуль): runner-флоу CLI `fix` (зокрема `runStandardRule`), який після discovery читає `target.json` для policy-концернів і виконує JS-концерни.

## Потік виконання / Використання

### Типовий сценарій 1. Повний скан правил для CLI `fix`

```javascript
import { discoverCheckableRules } from './discover-checkable-rules.mjs'

const rules = await discoverCheckableRules('/abs/path/to/npm/rules')
for (const rule of rules) {
  // rule.id, rule.jsConcerns, rule.policyConcerns
}
```

Послідовність дій усередині:

1. `discoverCheckableRules` перевіряє існування кореневого каталогу.
2. Перебирає підкаталоги верхнього рівня (= потенційні правила).
3. Для кожного підкаталогу викликає `discoverOneRule`, який своєю чергою:
   - сканує `rules/<id>/js/` через `listJsConcerns`;
   - сканує `rules/<id>/policy/` через `listPolicyConcerns`;
4. Якщо знайдено хоч один концерн — правило додається у вихідний масив.
5. Масив сортується за `id`.

### Типовий сценарій 2. Per-rule entry-point

```javascript
import { discoverOneRule } from './discover-checkable-rules.mjs'

const rule = await discoverOneRule('/abs/path/to/npm/rules/n-js-lint', 'n-js-lint')
// rule.id === 'n-js-lint'
// rule.jsConcerns — список JS-концернів у js/
// rule.policyConcerns — список policy-концернів у policy/
```

Цей шлях оминає енумерацію всього `rules/`, що корисно коли id правила вже відомий (наприклад, передано аргументом CLI).

### Гарантії та обмеження

- **Чистота:** функції — read-only (не пишуть у ФС, не виконують код концернів). Це дозволяє безпечно викликати їх повторно.
- **Сортування:** усі результати алфавітно відсортовані через `toSorted` із `localeCompare`. Це робить вивід детермінованим між запусками й між платформами (хоч порядок `readdir` залежить від ФС).
- **Толерантність до відсутніх каталогів:** будь-яка з директорій (`rules/`, `js/`, `policy/`) може бути відсутня — повертається порожній масив без помилки.
- **Тести/хелпери:** файли з префіксом `_` і `*.test.mjs` гарантовано виключаються із JS-концернів.
- **Що _не_ робиться:** не валідуються імена концернів, не парситься `target.json`, не перевіряється наявність `<name>.rego` поруч із `target.json`. Це робота runner-а.

### Eage cases

- Файл з префіксом `.` у `js/` — пропускається.
- Підкаталог у `js/` (наприклад `_lib/`) — не є файлом, відсіюється першою перевіркою `entry.isFile()`.
- Підкаталог у `policy/` без `target.json` — пропускається; наявність `<name>.rego` без `target.json` не зараховується.
- Порожнє правило (тільки `.mdc`/`auto.md` без `js/` і `policy/`) — не потрапляє у вихід `discoverCheckableRules`, але буде повернене з порожніми масивами в `discoverOneRule`.
