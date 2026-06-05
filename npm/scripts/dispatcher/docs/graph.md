# graph.mjs — DAG-позиція вузлів графа (`n-cursor graph`)

## Огляд

Модуль реалізує **read-only** підкоманду `n-cursor graph` — інспекцію поточного стану DAG-графа задач, описаного контрактом `docs/specs/2026-06-01-node-dag-state.md`. У цьому файлі реалізовано **перший зріз** — `status`: сканування каталогу `docs/graphs/<graph>/nodes/`, групування артефактів-файлів по вузлах, деривацію статусу кожного вузла та текстове відображення позиції графа.

Ключові архітектурні рішення:

- **State-on-FS**: ввесь стан DAG зберігається у markdown-файлах у `docs/graphs/<graph>/nodes/`. Модуль нічого не мутує — лише читає.
- **Pure derivation**: статус вузла обчислюється з набору файлів-артефактів та їх front-matter, без зовнішніх БД/сервісів.
- **DI for FS**: усі функції приймають інжектовані `readdir` / `readFile` через об'єкт `deps`, що робить логіку детермінованою та тестованою без доступу до файлової системи.
- **Stem + qid модель**: ім'я файлу-артефакта складається з `<stem><суфікс>.md`, де `<stem>` — `id-slug` вузла (наприклад, `B02-parser`), а суфікс позначає тип артефакту (`.plan`, `.claim`, `.fact`, `.ask-<qid>`, `.ans-<qid>`).
- **Roadmap**: подальші зрізи — `claim`, `tick`, `dispatch` — у цьому файлі ще не реалізовані; згадані лише як plan-маркери в JSDoc-заголовку.

Категорії статусів вузла (значення поля `status`): `done`, `failed`, `awaiting-human`, `in_progress`, `ready`, `blocked`.

## Експорти / API

| Експорт                         | Тип            | Призначення                                                                          |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `classifyArtifact(name)`        | named function | Класифікує ім'я файлу-артефакту в `{ stem, kind, qid? }`.                            |
| `parseIdList(value)`            | named function | Парсить inline-список `[A, B]` із front-matter у масив id.                           |
| `scanGraph(root, graph, deps?)` | named function | Сканує `docs/graphs/<graph>/nodes/`, групує артефакти, повертає сирий список вузлів. |
| `deriveStatus(node, doneSet)`   | named function | Чисте обчислення статусу одного вузла на базі прапорців та `dependsOn`.              |
| `deriveGraph(nodes)`            | named function | Деривує статус для всіх вузлів графа (спочатку обчислюючи `doneSet`).                |
| `renderGraph(graph, nodes)`     | named function | Текстовий рендер графа в одну багаторядкову таблицю.                                 |
| `runGraphCli(args, deps?)`      | named function | CLI-точка входу для `n-cursor graph <sub> [graph]`.                                  |

Внутрішня (не експортована):

- `listGraphs(root, readdir)` — перелік підкаталогів у `docs/graphs/`.

Константи (модульно-приватні):

- `PLAIN` — масив пар `[суфікс, kind]` для артефактів без `qid`:
  - `.plan` → `plan`
  - `.claim` → `claim`
  - `.fact` → `fact`
- `QID` — масив пар `[префікс, kind]` для артефактів з `qid`:
  - `.ask-` → `ask`
  - `.ans-` → `ans`

## Функції

### `classifyArtifact(name)`

**Сигнатура:** `(name: string) => { stem: string, kind: string, qid?: string } | null`

**Параметри:**

- `name` — рядок з іменем файлу (очікується закінчення на `.md`).

**Повертає:** об'єкт класифікації або `null`, якщо файл не схожий на артефакт.

**Алгоритм:**

1. Якщо ім'я не закінчується на `.md` — повертається `null`.
2. Відрізається суфікс `.md` → `base`.
3. Перебираються пари в `PLAIN`; перший суфікс, на який закінчується `base`, дає `{ stem: base без суфікса, kind }`.
4. Якщо PLAIN не спрацював — перебираються пари в `QID`. Для кожної шукається **остання** входженість префікса (`lastIndexOf`), і якщо знайдено, повертається `{ stem: base до префікса, kind, qid: усе після префікса }`.
5. Якщо нічого не підійшло — `null`.

