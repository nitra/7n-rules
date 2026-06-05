# gha-workflow.mjs

## Огляд

Модуль `gha-workflow.mjs` — це набір допоміжних чистих функцій для **структурного аналізу GitHub Actions workflow-файлів** (`.yml`) після їх розбору як YAML.

Призначення модуля — замінити крихкий пошук підрядків у сирому тексті workflow-файла на **типобезпечну** перевірку значень `uses:` та `run:` у кроках (`steps`) робіт (`jobs`). Модуль використовується сценаріями перевірки (checkers) проєктних правил:

- `check-ga` — загальна перевірка GitHub Actions workflows;
- `check-js-lint` — перевірка структури `lint-js.yml`;
- `check-text` — перевірка наявності викликів `bun run lint-text` у CI;
- `check-style-lint` — перевірка викликів стайл-лінту в CI;
- `check-npm-module` — перевірка workflow npm-модуля.

Крім перевірки значень `uses:` та `run:`, модуль уміє:

- розпізнавати локальну composite-action `./.github/actions/setup-bun-deps`;
- перевіряти, що `actions/checkout@v6` викликається з `with.persist-credentials: false`;
- виявляти заборонені в CI прапорці `--fix` у викликах `oxlint` та `eslint`;
- перевіряти включення точного `glob` у списки `on.push.paths` / `on.pull_request.paths`.

Модуль виконує лише читання та обчислення — він **не змінює** жодних файлів і **не виконує** жодних команд. Поведінка детермінована й залежить тільки від переданих аргументів.

## Експорти / API

Усі експорти з модуля — це **named exports** (іменовані експорти), `default export` немає.

| Експорт                                      | Тип      | Короткий опис                                                                            |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `parseWorkflowYaml(content)`                 | function | Парсить YAML вміст у звичайний об’єкт; при помилці повертає `null`.                      |
| `flattenWorkflowSteps(root)`                 | function | Збирає всі кроки з усіх jobs у плоский список з метаданими `{ jobId, stepIndex, step }`. |
| `getStepUses(step)`                          | function | Повертає значення `uses:` кроку або порожній рядок.                                      |
| `getStepRun(step)`                           | function | Повертає значення `run:` кроку (підтримує рядок та масив рядків).                        |
| `eventPathsIncludeExact(root, event, exact)` | function | Перевіряє, чи містить `on.<event>.paths` точне значення glob.                            |
| `verifyLintJsWorkflowStructure(root)`        | function | Виконує повний набір структурних перевірок для `lint-js.yml`.                            |
| `anyRunStepIncludes(root, needle)`           | function | Перевіряє, чи містить будь-який `run` кроку заданий підрядок.                            |

Внутрішні (неекспортовані) функції-помічники:

- `workflowJobsEntries(root)` — повертає `[jobId, job][]`;
- `workflowJobSteps(job)` — повертає масив об’єктних кроків job;
- `hasCheckoutWithPersistCredentialsFalse(steps)` — перевіряє `checkout@v6` з `persist-credentials: false`;
- `appendCiFixFlagFailures(failures, steps)` — додає у `failures` рядки про заборонені `--fix` у CI.

Внутрішні константи модуля:

- `CHECKOUT_V6_USES = 'actions/checkout@v6'` — очікувана дія checkout та її версія.
- `LOCAL_SETUP_BUN_DEPS_MARKER = './.github/actions/setup-bun-deps'` — шлях до локальної composite-action для встановлення Bun-залежностей.
- `BUNX_OXLINT_FIX_RE = /bunx\s+oxlint[^\n]*--fix/u` — регулярний вираз для виявлення `bunx oxlint ... --fix` в одному рядку.

## Функції

### `parseWorkflowYaml(content)`

**Сигнатура:** `parseWorkflowYaml(content: string): Record<string, unknown> | null`

**Параметри:**

- `content` — рядок із вмістом workflow-файла `.yml`.

**Повертає:**

- розібраний YAML як звичайний об’єкт (`Record<string, unknown>`), якщо вміст парситься і має тип `object` та не є `null`;
- `null` — якщо `yaml.parse` кинув виняток або результат не є об’єктом.

**Side effects:** немає. Помилка парсингу мовчки перехоплюється `try/catch`.

