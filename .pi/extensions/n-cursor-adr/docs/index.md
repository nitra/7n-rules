# Документація файлу `.pi/extensions/n-cursor-adr/index.ts`

## Огляд

Файл `.pi/extensions/n-cursor-adr/index.ts` — це розширення для платформи `pi.dev`, яке реалізує перехоплення завершення агентської сесії (`agent_end` event) та делегує захоплення (`capture`) і нормалізацію (`normalize`) ADR-рішень існуючим bash-скриптам у `.claude/hooks/`.

Призначення файлу `.pi/extensions/n-cursor-adr/index.ts`:

- Бути **TS-адаптером** між `pi.dev` event loop і вже наявною інфраструктурою на bash (`.claude/hooks/capture-decisions.sh`, `.claude/hooks/normalize-decisions.sh`).
- Серіалізувати entries з `pi.dev`-сесії (`ctx.sessionManager.getEntries()`) у **Claude-сумісний JSONL** у тимчасовому каталозі ОС (`tmpdir()`).
- Формувати **stdin JSON payload** з полями `transcript_path` і `session_id` для bash-хуків.
- Спавнити обидва bash-хуки **паралельно** через `pi.exec` із незалежними тайм-аутами, не блокуючи основний `agent_end`.
- Захищати ланцюжок від **рекурсії** через env-vars `CAPTURE_DECISIONS_RUNNING` та `ADR_NORMALIZE_RUNNING`, які bash-скрипти виставляють перед спавном LLM CLI.

Принципова межа відповідальності: уся skip/throttle/LLM-CLI-selection логіка зберігається у bash; TS лише адаптує контракт `pi.dev` → bash.

## Експорти / API

Файл `.pi/extensions/n-cursor-adr/index.ts` експортує одну сутність — `default` функцію.

### `export default function (pi: PiExec): void`

- **Тип**: default-експорт, anonymous function declaration.
- **Параметр**: `pi: PiExec` — обʼєкт API розширення `pi.dev`, що дає метод `pi.exec(...)` (спавн процесів) та `pi.on(...)` (підписка на події).
- **Повертає**: `void` — функція реєструє listener і не повертає значення.
- **Контракт `pi.dev`**: модуль розширення повинен default-експортувати функцію, яку pi-runtime викликає під час завантаження розширення, передаючи `PiExec` як єдиний аргумент.

Інших публічних експортів файл `.pi/extensions/n-cursor-adr/index.ts` не має.

## Внутрішні типи

Усередині файлу `.pi/extensions/n-cursor-adr/index.ts` оголошено два **TypeScript interface**, які описують контракт `pi.dev` runtime. Вони не експортуються.

### `interface PiContext`

Опис контексту сесії, який `pi.dev` передає у handler `agent_end`:

- `cwd: string` — робочий каталог сесії, передається у `pi.exec` як `cwd` і експортується як `CLAUDE_PROJECT_DIR`.
- `sessionId?: string` — опційний ідентифікатор сесії; коли відсутній — підставляється `randomUUID()`.
- `signal?: AbortSignal` — опційний `AbortSignal` для скасування spawn-ів через `pi.exec`.
- `sessionManager: { getEntries(): Array<{ message?: { role?: string; content?: unknown } }> }` — менеджер сесії з методом `getEntries()`, що повертає масив entries, де кожен entry опційно має `message.role` (string) та `message.content` (unknown).
- `ui?: { notify?: (msg: string, level?: 'info' | 'warning' | 'error') => void }` — опційний UI-канал для повідомлень користувачу; рівні: `info`, `warning`, `error`.

### `interface PiExec`

Опис API розширення `pi.dev`, що передається в default-експорт:

