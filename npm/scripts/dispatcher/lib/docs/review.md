# review.mjs

## Огляд

Модуль реалізує команду `flow review` — adversarial-перевірку коду **після** його написання (концепція з BMAD quick-dev: спершу self-check, потім adversarial-review). Незалежний субагент-рецензент читає **лише** `git diff` від базового комміту й шукає логічні баги, ризики та smells, які не ловлять механічні гейти (lint + coverage) у команді `verify`.

Команда є **інформативною**: ворота м'які, тож exit code завжди `0`, якщо вдалося запустити рецензію. Код `1` повертається лише за технічної неможливості (немає стану flow, не вдалось створити runner). Кількість рецензентів визначається полем `level` стану flow (через `reviewersFor`), а додаткова security-лінза вмикається для `risk === 'high'`.

Усі сторонні залежності (запуск процесів, runner субагента, годинник) **ін'єктуються** через об'єкт `deps`, тож модуль повністю тестується без реального git та LLM.

Результати рецензії (`{ at, reviewers, findings }`) фіксуються в `.flow.json` через `recordTransition` і виводяться у лог зі зрозумілими емодзі-іконками за severity.

## Експорти / API

Модуль експортує чотири іменовані функції:

| Експорт | Тип | Призначення |
|---------|-----|-------------|
| `diffFromBase(base, run, cwd)` | `function` | Будує текст diff: закомічене `base...HEAD` + working tree `git diff`. |
| `reviewerPrompt(diff, risk)` | `function` | Формує промпт для adversarial-рецензента з фокусом на diff (опційно security-лінза). |
| `parseFindings(text)` | `function` | Витягає JSON-масив findings з відповіді субагента (fail-soft). |
| `dedupeFindings(findings)` | `function` | Дедуплікує findings за ключем `(file, issue)`. |
| `review(_rest, deps)` | `async function` | Головна точка входу команди `flow review`. |

Внутрішня (не експортується) функція `severityIcon(severity)` повертає емодзі-маркер.

Константа модульного scope:

- `DIFF_LIMIT = 12_000` — максимальна кількість символів diff, що потрапляє у промпт рецензента (захист від роздування контексту).

## Функції

### `diffFromBase(base, run, cwd)`

**Сигнатура:** `(base: string, run: (cmd, args, opts) => { stdout: string }, cwd: string) => string`

**Параметри:**

- `base` — базовий комміт, від якого рахується diff (наприклад, `HEAD~1` або значення з `state.metadata.base_commit`).
- `run` — ін'єктований git-раннер. Виклик `run('git', args, { cwd })` має повертати об'єкт із полем `stdout`.
- `cwd` — шлях до worktree, у якому виконуються git-команди.

**Повертає:** склеєний рядок з двох частин — `git diff base...HEAD` (закомічене) і `git diff` (робоче дерево), розділених `\n`, з обрізаними пробілами по краях.

**Side effects:** виконує два процеси `git` через ін'єктований `run`. Без `run` — чиста функція.

**Особливості:** `stdout` нормалізується через `?? ''`, тому якщо одна з команд не повернула вивід, інша частина не "забивається" `undefined`.

---

### `reviewerPrompt(diff, risk)`

**Сигнатура:** `(diff: string, risk?: string) => string`

**Параметри:**

- `diff` — текст diff для рецензування (обрізається до `DIFF_LIMIT` символів).
- `risk` — рівень ризику flow: `'low'`, `'med'`, `'high'`. За `risk === 'high'` додається security-лінза з акцентом на auth/секрети/ін'єкції/незворотні операції.

**Повертає:** готовий текст промпта для adversarial-рецензента — рядки, склеєні через `\n` (порожні через `lens` або інші falsy-вставки відфільтровуються `.filter(Boolean)`).

**Side effects:** немає (чиста функція).

**Ключові вимоги в промпті:**

1. Рецензент шукає баги/ризики/smells, які **вносить або зачіпає** саме цей diff.
2. Якщо доступний інструмент `Read` — точково читає referenced-файли для верифікації cross-file тверджень; інакше працює лише з diff.
3. Сусідні файли — для контексту, **не** для пошуку преіснуючих багів.
4. Заборонено нефальсифіковні findings виду "з diff не видно / можливо" — або підтвердити читанням, або відкинути.
5. Формат відповіді — **лише** JSON-масив `[{ severity, file, issue, suggestion }]`; якщо проблем нема — `[]`.

---

### `parseFindings(text)`

**Сигнатура:** `(text: string) => Array<{ severity?: string, file?: string, issue?: string, suggestion?: string }>`

**Параметри:**

- `text` — сирий вивід субагента-рецензента.

**Повертає:** масив findings. Якщо JSON-масив не знайдено або парсинг впав — повертає `[]`.

