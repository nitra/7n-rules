# applies.mjs — applies-гейт правила `rego`

## Огляд

Модуль `applies.mjs` реалізує **rule-level applies-гейт** для правила `rego` (див. `rego.mdc`). Призначення модуля — відповісти на запитання: «Чи має CLI взагалі застосовувати правило `rego` до цього репозиторію?»

Логіка гейту проста: правило **застосовне лише тоді**, коли в дереві репозиторію (з урахуванням типових skip-каталогів і ігнор-патернів із `.n-cursor.json:ignore`) існує хоча б один `.rego`-файл. Якщо таких файлів немає — CLI пропускає правило **цілком**, включно з усіма його полісі-концернами (`package_json`, `vscode_extensions`, `vscode_settings`), оскільки вимоги rego-tooling стають неактуальними для проєкту без OPA/rego-коду.

Чому це не виражено декларативно через `target.json`-маніфести? Бо це **cross-file** гейт: вирішення базується на пошуку файлу по дереву (`walkDir`), а не на перевірці властивостей одного конкретного файлу. Декларативна модель `target.json` для цього не підходить, тому залишається імперативний JS.

Окрім самого гейта, файл також експортує невелику функцію `check()`, яка лише друкує контекстне pass-повідомлення (фактичні порушення вже повертають окремі policy-концерни).

## Експорти / API

Модуль експортує два public-символи:

| Символ            | Тип                  | Призначення                                                            |
| ----------------- | -------------------- | ---------------------------------------------------------------------- |
| `applies(cwd?)`   | `async function`     | Rule-level applies-гейт: чи застосовне правило `rego` до репозиторію.  |
| `check()`         | `function`           | Друкує короткий context-pass; повертає exit-code від `check-reporter`. |

Внутрішня (не експортована) допоміжна функція:

| Символ                                | Тип              | Призначення                                                         |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `projectHasRegoFiles(root, ignorePaths)` | `async function` | Чи є хоча б один `.rego` у дереві від `root` (зупинка на першому). |

## Функції

### `projectHasRegoFiles(root, ignorePaths)` (internal)

**Сигнатура**

```js
async function projectHasRegoFiles(root: string, ignorePaths: string[]): Promise<boolean>
```

**Параметри**

- `root` — абсолютний шлях до кореня репозиторію, від якого починати обхід.
- `ignorePaths` — масив шляхів каталогів, повністю виключених з обходу (зазвичай результат `loadCursorIgnorePaths(cwd)`).

**Повертає**

- `Promise<boolean>` — `true`, якщо в дереві знайдено принаймні один `.rego`-файл; інакше `false`.

**Side effects / нотатки**

- Виконує файлову систему-операцію через `walkDir`.
- **Не короткозамикається** ранньо у сенсі «зупинити walk» — `walkDir` тут не отримує сигнал на дострокове припинення, але всередині callback просто переписує локальну змінну `found = true` при першому матчі (подальші зустрічі залишають значення тим самим). Таким чином, фактично функція **проходить усе дерево**, проте семантично відповідає на питання «чи знайшовся хоч один».
- Жодних throw-ів не передбачено в самому коді функції — будь-які помилки I/O бульбашиться з `walkDir`.

### `applies(cwd = process.cwd())` (exported)

**Сигнатура**

```js
export async function applies(cwd?: string): Promise<boolean>
```

**Параметри**

- `cwd` *(опц.)* — корінь репозиторію. За замовчуванням — поточна робоча директорія процесу (`process.cwd()`).

**Повертає**

- `Promise<boolean>` — `true`, якщо правило `rego` застосовне (в репо знайдено принаймні один `.rego`); `false` — якщо правило слід пропустити.

**Side effects**

- Читає `.n-cursor.json` через `loadCursorIgnorePaths(cwd)`, щоб одержати каталоги, які слід ігнорувати.
- Виконує файловий обхід через `projectHasRegoFiles` (внутрішньо — `walkDir`).
- Не модифікує файлову систему, не пише в stdout/stderr.

### `check()` (exported)

**Сигнатура**

```js
export function check(): number
```

**Параметри**

- Немає.

**Повертає**

- `number` — exit-code, який повертає `reporter.getExitCode()` (зазвичай `0`, оскільки тут викликається лише `reporter.pass(...)`).

**Side effects**

- Створює локальний `check-reporter` через `createCheckReporter()`.
- Друкує context-pass повідомлення: `Знайдено *.rego у дереві — перевіряємо канонічні конфіги rego.mdc`.
- Фактичні порушення rego-правила цей `check()` **не повертає** — вони приходять від окремих policy-концернів, які CLI запускає декларативно через `policy/<name>/target.json`.

## Залежності

Модуль явно імпортує три внутрішніх допоміжних модулі:

| Імпорт                    | Шлях                                                        | Роль                                                                      |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `createCheckReporter`     | `../../../scripts/lib/check-reporter.mjs`                   | Фабрика репортера для check-функцій; дає `pass()`, `getExitCode()` тощо.  |
| `loadCursorIgnorePaths`   | `../../../scripts/lib/load-cursor-config.mjs`               | Зчитує `.n-cursor.json` і повертає список ігнор-шляхів для обходу.        |
| `walkDir`                 | `../../../scripts/utils/walkDir.mjs`                        | Рекурсивний обхід директорії з підтримкою skip-патернів і ignorePaths.    |

