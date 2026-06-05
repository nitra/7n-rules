# `trace.mjs` — наскрізна простежуваність артефактів документації

## Огляд

Модуль реалізує CLI-команду `n-cursor trace` (специфікація §5.4 / §7) — інструмент **наскрізної простежуваності** (traceability) між артефактами в `docs/`. Він читає YAML-front-matter з усіх Markdown-файлів у каталогах `docs/tasks`, `docs/specs`, `docs/plans`, `docs/adr`, будує ланцюг зв'язків між ними за полями-лінками (`adr`, `spec`, `plan`, `flow`, `change`, `task`) і **флагує розриви** — тобто посилання на неіснуючі файли.

Модуль повністю **read-only**: жодних мутацій файлової системи. Підтримує два режими виводу:

- **текстовий** (за замовчуванням) — людино-читабельний звіт з символами `→`/`✗`/`~`;
- **JSON** (`--json`) — machine-readable структура для CI / інших інструментів.

Поведінка щодо FS повністю інжектабельна (`readdir`, `readFile`, `exists`, `cwd`, `log`), завдяки чому модуль тестується без реального диска та без зміни робочої директорії.

Окремий нюанс — поле `flow` трактується як **інформаційне**, а не chain-поле: воно вказує на runtime-стан у `.worktrees/<branch>.flow.json`, який gitignored і за межами `docs/`, тому його відсутність ніколи не вважається розривом ланцюга (інакше у чистому checkout або CI-сесії був би хибний сигнал).

## Експорти / API

| Експорт                       | Тип            | Призначення                                                  |
| ----------------------------- | -------------- | ------------------------------------------------------------ |
| `parseFrontMatter(content)`   | named function | Парсить плаский YAML-front-matter Markdown-файла.            |
| `analyze(artifacts, resolve)` | named function | Будує аналіз лінків артефактів зі статусами `ok`/`breaking`. |
| `render(analysis)`            | named function | Текстовий рендер результату `analyze`.                       |
| `runTraceCli(args, deps?)`    | named function | Точка входу CLI `n-cursor trace [--json]`.                   |

Внутрішні (не експортуються): `isSimpleKey`, `resolveLink`, `renderLink`, константи `LINK_FIELDS`, `INFO_LINK_FIELDS`, `DIRS`.

### Константи модуля

- `LINK_FIELDS = ['adr', 'spec', 'plan', 'flow', 'change', 'task']` — впорядкований список полів front-matter, які розглядаються як лінки. Порядок впливає на порядок виводу.
- `INFO_LINK_FIELDS = new Set(['flow'])` — підмножина полів, відсутність яких **не** рве ланцюг (інформаційні, не breaking).
- `DIRS = ['docs/tasks', 'docs/specs', 'docs/plans', 'docs/adr']` — каталоги, у яких шукаються traceable-артефакти.

## Функції

### `parseFrontMatter(content)`

**Сигнатура:** `parseFrontMatter(content: string): Record<string, string | null> | null`

**Параметри:**

- `content` — повний текст Markdown-файла.

**Повертає:**

- Об'єкт `{ key: value }` зі значеннями типу `string` (звичайне поле) або `null` (порожнє чи літерал `null`);
- `null`, якщо файл не починається з `---` або немає закриваючого `\n---`.

**Логіка:**

1. Перевіряє, що файл починається з `---`. Інакше — `null`.
2. Шукає закриваючий маркер `\n---` починаючи з 4-ї позиції. Якщо нема — `null`.
3. Розбиває блок front-matter на рядки.
4. Для кожного рядка: знаходить перше `:`, ділить на `key` / `val`.
5. Відсікає `key`, який не є простим ідентифікатором (`isSimpleKey`) — тобто рядки з вкладеними структурами, дефісами, цифрами тощо ігноруються.
6. Відрізає інлайн-коментар у форматі ` #…` (пробіл-решітка).
7. Тримує значення, прибирає одиничні зовнішні лапки `"`/`'`.
8. Якщо значення порожнє або дорівнює рядку `'null'` — нормалізує у `null`.

**Side effects:** немає (чиста функція).

### `isSimpleKey(key)` (внутрішня)

**Сигнатура:** `isSimpleKey(key: string): boolean`

**Параметри:** `key` — потенційний ключ front-matter.

**Повертає:** `true`, якщо ключ непорожній і складається тільки з літер `a–z`/`A–Z` та підкреслень. Регулярний вираз: `/[a-z_]/iu` для кожного символу.

**Side effects:** немає.

**Призначення:** захист від спроби парсити вкладені структури або не-ідентифікатори (рядки з `-`, цифрами, `.`, тощо).