**Алгоритм:**

1. Знаходить індекси першого `[` та останнього `]` у тексті.
2. Якщо хоча б одного нема, або `end < start` — повертає `[]`.
3. Парсить підрядок `[...]` через `JSON.parse`.
4. Якщо результат — масив, повертає його; інакше або при exception — `[]`.

**Side effects:** немає. Fail-soft: будь-яке сміття/невалідний JSON безпечно перетворюється на порожній масив.

---

### `dedupeFindings(findings)`

**Сигнатура:** `(findings: object[]) => object[]`

**Параметри:**

- `findings` — масив findings (можливо з дублікатами).

**Повертає:** новий масив без дублікатів за ключем `${file}::${issue}`, зі збереженням порядку першого входження.

**Side effects:** немає (чиста функція, але створює новий масив).

**Особливості:** `f?.file ?? ''` і `f?.issue ?? ''` — `undefined`/`null` нормалізуються до пустого рядка, тож два findings без обох полів вважаються дублікатами.

---

### `severityIcon(severity)` *(internal)*

**Сигнатура:** `(severity: string) => string`

**Параметри:**

- `severity` — рівень: `'high'` | `'med'` | будь-що інше.

**Повертає:** емодзі-іконку:

- `'high'` → червоне коло;
- `'med'` → жовте коло;
- решта (включно з `'low'`, `undefined`) → біле коло.

**Side effects:** немає.

---

### `review(_rest, deps)`

**Сигнатура:** `(_rest: string[], deps?: object) => Promise<number>`

**Параметри:**

