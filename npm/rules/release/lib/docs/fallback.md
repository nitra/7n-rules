---
docgen:
  source: npm/rules/release/lib/fallback.mjs
  crc: 99eb10bc
---

# fallback.mjs

## Огляд

Модуль `fallback.mjs` реалізує **третє рішення** з ADR `n-cursor-release-design`: коли в певному workspace монорепо виявлено релевантні зміни, але **жодного change-файлу** від розробника не з’явилося, релізний пайплайн все одно повинен мати запис у CHANGELOG. Для цього модуль **синтезує** один штучний запис `change` із commit-subject-ів, які з’явилися від моменту останнього релізного тегу формату `<name>@*` до `HEAD`, обмежуючи журнал git pathspec-ом самого workspace.

Файл експортує дві функції:

- `defaultRunGit(cwd)` — фабрика «тихого» git-раннера: повертає stdout або `null` у разі будь-якої помилки (без кидання винятків).
- `synthesizeChangeFromCommits(name, ws, opts?)` — асинхронна функція, що повертає одну синтетичну change-запис `{ bump, section, description }` або `null`, якщо синтез неможливий (bootstrap-релізу немає тегу або немає комітів у діапазоні).

Усі git-виклики **навмисно** йдуть через інжектований раннер (`opts.runGit`), щоб тести могли мокати git без реальних `execFile`-викликів.

## Експорти / API

| Експорт                                        | Тип                  | Призначення                                                     |
| ---------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `defaultRunGit(cwd)`                           | named function       | Створює дефолтний git-раннер, прив’язаний до конкретного `cwd`. |
| `synthesizeChangeFromCommits(name, ws, opts?)` | named async function | Синтезує один change-запис із git-історії або повертає `null`.  |

Default-експортів немає.

### TypeScript-подібна сигнатура

```text
defaultRunGit(cwd: string): (args: string[]) => Promise<string | null>

synthesizeChangeFromCommits(
  name: string,
  ws: string,
  opts?: { runGit?: (args: string[]) => Promise<string | null> }
): Promise<{ bump: 'patch'; section: 'Changed'; description: string } | null>
```

## Функції

### `defaultRunGit(cwd)`

**Сигнатура:** `function defaultRunGit(cwd: string): (args: string[]) => Promise<string | null>`

**Параметри:**

- `cwd` _(string)_ — абсолютний або відносний шлях до робочого каталогу, у якому виконуються git-команди.

**Повертає:** функцію-раннер `async (args: string[]) => Promise<string | null>`. Раннер:

- виконує `git <...args>` у заданому `cwd` через `execFile` (без shell, без інтерполяції аргументів);
- у разі успіху повертає **повний stdout** як рядок (без обрізання, без декодування);
- у разі будь-якої помилки (non-zero exit, ENOENT, відсутність git, repo not found тощо) повертає `null` — **жоден виняток не пробивається назовні**.

**Side effects:**

- Спавнить дочірній процес `git` через `node:child_process.execFile`.
- Читає файлову систему репозиторію (через сам git).
- Не пише у stdout/stderr батьківського процесу, не змінює стан репо.

**Дизайнерські рішення:**

- `execFile` (а не `exec`) — захист від shell-injection; аргументи передаються як масив.
- `try/catch` обгортає виклик, перетворюючи помилку на `null`. Це дозволяє викликачу не дбати про обробку винятків і однаково реагувати на «команда не виконалась» та «команда повернула порожньо».

### `synthesizeChangeFromCommits(name, ws, opts?)`

**Сигнатура:**

```text
async function synthesizeChangeFromCommits(
  name: string,
  ws: string,
  opts?: { runGit?: (args: string[]) => Promise<string | null> }
): Promise<{ bump: string; section: string; description: string } | null>
```

**Параметри:**