### `analyze(artifacts, resolve)`

**Сигнатура:**

```
analyze(
  artifacts: { file: string, fm: Record<string, string | null> }[],
  resolve: (target: string, artifactFile: string) => boolean
): {
  file: string,
  kind: string | null,
  id: string | null,
  status: string | null,
  links: { field: string, target: string, ok: boolean, breaking: boolean }[]
}[]
```

**Параметри:**

- `artifacts` — масив пар `{ file, fm }`: відносний шлях артефакту та розпарсений front-matter.
- `resolve` — предикат, що повертає `true`, якщо лінк-цільовий файл існує (зазвичай — bound-`resolveLink`).

**Повертає:** масив аналізованих артефактів. Для кожного:

- `kind`, `id`, `status` — з front-matter (або `null`);
- `links` — масив об'єктів про кожен наявний лінк:
  - `field` — назва поля (один з `LINK_FIELDS`);
  - `target` — значення лінка;
  - `ok` — чи резолвиться цільовий файл;
  - `breaking` — `false`, якщо поле в `INFO_LINK_FIELDS` (зараз — `flow`); `true` для всіх інших.

**Логіка:** проходить `LINK_FIELDS` у фіксованому порядку, бере тільки поля, наявні у `fm` з truthy-значенням.

**Side effects:** немає (логіка чиста, `resolve` інкапсулює I/O).

### `resolveLink(root, artifactFile, target, exists)` (внутрішня)

**Сигнатура:** `resolveLink(root: string, artifactFile: string, target: string, exists: (absPath: string) => boolean): boolean`

**Параметри:**

- `root` — абсолютний шлях кореня репо;
- `artifactFile` — rel-шлях артефакту (напр. `docs/plans/x.md`);
- `target` — значення лінка з front-matter;
- `exists` — інжекторована перевірка існування файла.

**Повертає:** `true`, якщо `target` резолвиться **або** відносно теки артефакту (`<root>/<dirname(artifactFile)>/<target>`), **або** root-relative (`<root>/<target>`). Обидві форми вважаються валідними — це конвенція документації (`../specs/…` чи `docs/specs/…`).

**Side effects:** виклик `exists` (зовнішнє I/O), але інкапсульовано — модуль сам диск не чіпає.

### `render(analysis)`

**Сигнатура:** `render(analysis: ReturnType<typeof analyze>): string`

**Параметри:** `analysis` — результат `analyze`.

**Повертає:** багаторядковий текст:

- Якщо `analysis` порожній — рядок `'trace: артефактів із front-matter не знайдено'`.
- Інакше для кожного артефакту:
  - заголовок виду `${kind} · ${id ?? file} [${status ?? '—'}]`;
  - вкладені рядки лінків (через `renderLink`), з відступом 3 пробіли.

**Side effects:** немає.

### `renderLink(l)` (внутрішня)

**Сигнатура:** `renderLink(l: { field: string, target: string, ok: boolean, breaking: boolean }): string`

**Повертає:** один з трьох форматів:

- `→ <field>: <target>` — резолвлено успішно (`l.ok === true`);
- `✗ <field>: <target> (РОЗРИВ — файл відсутній)` — нерезолвлене chain-поле (`breaking && !ok`);
- `~ <field>: <target> (runtime-стан — не рве ланцюг)` — нерезолвлене info-поле (`!breaking && !ok`, наприклад `flow`).

**Side effects:** немає.

### `runTraceCli(args, deps?)`

**Сигнатура:**

```
runTraceCli(
  args: string[],
  deps?: {
    cwd?: string,
    readdir?: (dir: string) => string[],
    readFile?: (file: string) => string,
    exists?: (file: string) => boolean,
    log?: (m: string) => void
  }
): number
```

**Параметри:**

- `args` — CLI-аргументи (підтримується тільки `--json`);
- `deps` — інжектовані залежності для тестування. Дефолти:
  - `cwd` → `process.cwd()`;
  - `readdir` → `readdirSync` з охороною `existsSync` (повертає `[]`, якщо каталога нема);
  - `readFile` → `readFileSync(file, 'utf8')`;
  - `exists` → `existsSync`;
  - `log` → `console.log`.

**Повертає:** exit code:

- `0` — ланцюг цілісний (немає breaking-розривів);
- `1` — є хоча б один breaking-лінк, що не резолвиться.

**Side effects:**

- Читання FS через `readdir` / `readFile` / `exists` (інжектабельне).
- Виклик `log` — за замовчуванням друк у `stdout`.
- Жодних мутацій FS, мережі або стану процесу.