- `_rest` — позиційні аргументи CLI (не використовуються; передається для уніфікованої сигнатури команд диспатчера).
- `deps` — об'єкт ін'єкцій:
  - `cwd` — стартова робоча тека (за замовчуванням `process.cwd()`);
  - `branch` — гілка для авторезолву flow-стану (необов'язково);
  - `log` — функція логування (за замовчуванням `console.error`);
  - `run` — git-раннер (за замовчуванням `realRun` з `./commands.mjs`);
  - `runner` — готовий runner субагента; якщо не передано — створюється через `createRunner(deps)`;
  - `now` — джерело часу (за замовчуванням `Date.now`).

**Повертає:** `Promise<number>` — exit code:

- `0` — нормальне завершення (включно з випадком "нема змін" та з будь-якою кількістю findings);
- `1` — технічна неможливість виконати рецензію (нема активного flow-стану, нема `.flow.json`, не вдалось створити runner).

**Side effects:**

- Викликає `resolveActiveFlowState` для пошуку активного flow.
- Читає файл стану через `readState(statePath)`.
- Виконує git через `run` (всередині `diffFromBase`).
- Створює runner субагента (`createRunner`) і запускає `runner.runStep(prompt, { cwd })` стільки разів, скільки повернув `reviewersFor`.
- Записує транзицію в state-store через `recordTransition`, додаючи поле `review: { at, reviewers, findings }`.
- Логує кожен finding з емодзі за severity та підсумок `review: N findings (рецензентів: M)`. Якщо є high-severity — додатковий warning.

**Покроковий потік:**

1. Зчитує `cwd0`, `log`, `run`, `now` з `deps` із дефолтами.
2. Резолвить активний flow-стан через `resolveActiveFlowState({ cwd: cwd0, branch }, deps)`.
   - Якщо `statePath` пустий — лог помилки + `return 1`.
   - Якщо `autoResolved` — інформативний лог.
3. Робочий `cwd` = `resolved.worktreeDir ?? cwd0`.
4. Читає стан `state = readState(statePath)`. Якщо немає — лог `review: стану нема — спершу 'flow init'` + `return 1`.
5. Бере `base = state.metadata?.base_commit ?? 'HEAD~1'`.
6. Будує `diff = diffFromBase(base, run, cwd)`. Якщо пустий — лог `review: нема змін від base — нічого ревʼювити` + `return 0`.
7. Готує `runner`: бере з `deps.runner`, інакше пробує `await createRunner(deps)`. На exception — лог `review: ${error.message}` + `return 1`.
8. Обчислює `reviewers = reviewersFor(state.level ?? 1, state.risk)` — скільки паралельних рецензентів запустити.
9. Будує промпт `reviewerPrompt(diff, state.risk)`.
10. Запускає `reviewers` копій рецензента паралельно через `Promise.all` + `runner.runStep(prompt, { cwd })`.
11. Збирає findings: для кожного результату з `r.ok === true` парсить через `parseFindings(r.output)`, потім `flatMap` + `dedupeFindings`.
12. Викликає `recordTransition` з `type: 'review'`, кількістю findings, reducer-функцією, що додає поле `review`, і `now`.
13. Логує кожен finding: `${іконка} ${file ?? '?'}: ${issue ?? ''}`.
14. Якщо є high-severity findings — додатковий warning рядок.
15. Підсумковий лог `review: N findings (рецензентів: M)` і `return 0`.

## Залежності

### Зовнішні (Node.js standard)

- `cwd as processCwd` з `node:process` — дефолтний CWD для команди.

### Внутрішні модулі

- `./commands.mjs` — `realRun`: дефолтний раннер shell-команд (`git`).
- `./events.mjs` — `flowEventsPath`: шлях до файла подій flow для `recordTransition`.
- `./level.mjs` — `reviewersFor(level, risk)`: скільки adversarial-рецензентів запускати на даному рівні строгості та ризику.
- `./state-store.mjs`:
  - `readState(statePath)` — читає `.flow.json`;
  - `recordTransition(paths, event, reducer, now)` — атомарно оновлює стан і дописує подію в events-лог.
- `./flow-resolve.mjs` — `resolveActiveFlowState({ cwd, branch }, deps)`: знаходить активний flow за CWD або з авторезолвом по гілці; повертає `{ statePath, worktreeDir, label, autoResolved, error }`.
- `./subagent-runner.mjs` — `createRunner(deps)`: фабрика об'єкта з методом `runStep(prompt, opts) → Promise<{ ok, output }>` для запуску LLM-субагента.

### Зовнішні fail-points

- `git` (через `run`).
- Запуск LLM-субагента (через `runner.runStep`), що, ймовірно, використовує Claude CLI або аналог.

## Потік виконання / Використання

### Типове використання як CLI-команди

Команда `review` зареєстрована у dispatcher і викликається так:

```bash
flow review
```

Алгоритм:

1. Користувач має активний flow (створений через `flow init`) з `.flow.json` у поточному worktree або резолвиться авто.
2. У стані лежить `metadata.base_commit` (комміт-стартер flow).
3. Команда збирає diff від `base_commit` до HEAD + working tree, формує промпт і запускає рецензентів.
4. Findings виводяться в stderr і зберігаються в `.flow.json` під ключем `review`.

### Програмне використання (тести)

```javascript
import { review, diffFromBase, reviewerPrompt, parseFindings, dedupeFindings } from './review.mjs'

// Тест без git та LLM
const fakeRun = (cmd, args) => ({ stdout: 'diff text' })
const fakeRunner = {
  async runStep(prompt, { cwd }) {
    return { ok: true, output: '[{"severity":"high","file":"a.js","issue":"npe","suggestion":"check null"}]' }
  }
}
const exit = await review([], {
  cwd: '/tmp/repo',
  run: fakeRun,
  runner: fakeRunner,
  now: () => 0,
  log: () => {}
})
// exit === 0
```

### Інваріанти та контракти

1. **Exit-code контракт:** `0` за успішного запуску рецензії (включно з нульовою кількістю findings); `1` лише за відсутності стану або runner-а.
2. **Ідемпотентність:** повторний запуск `review` перезаписує поле `review` у стані поточним підсумком; події накопичуються в events-лозі.
3. **Fail-soft парсинг:** будь-яке "сміття" від рецензента → пустий список findings, а не exception.
4. **Дедуплікація** — по `(file, issue)`, **не** по `suggestion`/`severity`. Різні рецензенти, що знайшли одну проблему по-різному, схлопуються в один finding.
5. **Контекст-ліміт:** diff обрізається до 12 000 символів — рецензент бачить лише початок великих diff'ів.

### Rebuild Test

Якщо файл видалити й переписати на основі цієї документації, відновлення має містити:

1. Імпорти: `cwd as processCwd` з `node:process`; `realRun` з `./commands.mjs`; `flowEventsPath` з `./events.mjs`; `reviewersFor` з `./level.mjs`; `readState`, `recordTransition` з `./state-store.mjs`; `resolveActiveFlowState` з `./flow-resolve.mjs`; `createRunner` з `./subagent-runner.mjs`.
2. Константу `DIFF_LIMIT = 12_000`.
3. Експорти `diffFromBase`, `reviewerPrompt`, `parseFindings`, `dedupeFindings`, `review` із сигнатурами та поведінкою, описаними вище.
4. Внутрішню `severityIcon` із трьома кейсами (`high` → червоний, `med` → жовтий, інше → білий).
5. У `review`: всі гілки `return 1` (нема `statePath`, нема стану, помилка `createRunner`); `return 0` за пустого diff; запуск `reviewers` копій рецензента через `Promise.all`; фільтрацію `r.ok` перед `parseFindings`; `dedupeFindings` після `flatMap`; виклик `recordTransition` з полем `review: { at, reviewers, findings }`; логування з іконками + warning для high-severity + підсумок.