**Примітки:** ця функція безпечна для викликача — навіть на некоректному YAML вона не падає, а повертає `null`, що далі обробляється у `verifyLintJsWorkflowStructure` як спеціальний випадок.

---

### `flattenWorkflowSteps(root)`

**Сигнатура:** `flattenWorkflowSteps(root: Record<string, unknown>): { jobId: string, stepIndex: number, step: Record<string, unknown> }[]`

**Параметри:**

- `root` — корінь розібраного YAML (об’єкт із полем `jobs`).

**Повертає:** плоский масив об’єктів, кожен з яких містить:

- `jobId` — ім’я job (ключ у `jobs`);
- `stepIndex` — порядковий номер кроку всередині `steps` цього job (починається з 0);
- `step` — сам об’єкт кроку.

**Side effects:** немає.

**Алгоритм:** ітерує через `workflowJobsEntries(root)`, для кожного job отримує `workflowJobSteps(job)`, нумерує кроки за допомогою `Array.prototype.entries()` та пуш у акумулятор. Невалідні (необ’єктні) jobs та невалідні steps пропускаються.

---

### `getStepUses(step)`

**Сигнатура:** `getStepUses(step: Record<string, unknown>): string`

**Параметри:**

- `step` — об’єкт одного елемента масиву `steps`.

**Повертає:** значення `step.uses`, якщо це рядок; інакше — порожній рядок `''`.

**Side effects:** немає.

**Призначення:** уніфікований доступ до значення `uses:` без перевірок типу у викликачів.

---

### `getStepRun(step)`

**Сигнатура:** `getStepRun(step: Record<string, unknown>): string`

**Параметри:**

- `step` — об’єкт одного елемента масиву `steps`.

**Повертає:** текст команди `run:`:

- якщо `step.run` — рядок, повертається як є;
- якщо `step.run` — масив, кожен елемент конвертується через `String(...)` та з’єднується через `\n`;
- інакше — `''`.

**Side effects:** немає.

**Примітки:** YAML дозволяє запис `run:` як багаторядкового скаляра (`|` / `>-`) або як масиву рядків. Функція нормалізує обидва випадки до одного `string`, який потім зручно перевіряти через `.includes(...)` або регулярним виразом.

---

### `eventPathsIncludeExact(root, event, exact)`

**Сигнатура:** `eventPathsIncludeExact(root: Record<string, unknown>, event: 'push' | 'pull_request', exact: string): boolean`

**Параметри:**

- `root` — корінь workflow;
- `event` — ім’я ключа в `on`: `'push'` або `'pull_request'`;
- `exact` — очікуваний рядок (glob), який має бути присутній у `paths`.

**Повертає:** `true`, якщо у `root.on[event].paths` є масив і він містить точне значення `exact`. У всіх інших випадках (відсутній `on`, відсутній `event`, `paths` не масив тощо) — `false`.

**Side effects:** немає.

**Гарантії безпеки:** функція захищена від відсутніх та некоректних типів проміжних об’єктів, тому її можна викликати на будь-якому `root`, повернутому з `parseWorkflowYaml`.

---

### `verifyLintJsWorkflowStructure(root)`

**Сигнатура:** `verifyLintJsWorkflowStructure(root: Record<string, unknown> | null): { ok: boolean, failures: string[] }`

**Параметри:**

- `root` — корінь розібраного workflow або `null`, якщо парсинг не вдався.

**Повертає:** об’єкт результату:

- `{ ok: true, failures: [] }` — усі перевірки пройдено;
- `{ ok: false, failures: [...] }` — список причин відмови у вигляді людинозрозумілих українських повідомлень.

**Side effects:** немає.

**Перевірки, які виконуються (у порядку додавання до `failures`):**

