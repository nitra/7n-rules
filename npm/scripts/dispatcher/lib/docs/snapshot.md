# snapshot.mjs

## Огляд

Модуль `snapshot.mjs` — частина шару `lib/` диспетчера flow-задач (`npm/scripts/dispatcher/lib/`). Його єдине призначення — створення та збереження **completion snapshot** (підсумкового слугу про виконання задачі) у durable-сховище, ще до того, як буде видалено transient-файл `.flow.json`.

Контекст і причина існування модуля (зі специфікації §3 Ф5, §7):

- Стан виконання flow-задачі тимчасово живе у файлі `.flow.json` всередині гілки/робочої теки.
- На етапі завершення (cleanup) цей transient-стан видаляється.
- Але потрібно, щоб **слід** про виконану задачу пережив cleanup: для аудиту, історії, ретроспективи.
- Тому перед видаленням ми будуємо стислий JSON-snapshot і вписуємо його в **task record** — markdown-файл `docs/tasks/<id>.md` між двома HTML-маркерами. Запис **ідемпотентний**: повторний прогін перезаписує блок Summary, а не дублює його.

Модуль експонує три pure/IO-функції з чітко розділеними рівнями (чиста трансформація → чистий upsert у тексті → IO у файлову систему), що робить логіку легко тестованою без mock-ів FS на більшості шляхів.

## Експорти / API

Модуль експортує три іменовані функції (`export function ...`):

| Експорт | Тип | Призначення |
|---|---|---|
| `buildCompletionSnapshot(state, now?)` | pure-функція | Складає JSON-об'єкт snapshot зі стану `.flow.json`. |
| `upsertSummaryBlock(content, snapshot)` | pure-функція | Вставляє або оновлює блок Summary у наданому markdown-тексті між маркерами. |
| `writeSummaryToTaskRecord(taskPath, snapshot)` | IO-функція | Читає файл task record (якщо існує), застосовує `upsertSummaryBlock` і пише результат назад. |

Внутрішні (не експортовані) константи:

- `SUMMARY_START = '<!-- flow:summary:start -->'` — відкриваючий HTML-коментар-маркер.
- `SUMMARY_END = '<!-- flow:summary:end -->'` — закриваючий HTML-коментар-маркер.

Ці маркери — публічний контракт формату task record: будь-який інший інструмент може шукати ці ж літерали, щоб витягнути або переписати блок.

## Функції

### `buildCompletionSnapshot(state, now = Date.now)`

**Сигнатура:**

```js
buildCompletionSnapshot(state: object, now?: () => number): object
```

**Параметри:**

- `state` — об'єкт стану задачі (типово розпарсений `.flow.json`). Очікувані поля (всі опційні, мають дефолти):
  - `state.status` — рядковий статус, дефолт `'done'`.
  - `state.branch` — назва гілки, дефолт `null`.
  - `state.metadata?.base_commit` — base commit гілки; якщо відсутній, fallback `state.base_commit`; дефолт `null`.
  - `state.gates` — масив об'єктів `{ name, ok }`; кожен gate перетворюється у пару `[name, ok ? 'ok' : 'fail']`.
  - `state.change` — інформація про change-файл (n-changelog), дефолт `null`.
  - `state.notified` — статус нотифікації, дефолт `null`.
- `now` — фабрика часу: функція, що повертає мілісекунди (`number`). За замовчуванням — `Date.now`. Передається явно, щоб **тести могли інжектувати детерміністичний час**.

**Повертає:**

Об'єкт `snapshot` із полями:

```text
{
  status:       string,   // state.status ?? 'done'
  branch:       string|null,
  base_commit:  string|null,
  gates:        Record<string,'ok'|'fail'>, // плоска мапа name → status
  change:       any|null,
  notified:     any|null,
  finished_at:  string    // ISO-8601, отриманий через new Date(now()).toISOString()
}
```

**Side effects:** жодних. Це чиста функція (за умови чистоти переданої `now`).

**Особливості реалізації:**