Зовнішніх npm-залежностей у файлі немає; стандартних Node-API напряму не використовується (окрім `process.cwd()` як значення дефолту параметра).

## Потік виконання / Використання

### Контракт CLI

Файл `applies.mjs` — стандартна точка входу для CLI правила. CLI (npm/n-cursor) обходить правила (`npm/rules/*/`) і для кожного шукає `js/applies.mjs`. Якщо файл є — CLI імпортує `applies` і викликає її, передаючи `cwd` репозиторію. Залежно від результату:

- `applies(cwd)` повернуло `true` → CLI продовжує: запускає всі полісі-концерни правила (`policy/<name>/target.json`), а також (опціонально) викликає `check()` для друку контекстного pass-повідомлення.
- `applies(cwd)` повернуло `false` → CLI **повністю пропускає** правило `rego`: жодний полісі не запускається, `check()` не викликається.

### Внутрішня послідовність викликів `applies(cwd)`

1. **Отримати ignorePaths** — викликати `loadCursorIgnorePaths(cwd)`. Результат — масив шляхів каталогів з `.n-cursor.json:ignore`, які слід виключити з обходу.
2. **Перевірити наявність `.rego`** — викликати `projectHasRegoFiles(cwd, ignorePaths)`:
   - `walkDir` обходить дерево від `cwd`, оминаючи `ignorePaths` і типові skip-каталоги (`node_modules`, `.git`, тощо — згідно семантики `walkDir`).
   - Кожен знайдений шлях `p` перевіряється на суфікс `.rego`; перший збіг встановлює `found = true`.
3. **Повернути результат** — `Promise<boolean>`.

### Внутрішня послідовність викликів `check()`

1. Створити репортер: `const reporter = createCheckReporter()`.
2. Зареєструвати pass-подію: `reporter.pass('Знайдено *.rego у дереві — перевіряємо канонічні конфіги rego.mdc')`.
3. Повернути exit-code: `return reporter.getExitCode()`.

### Типовий сценарій для проєкту з OPA-полісі

Якщо у вашому репозиторії під CI/security лежать файли на kшталт `policies/foo.rego`, `infra/opa/*.rego` тощо:

- `applies(cwd)` поверне `true`.
- CLI прогонить полісі-концерни `rego`-правила: перевірить, що `package.json` містить очікувані скрипти/devDependencies, що `.vscode/extensions.json` рекомендує OPA-розширення, що `.vscode/settings.json` має канонічні налаштування — все це декларативно через `policy/<name>/target.json`.
- Додатково CLI може надрукувати pass-рядок із `check()`.

### Типовий сценарій для проєкту без rego

Якщо `.rego` файлів у дереві немає:

- `applies(cwd)` поверне `false`.
- CLI пропустить правило `rego` цілком — користувач не побачить жодних повідомлень про відсутні rego-tooling-конфіги, бо вони неактуальні.

### Приклад прямого виклику з тестів або сервісного коду

```js
import { applies, check } from './applies.mjs'

const shouldRun = await applies('/abs/path/to/repo')
if (shouldRun) {
  const code = check()
  process.exit(code)
}
```

## Rebuild Test

Маючи лише цей документ, інженер має змогу відтворити файл наступним чином:

1. Створити модуль `applies.mjs` у каталозі `npm/rules/rego/js/`.
2. Імпортувати три залежності з відносними шляхами `../../../scripts/lib/check-reporter.mjs`, `../../../scripts/lib/load-cursor-config.mjs`, `../../../scripts/utils/walkDir.mjs`.
3. Реалізувати **приватну** `async function projectHasRegoFiles(root, ignorePaths)`: завести локальну змінну `found = false`, викликати `await walkDir(root, callback, ignorePaths)`, де callback перевіряє `p.endsWith('.rego')` і виставляє `found = true`. Повернути `found`.
4. Експортувати **`async function applies(cwd = process.cwd())`**: одержати `ignorePaths` через `await loadCursorIgnorePaths(cwd)`, повернути результат `projectHasRegoFiles(cwd, ignorePaths)`.
5. Експортувати **`function check()`**: створити `reporter` через `createCheckReporter()`, викликати `reporter.pass('Знайдено *.rego у дереві — перевіряємо канонічні конфіги rego.mdc')`, повернути `reporter.getExitCode()`.
6. Додати JSDoc-коментарі: file-header пояснює призначення applies-гейта і чому JS, а не `target.json`; кожна з трьох функцій має JSDoc із параметрами/повертанням.

Очікуваний зовнішній контракт після rebuild:

- `applies('/repo/with/rego/files')` → `Promise<true>`.
- `applies('/repo/without/rego/files')` → `Promise<false>`.
- `check()` → синхронно повертає число (exit-code від check-reporter), друкує pass-повідомлення.