**Side effects:** немає (чиста функція).

**Приклади:**

- `classifyArtifact('B02-parser.plan.md')` → `{ stem: 'B02-parser', kind: 'plan' }`
- `classifyArtifact('B02-parser.ask-q1.md')` → `{ stem: 'B02-parser', kind: 'ask', qid: 'q1' }`
- `classifyArtifact('README.md')` → `null`

---

### `parseIdList(value)`

**Сигнатура:** `(value: string | null | undefined) => string[]`

**Параметри:**

- `value` — значення поля front-matter, наприклад `"[A, B, C]"`.

**Повертає:** масив id; порожні елементи відкидаються; усі елементи `trim`-аються.

**Алгоритм:** якщо `value` не рядок — повертається `[]`; інакше прибираються перший `[` та перший `]`, рядок ділиться по комі, кожен елемент trim-ається, відфільтровуються falsy значення.

**Side effects:** немає.

**Зауваги:**

- `replace('[', '')` / `replace(']', '')` без `g`-флага: видаляється лише перше входження кожної дужки — інші лишаються в результаті.

---

### `scanGraph(root, graph, deps?)`

**Сигнатура:** `(root: string, graph: string, deps?: { readdir?, readFile? }) => Node[]`

**Параметри:**

- `root` — абсолютний шлях до кореня репо.
- `graph` — id графа (= ім'я каталогу під `docs/graphs/`).
- `deps.readdir` — функція `(dir: string) => string[]`; за замовчуванням обгортка над `fs.existsSync` + `fs.readdirSync` (повертає `[]`, якщо каталога немає).
- `deps.readFile` — функція `(file: string) => string`; за замовчуванням `fs.readFileSync(file, 'utf8')`.

**Повертає:** масив об'єктів-вузлів. Кожен вузол має поля:

| Поле         | Тип              | Значення                                                        |
| ------------ | ---------------- | --------------------------------------------------------------- |
| `stem`       | `string`         | `id-slug` стем артефакту                                        |
| `id`         | `string`         | id вузла (із front-matter `plan` або `stem.split('-')[0]`)      |
| `slug`       | `string`         | усе після першого `-` у `stem`                                  |
| `dependsOn`  | `string[]`       | id-залежності з `plan.dependsOn`                                |
| `owner`      | `string \| null` | власник з `plan.owner`                                          |
| `hasClaim`   | `boolean`        | чи присутній `.claim`-артефакт                                  |
| `hasFact`    | `boolean`        | чи присутній `.fact`-артефакт                                   |
| `factStatus` | `string \| null` | значення `status` із front-matter `.fact` (за замовч. `'done'`) |
| `asks`       | `string[]`       | список `qid` з `.ask-<qid>.md` файлів                           |
| `answered`   | `string[]`       | список `qid` з `.ans-<qid>.md` файлів                           |

**Алгоритм:**

1. Збирається шлях `dir = root/docs/graphs/<graph>/nodes`.
2. Створюється `Map<stem, node>` та лінива функція `ensure(stem)`, яка ініціалізує запис при першому зверненні.
3. Для кожного імені у `readdir(dir)`:
   - класифікується через `classifyArtifact`; якщо `null` — пропускається;
   - дістається запис вузла за `stem` через `ensure`;
   - `kind` диспатчиться:
     - `plan` — читається файл, парситься front-matter, переписуються `id`, `dependsOn`, `owner`;
     - `claim` — встановлюється `hasClaim = true`;
     - `fact` — `hasFact = true`, `factStatus` із front-matter або `'done'`;
     - `ask` — `qid` додається в `asks`;
     - `ans` — `qid` додається в `answered`.
4. Повертається `[...byStem.values()]`.

**Side effects:**

- Дефолтні `readdir`/`readFile` читають з реальної ФС.
- При інжектованих `deps` функція повністю детермінована.

**Зауваги щодо стійкості:**

- `parseFrontMatter` може повернути `null` — fallback `?? {}` гарантує безпечний доступ до полів.
- Якщо в одному графі є кілька `.plan` файлів для одного `stem`, перемагає останній.

---

### `deriveStatus(node, doneSet)`

**Сигнатура:** `(node, doneSet: Set<string>) => 'done' | 'failed' | 'awaiting-human' | 'in_progress' | 'ready' | 'blocked'`

**Параметри:**

- `node` — об'єкт вузла з полями `hasFact`, `factStatus`, `hasClaim`, `asks`, `answered`, `dependsOn`.
- `doneSet` — множина `id` вузлів, які вже мають `fact` зі статусом ≠ `'failed'`.

**Повертає:** статус вузла. Логіка пріоритетів (зверху-вниз):

1. `hasFact === true` → якщо `factStatus === 'failed'` → `'failed'`, інакше `'done'`.
2. Інакше шукається відкрите питання: `openAsk = node.asks.some(q => !node.answered.includes(q))`.
3. `hasClaim && openAsk` → `'awaiting-human'` (роботу взяли, але потрібна відповідь людини).
4. `hasClaim` → `'in_progress'`.
5. Усі `dependsOn` є в `doneSet` → `'ready'`.
6. Інакше → `'blocked'`.

**Side effects:** немає (чиста функція).

---

### `deriveGraph(nodes)`

**Сигнатура:** `(nodes: Node[]) => (Node & { status })[]`

**Параметри:**

- `nodes` — масив вузлів від `scanGraph`.

**Повертає:** новий масив вузлів з доданим полем `status`.

**Алгоритм:**

1. `doneSet` = множина `id` усіх вузлів, у яких `hasFact && factStatus !== 'failed'`.
2. Кожен вузол мапиться в `{ ...n, status: deriveStatus(n, doneSet) }`.

**Side effects:** немає.

---

### `renderGraph(graph, nodes)`

**Сигнатура:** `(graph: string, nodes: Node[]) => string`

**Параметри:**

- `graph` — id графа (для заголовка).
- `nodes` — вузли з полем `status` (тобто результат `deriveGraph`).

**Повертає:** багаторядковий текстовий рендер.

**Формат виводу:**

```
граф <graph> — <status1>:<n1> <status2>:<n2> ...
  <id> · <slug> [<status>][ <owner>][ ←[dep1,dep2]]
  ...
```

- Якщо `nodes.length === 0` → `"граф <graph>: вузлів не знайдено"`.
- Заголовок міститиме лише ті статуси, для яких `count > 0`, в порядку `['in_progress', 'awaiting-human', 'ready', 'blocked', 'failed', 'done']`.
- Для кожного вузла: `id · slug [status]`, потім опційно ` <owner>` (якщо є), потім опційно ` ←[deps]` (якщо є залежності).

**Side effects:** немає.

---

### `listGraphs(root, readdir)` (internal)

**Сигнатура:** `(root: string, readdir: (dir: string) => string[]) => string[]`

Повертає список імен з `docs/graphs/`. Інжектована `readdir` дозволяє підставити dummy-FS. Експортовано не для зовнішнього вжитку — лише як локальний helper.

---

### `runGraphCli(args, deps?)`

**Сигнатура:** `(args: string[], deps?: { cwd?, readdir?, readFile?, log? }) => number`

**Параметри:**

- `args` — позиційні аргументи після слова `graph` у вихідному `argv` (тобто `[sub, graphArg]`).
- `deps.cwd` — root репо; за замовч. `process.cwd()`.
- `deps.readdir` — як у `scanGraph`/`listGraphs`.
- `deps.readFile` — як у `scanGraph`.
- `deps.log` — функція логування; за замовч. `console.log`.

**Повертає:** exit-код (`0` — все ok, `1` — невідома/відсутня підкоманда).

**Алгоритм:**

1. `root = deps.cwd ?? process.cwd()`.
2. `[sub, graphArg] = args`.
3. Якщо `sub !== 'status'` → друкується usage-рядок `Usage: n-cursor graph status [<graph>]` і повертається `1`.
4. Інакше:
   - якщо `graphArg` заданий → `graphs = [graphArg]`, інакше — усі підкаталоги `docs/graphs/`.
   - Якщо `graphs.length === 0` → `"graph: у docs/graphs/ немає графів"` і `0`.
   - Інакше для кожного `g` друкується `renderGraph(g, deriveGraph(scanGraph(root, g, { readdir, readFile })))`.
5. Повертається `0`.

**Side effects:**

- Викликає `log` (зазвичай `console.log`).
- Читає каталог `docs/graphs/` та файли вузлів через дефолтні `readdir`/`readFile`.
- Не пише в ФС.

## Залежності

### Імпорти з `node:` (стандартна бібліотека Node.js)

- `node:fs` — `existsSync`, `readdirSync`, `readFileSync`. Використовуються лише як дефолти для `deps.readdir`/`deps.readFile`.
- `node:path` — `join` для побудови шляхів `docs/graphs/<g>/nodes/<file>`.
- `node:process` — `cwd as processCwd` для дефолту `root`.

### Імпорти з проєкту

- `./trace.mjs` — функція `parseFrontMatter(text)` для парсингу YAML-frontmatter у markdown-файлах артефактів.

### Зовнішні залежності

Немає (npm-залежності не використовуються).

### Контракт і пов'язані документи

- `docs/specs/2026-06-01-node-dag-state.md` — контракт стану DAG-вузлів (форма артефактів і деривація статусу).
- Структура каталогів: `docs/graphs/<graph>/nodes/<stem><suffix>.md`.

## Потік виконання / Використання

### CLI-сценарій

Файл імпортується диспатчером верхнього рівня (`n-cursor`) і викликається через `runGraphCli`. Очікувана форма виклику з shell:

```
n-cursor graph status              # усі графи в docs/graphs/
n-cursor graph status <graph>      # лише один граф
n-cursor graph                     # друк usage, exit 1
n-cursor graph <other>             # друк usage, exit 1
```

### Внутрішня pipeline за один граф

```
readdir(docs/graphs/<g>/nodes)
  → for each file: classifyArtifact + readFile (для plan/fact)
  → scanGraph → Node[]
  → deriveGraph → Node[] із полем status
  → renderGraph → string
  → log(string)
```

### Програмне використання (наприклад, у тестах)

```js
import { runGraphCli, scanGraph, deriveGraph, renderGraph } from './graph.mjs'

const logs = []
const fakeReaddir = dir => {
  if (dir.endsWith('docs/graphs')) return ['g1']
  if (dir.endsWith('docs/graphs/g1/nodes'))
    return ['B01-init.plan.md', 'B01-init.fact.md', 'B02-parser.plan.md', 'B02-parser.claim.md', 'B02-parser.ask-q1.md']
  return []
}
const fakeReadFile = file => {
  if (file.endsWith('B01-init.plan.md')) return '---\nid: B01\ndependsOn: []\nowner: alice\n---\n'
  if (file.endsWith('B01-init.fact.md')) return '---\nstatus: done\n---\n'
  if (file.endsWith('B02-parser.plan.md')) return '---\nid: B02\ndependsOn: [B01]\nowner: bob\n---\n'
  return ''
}

const code = runGraphCli(['status'], {
  cwd: '/repo',
  readdir: fakeReaddir,
  readFile: fakeReadFile,
  log: m => logs.push(m)
})
// code === 0
// logs[0] починається з "граф g1 — awaiting-human:1 done:1"
```

### Розширення (планується контрактом)

Наступні зрізи DAG (поза цим файлом):

- `claim` — позначення взяття вузла в роботу.
- `tick` — інкрементальне оновлення стану.
- `dispatch` — диспатч готових (`ready`) вузлів виконавцям.

### Тестованість

- Усі чисті функції (`classifyArtifact`, `parseIdList`, `deriveStatus`, `deriveGraph`, `renderGraph`) — без I/O, тестуються прямо.
- `scanGraph`, `runGraphCli`, `listGraphs` — отримують `readdir`/`readFile`/`log` через `deps`, що дозволяє повний unit-тест без диска.

### Граничні випадки

- Каталог `docs/graphs/<g>/nodes` відсутній → дефолтний `readdir` повертає `[]` → `scanGraph` віддає порожній масив → `renderGraph` друкує `"граф <g>: вузлів не знайдено"`.
- Файл без розпізнаного суфікса → пропускається.
- `parseFrontMatter` повертає `null` → fallback `?? {}` запобігає винятку.
- Кілька `plan`/`fact` для одного `stem` → перемагає останній проскансований; `claim`/`ask`/`ans` — кумулятивні.
- `parseIdList` із вкладеними дужками (наприклад `"[[A], B]"`) — `replace` без флага `g` видалить лише першу пару, інші лишаться у значеннях.