- Поле `base_commit` має **двоступеневий fallback**: спочатку `state.metadata?.base_commit`, потім `state.base_commit`. Це покриває обидва формати state, що зустрічаються в практиці.
- `gates` нормалізуються до **рядкового** статусу `'ok'`/`'fail'` (а не булевого `ok`), щоб JSON у markdown був самодокументованим і людиночитним.
- `finished_at` обчислюється з результату виклику `now()`, тому час фіксується саме в момент побудови snapshot.
- Якщо `state.gates` відсутній — використовується порожній масив, і поле `gates` буде `{}`.

### `upsertSummaryBlock(content, snapshot)`

**Сигнатура:**

```js
upsertSummaryBlock(content: string, snapshot: object): string
```

**Параметри:**

- `content` — вихідний markdown-текст task record (може бути порожнім рядком).
- `snapshot` — об'єкт, що буде серіалізований у JSON (через `JSON.stringify(..., null, 2)`) усередину блоку.

**Повертає:** новий markdown-рядок зі вставленим або оновленим блоком Summary.

**Side effects:** жодних, чиста рядкова трансформація.

**Структура блоку, який будує функція:**

```text
<!-- flow:summary:start -->
## Summary
```json
{ ... pretty-printed snapshot ... }
```
<!-- flow:summary:end -->
```

(У реальному виводі трійні бектики справжні; тут показано схематично, бо ми всередині markdown.)

**Алгоритм (idempotent upsert):**

1. Сформувати рядок `block` із маркерів, заголовка `## Summary`, fenced JSON-блоку та закриваючого маркера.
2. Знайти індекси `i = content.indexOf(SUMMARY_START)` та `j = content.indexOf(SUMMARY_END)`.
3. Якщо обидва маркери знайдено і `j > i` — **замінити** діапазон `[i, j + len(SUMMARY_END))` на `block`. Це гарантує, що повторний виклик не дублює блок і не залишає старого вмісту.
4. Інакше (маркерів немає, або вони у неправильному порядку) — **дописати** блок у кінець: `content.trimEnd() + '\n\n' + block + '\n'`. `trimEnd()` прибирає лишні хвостові переноси, потім додається порожній рядок-розділювач.

**Кейси (контракт):**

| Вхідний `content` | Поведінка |
|---|---|
| Порожній рядок `''` | Дописує `\n\n<block>\n` (фактично починається з `\n\n` через `trimEnd('')`). |
| Markdown без маркерів | Дописує блок у кінець із розділювачем. |
| Markdown із валідною парою маркерів | Замінює вміст між ними (включно з самими маркерами) на свіжий блок. |
| Markdown із поодиноким `SUMMARY_START` без `SUMMARY_END` | Йде у гілку append (дописати в кінець). |
| Markdown із `SUMMARY_END` перед `SUMMARY_START` (`j <= i`) | Теж йде в append. |

### `writeSummaryToTaskRecord(taskPath, snapshot)`

**Сигнатура:**

```js
writeSummaryToTaskRecord(taskPath: string, snapshot: object): void
```

**Параметри:**

- `taskPath` — **абсолютний** шлях до task record-файла (типово `<repo>/docs/tasks/<id>.md`).
- `snapshot` — об'єкт snapshot (зазвичай результат `buildCompletionSnapshot`).

**Повертає:** `void`.

**Side effects:**

- Кидає `Error`, якщо `taskPath` **не** абсолютний (`isAbsolute(taskPath) === false`). Текст помилки: `writeSummaryToTaskRecord: очікується абсолютний шлях (отримано: <taskPath>)`.
- Якщо файл існує — читає його синхронно (`readFileSync(taskPath, 'utf8')`).
- Якщо файл не існує — використовує порожній рядок як base.
- Записує результат `upsertSummaryBlock(...)` у `taskPath` синхронно (`writeFileSync(..., 'utf8')`). Файл буде створено, якщо його не було.

**Особливості:**

- Усі IO — **синхронні**. Це свідомий вибір: функція викликається на cleanup-етапі диспетчера, де простота й детерміністичність важливіші за throughput.
- Не створює проміжних каталогів. Очікується, що `docs/tasks/` уже існує (інакше `writeFileSync` кине `ENOENT`).
- Не виконує бекапу: попередній блок Summary перезаписується новим (про що дбає `upsertSummaryBlock`).

## Залежності

**Зовнішні (Node.js core, через `node:` префікс):**