- `name` _(string)_ — ім’я npm-пакета. Використовується для побудови патерну тегу `<name>@*` у `git describe --match`.
- `ws` _(string)_ — workspace, що виступає pathspec-ом для `git log`. Спеціальне значення `'.'` означає «весь репозиторій, без обмеження шляху»; будь-яке інше значення інтерпретується як директорія і додається до команди як `-- <ws>/`.
- `opts` _(object, optional)_ — опції:
  - `opts.runGit` _((args) => Promise\<string|null\>)_ — кастомний git-раннер (ін’єкція для тестів). Якщо не задано, використовується `defaultRunGit(process.cwd())`.

**Повертає:** `Promise` що резолвиться в:

- **об’єкт** `{ bump: 'patch', section: 'Changed', description: <string> }` — синтетичний change-запис, де `description` є склейкою всіх commit-subject-ів через роздільник `'; '`;
- **`null`** — у двох випадках:
  1. **Bootstrap-кейс:** `git describe` не знайшов жодного попереднього тегу `<name>@*` (повернув `null` або порожній рядок після `trim`). Перший реліз робиться вручну, fallback не повинен дублювати bump.
  2. **No-op кейс:** теги є, але `git log <lastTag>..HEAD` для даного workspace не повернув жодного непорожнього subject-а (немає змін у скоупі workspace після останнього релізу).

**Side effects:**

- Через `runGit` спавнить **до двох** git-процесів (`git describe`, потім `git log`).
- Не пише на диск, не мутує жодних аргументів.

**Алгоритм покроково:**

1. Розв’язати раннер: `runGit = opts.runGit ?? defaultRunGit(process.cwd())`.
2. Викликати `git describe --tags --abbrev=0 --match <name>@* HEAD`. Якщо результат — `null`/порожньо/whitespace після `trim()` — повернути `null` (bootstrap).
3. Сформувати pathspec: `[]` для `ws === '.'`, інакше `['--', `${ws}/`]`.
4. Викликати `git log --no-merges --format=%s <lastTag>..HEAD [-- <ws>/]`.
5. Розділити stdout по `\n`, обрізати кожен рядок, відкинути порожні (`filter(Boolean)`).
6. Якщо масив subjects порожній — повернути `null`.
7. Інакше — повернути `{ bump: 'patch', section: 'Changed', description: subjects.join('; ') }`.

**Інваріанти / контракти:**

- `bump` завжди дорівнює рядку `'patch'` — fallback не вгадує `minor`/`major`; підвищити рівень bump-у можна лише явним change-файлом.
- `section` завжди `'Changed'` — без класифікації за типом коміту (Added/Fixed/тощо).
- `description` ніколи не порожній (інакше функція повертає `null`).
- Якщо `logRaw` дорівнює `null` (git-помилка) — це трактується **тотожно** з порожнім логом: `(logRaw ?? '').split('\n')` дасть `['']`, що після фільтрів стане `[]` → результат `null`. Тобто помилка `git log` свідомо **не** кидається назовні; це частина контракту «тихого» раннера.

## Залежності

### Зовнішні (стандартна бібліотека Node.js)

- **`node:child_process.execFile`** — запуск дочірнього процесу `git` без shell.
- **`node:util.promisify`** — перетворення `execFile` callback-стилю на `Promise`-сумісний `execFileAsync`.

### Внутрішні

Файл **не імпортує** жодних внутрішніх модулів проєкту. Він самодостатній і використовується іншими модулями релізного пайплайна (зокрема `aggregate.mjs` у тому ж каталозі) як інструмент синтезу запису.

### Передумови середовища

- У `PATH` має бути доступний бінарник `git`.
- `cwd` повинен вказувати на git-репозиторій (інакше `git describe` поверне `null` і функція коректно деградує до bootstrap-кейсу).
- Теги релізів мають іти за конвенцією `<pkg-name>@<version>` — інакше `--match <name>@*` нічого не знайде.

## Потік виконання / Використання

### Типова інтеграція в релізному пайплайні