1. Якщо `root === null` — повертається одразу `{ ok: false, failures: ['YAML не вдалося розібрати — перевір синтаксис workflow'] }`.
2. У жодному кроці немає `uses:` з підрядком `'actions/checkout@v6'` → `'немає кроку uses: actions/checkout@v6'`.
3. Серед кроків з `actions/checkout@v6` немає такого, що містить `with.persist-credentials === false` → `'checkout@v6 без with.persist-credentials: false'`.
4. У жодному кроці немає `uses:` з підрядком `'./.github/actions/setup-bun-deps'` → `'немає uses: ./.github/actions/setup-bun-deps'`.
5. У сумарному `run`-блобі немає `'bunx oxlint'` → `'у run немає bunx oxlint'`.
6. У сумарному `run`-блобі немає `'bunx eslint .'` → `'у run немає bunx eslint .'`.
7. У сумарному `run`-блобі немає `'bunx jscpd .'` → `'у run немає bunx jscpd .'`.
8. Для кожного кроку, чий `run` матчиться `BUNX_OXLINT_FIX_RE`, додається `'у run є oxlint з --fix (у CI заборонено)'`.
9. Для кожного кроку, чий `run` містить `'eslint --fix'`, додається `'у run є eslint --fix (у CI заборонено)'`.

**Примітка:** «сумарний `run`-блоб» — це `flattenWorkflowSteps(root).map(s => getStepRun(s.step)).join('\n')`. Тобто перевірки 5–7 пасять, навіть якщо `bunx oxlint`, `bunx eslint .` та `bunx jscpd .` рознесені по різних кроках.

---

### `anyRunStepIncludes(root, needle)`

**Сигнатура:** `anyRunStepIncludes(root: Record<string, unknown>, needle: string): boolean`

**Параметри:**

- `root` — корінь workflow;
- `needle` — підрядок для пошуку в текстах `run:`.

**Повертає:** `true`, якщо знайдено принаймні один крок, у `run:` якого є `needle`; інакше `false`.

**Side effects:** немає. Ітерація припиняється на першому збігу (рання передача).

**Типовий приклад:** `anyRunStepIncludes(root, 'bun run lint-text')` для `check-text` — перевірити, що CI взагалі викликає таргет лінту текстів.

---

### `workflowJobsEntries(root)` (internal)

**Сигнатура:** `workflowJobsEntries(root: Record<string, unknown>): [string, Record<string, unknown>][]`

**Параметри:** `root` — корінь workflow.

**Повертає:** список пар `[jobId, job]` для тих ключів `jobs`, у яких значення є непорожнім об’єктом.

**Side effects:** немає.

**Алгоритм:** перевіряє наявність та тип `root.jobs`, далі `Object.entries(jobs).flatMap(...)` фільтрує невалідні значення (масив порожніх або одно-елементних масивів).

---

### `workflowJobSteps(job)` (internal)

**Сигнатура:** `workflowJobSteps(job: Record<string, unknown>): Record<string, unknown>[]`

**Параметри:** `job` — один job-об’єкт.

**Повертає:** масив об’єктних кроків з `job.steps`; невалідні (необ’єктні / `null`) елементи фільтруються.

**Side effects:** немає.

---

### `hasCheckoutWithPersistCredentialsFalse(steps)` (internal)

**Сигнатура:** `hasCheckoutWithPersistCredentialsFalse(steps: { step: Record<string, unknown> }[]): boolean`

**Параметри:** `steps` — результат `flattenWorkflowSteps` (використовується тільки поле `step`).

**Повертає:** `true`, якщо знайдено крок, у якого:

- `uses` містить `'actions/checkout@v6'`;
- `step.with` — об’єкт;
- `step.with['persist-credentials'] === false` (саме `false`, а не «фолсі»).

**Side effects:** немає.

**Призначення:** перевірити, що `actions/checkout@v6` явно вимкнув збереження токена в git-конфізі — це вимога безпеки в правилі `n-ga`.

---

### `appendCiFixFlagFailures(failures, steps)` (internal)

**Сигнатура:** `appendCiFixFlagFailures(failures: string[], steps: { step: Record<string, unknown> }[]): void`

**Параметри:**

- `failures` — акумулятор-масив, у який функція **пушить** нові рядки помилок;
- `steps` — результат `flattenWorkflowSteps`.

**Повертає:** `undefined` (мутує `failures`).

**Side effects:** мутація переданого масиву `failures` через `Array.prototype.push`.

**Логіка:** для кожного кроку:

- якщо `BUNX_OXLINT_FIX_RE.test(run)` — додає повідомлення про заборонений `--fix` у `bunx oxlint`;
- якщо `run.includes('eslint --fix')` — додає повідомлення про заборонений `eslint --fix`.