- `node:fs` — `existsSync`, `readFileSync`, `writeFileSync` (синхронний IO).
- `node:path` — `isAbsolute` (валідація вхідного шляху).

**Внутрішніх залежностей** (на інші модулі диспетчера) — **немає**. Модуль самодостатній і не імпортує нічого з `lib/` чи проєкту.

**Зовнішні npm-пакети:** відсутні.

**Тип/середовище:** ESM (`.mjs`, `import`-синтаксис), запускається у Node.js / Bun.

## Потік виконання / Використання

### Сценарій 1: завершення flow-задачі (основний use case)

Псевдокод callsite (типового місця виклику в диспетчері):

```js
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildCompletionSnapshot,
  writeSummaryToTaskRecord
} from './lib/snapshot.mjs'

// 1. Зчитати transient-стан.
const state = JSON.parse(readFileSync('.flow.json', 'utf8'))

// 2. Побудувати completion snapshot.
const snapshot = buildCompletionSnapshot(state)

// 3. Уписати його в durable task record.
const taskPath = join(repoRoot, 'docs', 'tasks', `${state.id}.md`)
writeSummaryToTaskRecord(taskPath, snapshot)

// 4. Тепер безпечно видаляти `.flow.json` (cleanup).
```

### Сценарій 2: тестування (інжекція часу)

`buildCompletionSnapshot` приймає `now` як параметр, тож тест може зафіксувати `finished_at`:

```js
const fixedNow = () => 1_700_000_000_000
const snap = buildCompletionSnapshot(state, fixedNow)
// snap.finished_at === '2023-11-14T22:13:20.000Z'
```

### Сценарій 3: ідемпотентний повторний запис

Виклик `writeSummaryToTaskRecord` на тому ж шляху з тим самим snapshot **не** змінює файл змістовно (тільки переписує блок Summary тим самим вмістом). На різних snapshot — оновлює блок без дублювання та без впливу на решту markdown поза маркерами.

### Потік даних

```
.flow.json (transient)
       │
       ▼  JSON.parse
   state object
       │
       ▼  buildCompletionSnapshot(state, now)
   snapshot object  ─────────────┐
                                 ▼  upsertSummaryBlock(content, snapshot)
docs/tasks/<id>.md (existing) ───┤
       │                         ▼
       │                  updated markdown
       │                         │
       └─◀────── writeFileSync ──┘
```

### Інваріанти

- `finished_at` завжди є валідним ISO-8601 рядком.
- `gates` завжди є об'єктом (нехай і порожнім), ніколи не `undefined`.
- Файл task record після виклику завжди містить рівно один блок Summary між маркерами.
- HTML-маркери залишаються в markdown навмисно: вони не рендеряться у GitHub/MD-рендерерах, але слугують machine-readable якорями для idempotent upsert.

## Rebuild Test

Mental-rebuild перевірка (чи документація достатня для відтворення модуля з нуля без перегляду коду):

1. **Призначення зрозуміле?** Так — будувати completion snapshot і вписувати його між HTML-маркерами в `docs/tasks/<id>.md` перед cleanup `.flow.json`.
2. **Експорти й сигнатури повні?** Так — три функції з типами параметрів, дефолтами, типами повернення.
3. **Формат snapshot задокументовано?** Так — перелік полів, дефолти, fallback-логіка для `base_commit`, нормалізація `gates` до `'ok'`/`'fail'`.
4. **Формат блоку в markdown задокументовано?** Так — маркери, `## Summary`, fenced JSON-блок, pretty-print 2 пробіли.
5. **Алгоритм upsert описаний?** Так — пошук маркерів, заміна діапазону при валідній парі, інакше append із `trimEnd` + `\n\n`.
6. **Обробка помилок описана?** Так — `Error` на не-абсолютний шлях, відсутність файлу = порожній base.
7. **Залежності перелічено?** Так — `node:fs` (3 функції), `node:path` (`isAbsolute`).
8. **Side effects явні?** Так — синхронний IO лише в `writeSummaryToTaskRecord`; решта pure.
9. **Інваріанти й кейси edge?** Так — порожній content, поодинокий маркер, зворотний порядок маркерів, повторний запис.
10. **Інжекція часу для тестів?** Так — параметр `now`.

Рекомпіляція з документації → ідентичний за поведінкою модуль: можлива.