```js
import { synthesizeChangeFromCommits } from './fallback.mjs'

// В межах одного workspace монорепо:
const change = await synthesizeChangeFromCommits('@scope/pkg', 'packages/pkg')
if (change) {
  // Додаємо як єдиний запис у агрегацію change-ів цього релізу
  applyChange(change)
} else {
  // Або bootstrap-реліз (тегу ще не існує), або нічого не змінилося в скоупі workspace
}
```

### З кастомним git-раннером (тестовий сценарій)

```js
const fakeGit = async args => {
  if (args[0] === 'describe') return '@scope/pkg@1.2.3\n'
  if (args[0] === 'log') return 'fix: foo\nchore: bar\n\n'
  return null
}
const change = await synthesizeChangeFromCommits('@scope/pkg', 'packages/pkg', { runGit: fakeGit })
// => { bump: 'patch', section: 'Changed', description: 'fix: foo; chore: bar' }
```

### Сценарій «весь репо» (root-workspace)

```js
// ws === '.' → pathspec не додається, log читає історію всього репо
await synthesizeChangeFromCommits('root', '.')
```

### Діаграма послідовності

```
caller
  │
  ├─ runGit(['describe', '--tags', '--abbrev=0', '--match', `<name>@*`, 'HEAD'])
  │     └─→ null  ───► return null  (bootstrap)
  │     └─→ '<tag>\n'
  │
  ├─ runGit(['log', '--no-merges', '--format=%s', '<tag>..HEAD', '--', '<ws>/'])
  │     └─→ null | ''   ───► return null  (no commits in scope)
  │     └─→ 'subj1\nsubj2\n…'
  │
  └─ return { bump: 'patch', section: 'Changed', description: 'subj1; subj2; …' }
```

### Ключові випадки повернення `null`

| Випадок   | Причина                                          | Реакція пайплайна                                       |
| --------- | ------------------------------------------------ | ------------------------------------------------------- |
| Bootstrap | Немає жодного тегу `<name>@*`                    | Не синтезувати fallback; перший реліз — вручну.         |
| No-op     | Тег є, але `git log` у скоупі workspace порожній | У workspace немає релевантних змін → реліз не потрібен. |
| Git error | Будь-яка помилка `git` (через тихий раннер)      | Інтерпретується як «нічого синтезувати», `null`.        |

## Rebuild Test

Перевірка контекстної повноти документа: за описом вище можна **відновити** ключові властивості реалізації без перегляду коду:

1. Модуль ES (`.mjs`), імпортує `execFile` з `node:child_process` і `promisify` з `node:util`; створює `execFileAsync = promisify(execFile)`.
2. Експортує дві іменовані функції: `defaultRunGit(cwd)` і `synthesizeChangeFromCommits(name, ws, opts)`. Default-експорту немає.
3. `defaultRunGit(cwd)` повертає async-функцію `args => …`, що викликає `execFileAsync('git', args, { cwd })` у `try/catch`; в успіху — `stdout`, у будь-якій помилці — `null`.
4. `synthesizeChangeFromCommits`:
   - бере `runGit` з `opts.runGit ?? defaultRunGit(process.cwd())`;
   - `git describe --tags --abbrev=0 --match \`${name}@\*\` HEAD`→`lastTagRaw`; `lastTag = lastTagRaw?.trim()`; якщо falsy — `return null`;
   - `pathspec = ws === '.' ? [] : ['--', \`${ws}/\`]`;
   - `git log --no-merges --format=%s \`${lastTag}..HEAD\` ...pathspec`→`logRaw`;
   - `subjects = (logRaw ?? '').split('\n').map(s => s.trim()).filter(Boolean)`;
   - якщо `subjects.length === 0` → `return null`;
   - інакше `return { bump: 'patch', section: 'Changed', description: subjects.join('; ') }`.
5. `bump` зашитий як `'patch'`, `section` — як `'Changed'`; роздільник опису — `'; '`.
6. Жодні винятки з git не пробиваються назовні — раннер обгортає їх у `null`, а `synthesizeChangeFromCommits` коректно деградує до `null` у всіх граничних кейсах.