- `exec: (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; input?: string; signal?: AbortSignal; timeout?: number }) => Promise<{ code: number; stdout: string; stderr: string }>` — спавн дочірнього процесу з опційним stdin (`input`), env-override, abort-сигналом і тайм-аутом у мілісекундах; промісом повертає exit code та два потоки як рядки.
- `on: (event: string, handler: (event: unknown, ctx: PiContext) => Promise<void> | void) => void` — підписка на іменовану подію; `handler` отримує raw event і `PiContext`, може бути синхронним або асинхронним.

## Константи

Файл `.pi/extensions/n-cursor-adr/index.ts` оголошує дві модульні `const` зі шляхами до bash-хуків (відносно `ctx.cwd`):

- `const CAPTURE_HOOK = '.claude/hooks/capture-decisions.sh'` — bash-хук захоплення рішень.
- `const NORMALIZE_HOOK = '.claude/hooks/normalize-decisions.sh'` — bash-хук нормалізації рішень.

Обидва шляхи передаються як `args[0]` у виклик `pi.exec('bash', [<HOOK>], …)`.

## Функції

### Default-експорт (анонімна функція)

```ts
export default function (pi: PiExec): void
```

- **Сигнатура**: `(pi: PiExec) => void`.
- **Параметр `pi`**: реалізація `PiExec` від `pi.dev` runtime.
- **Повертає**: `void`.
- **Side effects**: реєструє listener `pi.on('agent_end', …)`. Жодного коду, що виконується одразу (поза реєстрацією listener), у функції немає.

Логіка тіла функції файлу `.pi/extensions/n-cursor-adr/index.ts`:

1. Виклик `pi.on('agent_end', async (_event, ctx) => { … })` — реєстрація async-handler на подію `'agent_end'`. Перший аргумент handler (`_event`) ігнорується (підкреслення на початку імені).

### Inline handler події `'agent_end'`

```ts
;async (_event, ctx: PiContext) => Promise<void>
```

- **Параметри**:
  - `_event: unknown` — payload події, не використовується.
  - `ctx: PiContext` — контекст сесії з `cwd`, `sessionId`, `signal`, `sessionManager`, `ui`.
- **Повертає**: `Promise<void>`.
- **Side effects**:
  - Запис файлу у `tmpdir()` (через `writeFileSync`).
  - Виклик `ctx.ui?.notify?.(...)` у разі помилки серіалізації.
  - Спавн двох bash-процесів через `pi.exec(...)`.

Покрокова логіка inline handler у файлі `.pi/extensions/n-cursor-adr/index.ts`:

1. **Recursion guard**. Перевіряє `env.CAPTURE_DECISIONS_RUNNING` і `env.ADR_NORMALIZE_RUNNING` (читання з `node:process` `env`). Якщо хоча б одна з env-vars truthy — handler виходить (`return`) і не виконує жодних дій. Це блокує рекурсивний trigger: bash-хук → LLM CLI (`claude`/`cursor-agent`) → нова pi-сесія → `agent_end` → знову bash-хук.
2. **Серіалізація transcript**.
   - `const entries = ctx.sessionManager.getEntries()` — отримує всі entries з менеджера сесії.
   - `.filter(e => e.message?.role === 'user' || e.message?.role === 'assistant')` — лишає лише user/assistant entries; system та решта ролей відкидаються.
   - `.map(e => JSON.stringify({ type: e.message?.role, message: e.message }))` — серіалізує кожен entry як обʼєкт із полями `type` (роль) і `message` (повний `e.message`).
   - `.join('\n')` — склеює у JSONL (по рядку на entry, без trailing `\n`).
   - `jsonlPath = join(tmpdir(), \`n-cursor-pi-transcript-${Date.now()}-${randomUUID()}.jsonl\`)` — формує унікальний шлях у системному tmpdir з міткою часу й UUID.
   - `writeFileSync(jsonlPath, lines + '\n', 'utf8')` — синхронно пише файл у UTF-8 із доданим завершальним `\n`.
   - Уся серіалізація обгорнута в `try { … } catch (error) { … }`. У `catch`: `ctx.ui?.notify?.(\`@nitra/cursor: transcript serialization failed — ${(error as Error).message}\`, 'error')`і ранній`return` — handler виходить без виклику хуків.
   - Змінна `jsonlPath` оголошена `let` поза `try` (з типом `string`) — щоб після `try` бути доступною. У разі помилки гілка повертає `return`, тож звертань до неявно неініціалізованої `jsonlPath` поза `try` не буде.