**Примітка:** функція може додати **обидва** повідомлення для одного і того ж кроку, якщо в `run` присутні обидва патерни. Якщо в різних кроках присутній один і той самий патерн — повідомлення додасться **кілька разів** (по одному на крок).

## Залежності

**Зовнішні npm-пакети:**

- `yaml` — функція `parse(content)` для розбору YAML у JS-об’єкт. Імпорт іменований: `import { parse } from 'yaml'`.

**Стандартна бібліотека JS:** `Object.entries`, `Array.isArray`, `Array.prototype.flatMap`, `Array.prototype.map`, `Array.prototype.entries`, `Array.prototype.some`, `Array.prototype.includes`, `Array.prototype.join`, `RegExp.prototype.test`, `String.prototype.includes`.

**Внутрішні залежності проєкту:** жодних модулів проєкту не імпортує — це листовий хелпер.

**Хто залежить від цього модуля (зворотні залежності):** згідно з docstring файла — скрипти `check-ga`, `check-js-lint`, `check-text`, `check-style-lint`, `check-npm-module`. Конкретні шляхи до цих скриптів живуть у `npm/scripts/` / `npm/checks/` та використовують іменовані експорти модуля.

## Потік виконання / Використання

### Типовий цикл використання сценарієм-checker

1. Сценарій читає вміст файла `.github/workflows/<name>.yml` як рядок (наприклад через `node:fs/promises`).
2. Викликає `const root = parseWorkflowYaml(content)`.
3. Якщо `root === null` — повідомляє про синтаксичну помилку YAML.
4. Інакше викликає одну зі спеціалізованих перевірок (наприклад `verifyLintJsWorkflowStructure(root)`) або серію загальних (`flattenWorkflowSteps`, `getStepUses`, `getStepRun`, `anyRunStepIncludes`, `eventPathsIncludeExact`).
5. На основі результату формує звіт перевірки.

### Приклад: перевірка `lint-js.yml`

```js
import { readFile } from 'node:fs/promises'
import { parseWorkflowYaml, verifyLintJsWorkflowStructure } from './gha-workflow.mjs'

const content = await readFile('.github/workflows/lint-js.yml', 'utf8')
const root = parseWorkflowYaml(content)
const result = verifyLintJsWorkflowStructure(root)

if (!result.ok) {
  for (const f of result.failures) {
    console.error('lint-js.yml:', f)
  }
  process.exit(1)
}
```

### Приклад: перевірка наявності таргета `bun run lint-text`

```js
import { parseWorkflowYaml, anyRunStepIncludes } from './gha-workflow.mjs'

const root = parseWorkflowYaml(content)
if (root && !anyRunStepIncludes(root, 'bun run lint-text')) {
  console.error('у CI відсутній виклик bun run lint-text')
}
```

### Приклад: перевірка `on.pull_request.paths`

```js
import { parseWorkflowYaml, eventPathsIncludeExact } from './gha-workflow.mjs'

const root = parseWorkflowYaml(content)
if (root && !eventPathsIncludeExact(root, 'pull_request', '**/*.vue')) {
  console.error('on.pull_request.paths не містить **/*.vue')
}
```

### Властивості, корисні викликачам

- **Чисті функції.** Жодних бічних ефектів (крім явної мутації `failures` в `appendCiFixFlagFailures`, яка інкапсульована всередині `verifyLintJsWorkflowStructure`).
- **Безпечність до помилок типів.** Усі публічні функції захищені від некоректних або відсутніх ключів — повертають `''`, `false` або `[]` замість падіння.
- **Уніфікований доступ.** `getStepUses` та `getStepRun` нормалізують форму YAML (рядок vs масив), щоб викликач завжди працював із `string`.
- **Точне `paths`-зіставлення.** `eventPathsIncludeExact` вимагає **точного** елемента масиву, а не підрядка — тому glob-патерни мають бути записані як є.
- **Сумарний `run`-блоб.** У `verifyLintJsWorkflowStructure` пункти 5–7 не вимагають, щоб усі команди жили в одному `run`-кроці — вони можуть бути рознесені по кроках/jobs.