**Логіка покроково:**

1. Резолвить `root`, `readdir`, `readFile`, `exists`, `log` з `deps` або дефолтів.
2. Проходить кожен каталог з `DIRS`.
3. У кожному каталозі бере файли з розширенням `.md`.
4. Для кожного `.md`-файла:
   - читає вміст через `readFile`;
   - парсить front-matter через `parseFrontMatter`;
   - якщо парсинг успішний і у front-matter є `id` або `kind` — додає в `artifacts`.
5. Викликає `analyze(artifacts, resolve)`, де `resolve` — частково застосований `resolveLink(root, file, target, exists)`.
6. Друкує результат: `JSON.stringify(analysis, null, 2)` для `--json`, інакше `render(analysis)`.
7. Повертає `1`, якщо існує лінк з `breaking && !ok`, інакше `0`. Нерезолвлений `flow` (info-поле) ігнорується для exit code.

## Залежності

### Системні (Node.js)

- `node:fs` — `existsSync`, `readdirSync`, `readFileSync` (використовуються тільки як дефолтні значення для `deps`).
- `node:path` — `dirname`, `join` для побудови шляхів у `resolveLink` та CLI.
- `node:process` — `cwd` (alias-імпорт `processCwd`) для дефолтного кореня.

### Внутрішньопроєктні

- Жодних. Модуль автономний.

### Зовнішні / npm

- Жодних.

### Споживачі

Модуль викликається з диспатчера `n-cursor` як CLI-команда `n-cursor trace`. Експортовані `parseFrontMatter`, `analyze`, `render` доступні для повторного використання іншими інструментами (напр. для дашбордів простежуваності або юніт-тестів).

## Потік виконання / Використання

### CLI

```
n-cursor trace
n-cursor trace --json
```

**Текстовий приклад виводу:**

```
spec · NSPEC-42 [draft]
   → adr: ../adr/NADR-7.md
   ✗ plan: ../plans/NPLAN-99.md (РОЗРИВ — файл відсутній)
   ~ flow: ../../.worktrees/feat-x.flow.json (runtime-стан — не рве ланцюг)
plan · NPLAN-12 [active]
   → spec: ../specs/NSPEC-42.md
```

**JSON-приклад:**

```
[
  {
    "file": "docs/specs/NSPEC-42.md",
    "kind": "spec",
    "id": "NSPEC-42",
    "status": "draft",
    "links": [
      { "field": "adr",  "target": "../adr/NADR-7.md",          "ok": true,  "breaking": true },
      { "field": "plan", "target": "../plans/NPLAN-99.md",      "ok": false, "breaking": true },
      { "field": "flow", "target": "../../.worktrees/x.flow.json","ok": false, "breaking": false }
    ]
  }
]
```

### Алгоритм (псевдо-flowchart)

1. **DIR walk** — `for dir in DIRS: for name in readdir(root/dir)`.
2. **Filter** — лише `*.md`.
3. **Parse** — `parseFrontMatter(readFile(...))`.
4. **Filter artifacts** — лише ті, що мають `fm.id` або `fm.kind`.
5. **Analyze** — для кожного артефакту перетворити front-matter-лінки на `{ field, target, ok, breaking }`.
6. **Render / JSON** — серіалізація.
7. **Exit code** — `1` якщо `any(link.breaking && !link.ok)`, інакше `0`.

### Програмне використання

```
import { parseFrontMatter, analyze, render, runTraceCli } from './trace.mjs'

// Як CLI з мок-FS
const code = runTraceCli(['--json'], {
  cwd: '/repo',
  readdir: (dir) => fakeFs[dir] ?? [],
  readFile: (file) => fakeFs[file],
  exists: (file) => file in fakeFs,
  log: (msg) => collected.push(msg)
})

// Як бібліотека (без I/O)
const fm = parseFrontMatter('---\nid: NSPEC-1\nkind: spec\nplan: ../plans/NPLAN-1.md\n---\n# …')
const result = analyze([{ file: 'docs/specs/x.md', fm }], () => true)
console.log(render(result))
```

### Семантика exit code

- `0` — всі **chain**-лінки (`adr`, `spec`, `plan`, `change`, `task`) резолвляться.
- `1` — є хоча б один chain-лінк, що **не** резолвиться. Поле `flow` ніколи не впливає на код виходу.

### Тестованість

Через повну ін'єкцію `cwd`/`readdir`/`readFile`/`exists`/`log` модуль покривається юніт-тестами без файлової системи. Чисті функції `parseFrontMatter`, `analyze`, `render` тестуються прямо на in-memory даних.