3. **Формування stdin payload**:
   - `const stdinPayload = JSON.stringify({ transcript_path: jsonlPath, session_id: ctx.sessionId ?? randomUUID() })`.
   - Поле `transcript_path` — абсолютний шлях до JSONL у `tmpdir()`.
   - Поле `session_id` — `ctx.sessionId`, якщо є; інакше згенерований `randomUUID()`.
4. **Формування env override**:
   - `const envOverride = { ...env, CLAUDE_PROJECT_DIR: ctx.cwd } as Record<string, string>` — копіює поточне `process.env`, додає/перезаписує `CLAUDE_PROJECT_DIR` шляхом до `ctx.cwd`. Каст `as Record<string, string>` потрібен, бо `process.env` має тип `NodeJS.ProcessEnv`, а `pi.exec` приймає `Record<string, string>`.
5. **Паралельний спавн bash-хуків через `Promise.allSettled`**:
   - `pi.exec('bash', [CAPTURE_HOOK], { cwd: ctx.cwd, env: envOverride, input: stdinPayload, signal: ctx.signal, timeout: 180_000 })` — capture-хук, тайм-аут **180 секунд**.
   - `pi.exec('bash', [NORMALIZE_HOOK], { cwd: ctx.cwd, env: envOverride, input: stdinPayload, signal: ctx.signal, timeout: 600_000 })` — normalize-хук, тайм-аут **600 секунд** (10 хвилин — нормалізація через LLM довша).
   - Обидва виклики обгорнуті в `await Promise.allSettled([ … ])` — кожен виклик завершується незалежно, помилка одного (наприклад, `ENOENT`, якщо `.claude/hooks/*.sh` відсутні в pi-only консьюмера з `claude-config: false`) не зриває іншого, і обидві проміси завершуються як `'fulfilled'` або `'rejected'` без кидання exception нагору.
   - `await` тримає handler `'agent_end'` до завершення обох хуків (або їхнього rejection/timeout), але оскільки сам `Promise.allSettled` ніколи не reject-ить — exception поза handler не пропустить.

## Залежності

### Імпорти зі стандартної бібліотеки Node.js

У файлі `.pi/extensions/n-cursor-adr/index.ts` використовуються лише core-модулі Node:

- `import { randomUUID } from 'node:crypto'` — генерація UUID v4 для імені тимчасового JSONL та fallback `session_id`.
- `import { writeFileSync } from 'node:fs'` — синхронний запис transcript у tmpdir; `await`-сумісний async варіант не використовується, бо логіка серіалізації лінійна й обгорнута в `try/catch`.
- `import { tmpdir } from 'node:os'` — отримання системного тимчасового каталогу для `jsonlPath`.
- `import { join } from 'node:path'` — кросплатформне склеювання шляху `tmpdir() + ім'я файлу`.
- `import { env } from 'node:process'` — доступ до `process.env` для перевірки recursion-guard змінних і копіювання у `envOverride`.

### Зовнішні залежності runtime

Файл `.pi/extensions/n-cursor-adr/index.ts` не імпортує жодних npm-пакетів. Усі зовнішні залежності надає **pi.dev runtime** через переданий обʼєкт `PiExec`:

- `pi.exec` — спавн bash-процесу.
- `pi.on` — реєстрація listener на події.

### Bash-залежності (виконуються через `pi.exec`)

- `.claude/hooks/capture-decisions.sh` — захоплення рішень з transcript у формат ADR-чернеток.
- `.claude/hooks/normalize-decisions.sh` — LLM-нормалізація чернеток у фінальні ADR-записи.

Обидва скрипти отримують stdin JSON `{ transcript_path, session_id }` і env-vars `CLAUDE_PROJECT_DIR` (плюс успадковані з `process.env`).

## Потік виконання / Використання

### Завантаження розширення

Платформа `pi.dev` завантажує файл `.pi/extensions/n-cursor-adr/index.ts`, отримує default-функцію та викликає її з аргументом `pi: PiExec`. Default-функція в файлі `.pi/extensions/n-cursor-adr/index.ts` реєструє один listener на подію `'agent_end'` через `pi.on(...)` і завершується.

### Event `'agent_end'` (нормальний потік)

1. `pi.dev` завершує агентську сесію та емітить `'agent_end'`.
2. Inline handler у файлі `.pi/extensions/n-cursor-adr/index.ts` перевіряє recursion-guard env-vars (`CAPTURE_DECISIONS_RUNNING`, `ADR_NORMALIZE_RUNNING`); якщо обидві falsy — продовжує.
3. Через `ctx.sessionManager.getEntries()` отримує entries сесії, фільтрує user/assistant, серіалізує у JSONL у `tmpdir()`.
4. Формує stdin JSON `{ transcript_path, session_id }`.
5. Через `pi.exec('bash', [CAPTURE_HOOK], …)` і `pi.exec('bash', [NORMALIZE_HOOK], …)` спавнить обидва bash-хуки паралельно, обгортаючи у `Promise.allSettled`.
6. Чекає завершення обох (або їхнього timeout), потім handler `'agent_end'` резолвиться.

### Event `'agent_end'` (recursion)

1. Bash-хук (наприклад, `normalize-decisions.sh`) виставляє `ADR_NORMALIZE_RUNNING=1` і спавнить LLM CLI (`claude`, `cursor-agent` тощо).
2. LLM CLI стартує власну pi-сесію, успадковуючи `ADR_NORMALIZE_RUNNING` через `child_process` env inheritance.
3. Нова pi-сесія завершується, емітить `'agent_end'`.
4. Handler у файлі `.pi/extensions/n-cursor-adr/index.ts` бачить `env.ADR_NORMALIZE_RUNNING` truthy — виходить раннім `return`, не серіалізуючи transcript і не спавнячи хуки повторно.

### Event `'agent_end'` (transcript serialization fail)

1. `ctx.sessionManager.getEntries()` або `writeFileSync` кидає exception.
2. Блок `catch` ловить помилку, викликає `ctx.ui?.notify?.(..., 'error')` (якщо `ui.notify` визначене) з повідомленням `@nitra/cursor: transcript serialization failed — <error.message>`.
3. Handler виходить через `return` без спавну bash-хуків.

### Event `'agent_end'` (відсутні bash-скрипти)

1. Якщо `.claude/hooks/*.sh` не існують (pi-only консьюмер із конфігом `claude-config: false`) — `pi.exec` поверне rejection (типово `ENOENT`).
2. Завдяки `Promise.allSettled` rejection не пропускається нагору; handler завершується нормально.

### Ключові гілки логіки

- **Recursion guard**: `if (env.CAPTURE_DECISIONS_RUNNING || env.ADR_NORMALIZE_RUNNING) return` — найперша гілка, виконується до будь-якого I/O.
- **Transcript serialization `try/catch`**: помилка → `ctx.ui?.notify?.(..., 'error')` + `return`; успіх → дальший крок.
- **Fallback `session_id`**: `ctx.sessionId ?? randomUUID()` — генерація UUID, якщо `pi.dev` не передав ідентифікатор сесії.
- **Тайм-аути спавну**: capture — `180_000` мс, normalize — `600_000` мс; рознесені, бо LLM-нормалізація довша.
- **`Promise.allSettled` замість `Promise.all`**: жодна з двох гілок не зриває іншу, і exception назовні не пропускається.
