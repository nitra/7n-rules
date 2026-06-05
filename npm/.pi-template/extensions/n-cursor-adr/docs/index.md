# `npm/.pi-template/extensions/n-cursor-adr/index.ts`

## Огляд

Файл `npm/.pi-template/extensions/n-cursor-adr/index.ts` — це Pi.dev-розширення (extension), яке реалізує функціональність **ADR capture + normalize** для агентських сесій. Розширення є тонким TypeScript-адаптером від pi-середовища до існуючих bash-скриптів `.claude/hooks/capture-decisions.sh` та `.claude/hooks/normalize-decisions.sh`.

На подію `agent_end`, що її емітує Pi.dev runtime, розширення:

1. Серіалізує entries сесії з `ctx.sessionManager.getEntries()` у Claude-сумісний формат **JSONL** у тимчасову теку (`os.tmpdir()`).
2. Формує stdin JSON payload з шляхом до транскрипту та session id.
3. Спавнить bash-хуки `capture-decisions.sh` і `normalize-decisions.sh` через `pi.exec` з відповідними таймаутами (180 с і 600 с).

Уся бізнес-логіка skip/throttle і вибір LLM CLI (`claude` чи `cursor-agent`) залишається у bash-скриптах — TS-частина лише транслює подію pi у виклик хуків. Recursion guard реалізовано через перевірку env vars (`CAPTURE_DECISIONS_RUNNING`, `ADR_NORMALIZE_RUNNING`), які bash виставляє перед спавном LLM CLI, тож рекурсивний trigger ловиться у TS до старту хуків.

## Експорти / API

### Default export

```ts
export default function (pi: PiExec): void
```

Default export — функція-реєстратор pi-розширення. Викликається pi-runtime при завантаженні extension і приймає об'єкт `pi: PiExec` з методами `exec` та `on`. Функція реєструє один listener на подію `agent_end` і нічого не повертає.

### Внутрішні TypeScript-інтерфейси (не експортуються)

#### `PiContext`

Опис контексту, що його pi-runtime передає у handler події `agent_end`:

- `cwd: string` — поточний робочий каталог pi-сесії; передається у bash як `CLAUDE_PROJECT_DIR` і як `cwd` для `pi.exec`.
- `sessionId?: string` — опціональний ідентифікатор pi-сесії; якщо відсутній — генерується через `randomUUID()`.
- `signal?: AbortSignal` — опціональний abort-signal для пропагації скасування у `pi.exec`.
- `sessionManager: { getEntries(): Array<{ message?: { role?: string; content?: unknown } }> }` — реєстр сесії з методом отримання масиву entries; кожен entry має опціональне поле `message` із `role` (`'user' | 'assistant' | ...`) і `content`.
- `ui?: { notify?: (msg: string, level?: 'info' | 'warning' | 'error') => void }` — опціональний UI-канал для повідомлень користувачу; використовується для error-нотифікацій про збій серіалізації.

#### `PiExec`

Pi.dev extension API, що його runtime передає у default export:

- `exec(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; input?: string; signal?: AbortSignal; timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }>` — спавнить дочірній процес з опціями cwd/env/stdin/signal/timeout і повертає promise з кодом, stdout і stderr.
- `on(event: string, handler: (event: unknown, ctx: PiContext) => Promise<void> | void): void` — реєструє handler для pi-події (тут — `'agent_end'`).

### Константи-шляхи до хуків

- `CAPTURE_HOOK = '.claude/hooks/capture-decisions.sh'` — відносний шлях до bash-хука захоплення ADR-рішень.
- `NORMALIZE_HOOK = '.claude/hooks/normalize-decisions.sh'` — відносний шлях до bash-хука нормалізації ADR-чернеток через LLM.

Шляхи відносні і використовуються разом з `ctx.cwd` як параметром `cwd` у `pi.exec`.

## Функції

### `export default function (pi: PiExec): void`

**Сигнатура:** `(pi: PiExec) => void`.

**Параметри:**

- `pi: PiExec` — pi.dev extension API (див. інтерфейс `PiExec` вище).

**Що повертає:** `void`. Функція синхронно реєструє обробник через `pi.on('agent_end', ...)` і завершується.

**Side effects:**

1. Реєструє listener на подію `'agent_end'` через `pi.on`.
2. Решта side effects відбуваються асинхронно у listener'і `agent_end` (див. нижче).

### Inline listener `pi.on('agent_end', async (_event, ctx) => { ... })`

**Сигнатура:** `(_event: unknown, ctx: PiContext) => Promise<void>`.

**Параметри:**

- `_event: unknown` — payload події `agent_end`; не використовується (префікс `_` сигналізує умисне ігнорування).
- `ctx: PiContext` — контекст pi-сесії.

**Що повертає:** `Promise<void>`. Резолвиться після завершення `Promise.allSettled` з двох викликів `pi.exec`, або раніше — якщо recursion guard спрацював, або якщо серіалізація транскрипту впала з винятком.

**Покроковий алгоритм:**

1. **Recursion guard:**
   - Якщо `env.CAPTURE_DECISIONS_RUNNING` або `env.ADR_NORMALIZE_RUNNING` truthy — `return` без жодних дій. Ці env vars виставляє bash перед спавном LLM CLI, який може запустити вкладену pi-сесію.

2. **Серіалізація транскрипту (у блоці `try/catch`):**
   - Викликає `ctx.sessionManager.getEntries()` → масив entries.
   - Фільтрує entries, де `e.message?.role === 'user' || e.message?.role === 'assistant'`.
   - Map'ить кожен entry у JSON-рядок виду `{ type: <role>, message: <message> }` через `JSON.stringify`.
   - Об'єднує рядки через `'\n'`.
   - Генерує шлях `jsonlPath = join(tmpdir(), \`n-cursor-pi-transcript-${Date.now()}-${randomUUID()}.jsonl\`)`.
   - Пише файл `jsonlPath` через `writeFileSync(jsonlPath, lines + '\n', 'utf8')`.
   - У catch-блоці: викликає `ctx.ui?.notify?.(\`@nitra/cursor: transcript serialization failed — ${(error as Error).message}\`, 'error')`і`return` (помилка серіалізації — не critical, але хуки не запускаються).

3. **Підготовка stdin payload:**
   - `stdinPayload = JSON.stringify({ transcript_path: jsonlPath, session_id: ctx.sessionId ?? randomUUID() })`.

4. **Підготовка env override:**
   - `envOverride = { ...env, CLAUDE_PROJECT_DIR: ctx.cwd }` — копія поточного env з доданим/перевизначеним `CLAUDE_PROJECT_DIR`.

5. **Паралельний спавн bash-хуків через `Promise.allSettled`:**
   - `pi.exec('bash', [CAPTURE_HOOK], { cwd: ctx.cwd, env: envOverride, input: stdinPayload, signal: ctx.signal, timeout: 180_000 })` — capture-хук, таймаут 180 секунд (180_000 мс).
   - `pi.exec('bash', [NORMALIZE_HOOK], { cwd: ctx.cwd, env: envOverride, input: stdinPayload, signal: ctx.signal, timeout: 600_000 })` — normalize-хук, таймаут 600 секунд (600_000 мс).
   - `Promise.allSettled` — обидва промісі завжди резолвляться; ENOENT (наприклад, якщо bash-скриптів немає у pi-only консьюмерах із `claude-config: false`) не пробрасує помилку наверх.

**Side effects:**

- Запис файлу в `os.tmpdir()` через `writeFileSync` (синхронно, всередині async-функції).
- Можливий виклик `ctx.ui?.notify?.` з рівнем `'error'` при збої серіалізації.
- Два дочірні процеси `bash` через `pi.exec` (capture + normalize).
- Передача транскрипту і session id у bash через stdin.
- Перевизначення env var `CLAUDE_PROJECT_DIR` у child-процесах.
- Жодного запису у файли проєкту з самого TS — усі такі операції делеговано bash-скриптам.

## Залежності

### Node.js built-in модулі

- `node:crypto` — імпорт `randomUUID` для генерації унікальної частини імені JSONL-файлу та для fallback session id (`ctx.sessionId ?? randomUUID()`).
- `node:fs` — імпорт `writeFileSync` для синхронного запису JSONL у tmpdir.
- `node:os` — імпорт `tmpdir` для отримання шляху до системної тимчасової теки.
- `node:path` — імпорт `join` для побудови абсолютного шляху до JSONL-файлу.
- `node:process` — імпорт `env` для читання env vars (`CAPTURE_DECISIONS_RUNNING`, `ADR_NORMALIZE_RUNNING`) і успадкування у `envOverride`.

### Зовнішні залежності (runtime)

- **Pi.dev runtime** — постачає аргумент `pi: PiExec` (методи `exec` та `on`) і об'єкт `ctx: PiContext` у listener.
- **Bash-скрипти проєкту:**
  - `.claude/hooks/capture-decisions.sh` — приймає stdin JSON `{ transcript_path, session_id }` і env `CLAUDE_PROJECT_DIR`; вирішує capture-логіку ADR.
  - `.claude/hooks/normalize-decisions.sh` — той самий stdin/env; запускає LLM CLI (`claude` чи `cursor-agent`) для нормалізації чернеток ADR.
- **Env vars контракту з bash:**
  - `CAPTURE_DECISIONS_RUNNING`, `ADR_NORMALIZE_RUNNING` — виставляються bash перед спавном LLM CLI; служать як recursion guard для вкладеного pi-trigger.
  - `CLAUDE_PROJECT_DIR` — встановлюється у `ctx.cwd` для bash-хуків.

### TypeScript-залежності

- TypeScript-інтерфейси `PiContext` і `PiExec` — локально оголошені, не імпортовані з зовнішніх типів.
- Жодних NPM-пакетів runtime не імпортується.

## Потік виконання / Використання

### Реєстрація розширення

Pi.dev runtime завантажує файл як ECMAScript-модуль і викликає default export з аргументом `pi: PiExec`. Default export реєструє один listener:

```
pi.on('agent_end', listener)
```

Після реєстрації функція повертає `void`. Сам listener виконується пізніше — на кожну подію `agent_end`.

### Тригер події `agent_end`

Pi-runtime емітує `agent_end`, коли агент завершує сесію. Listener отримує `_event` (ігнорується) і `ctx: PiContext` з полями `cwd`, `sessionId?`, `signal?`, `sessionManager`, `ui?`.

### Гілка recursion guard

Якщо у поточному env-проміжку є truthy `CAPTURE_DECISIONS_RUNNING` або `ADR_NORMALIZE_RUNNING` — listener виходить негайно без запису транскрипту і без спавну хуків. Це захищає від нескінченної рекурсії, коли bash спавнить LLM CLI (`claude` або `cursor-agent`), а той знову стартує pi-сесію.

### Гілка нормальної обробки

1. Виклик `ctx.sessionManager.getEntries()` повертає масив entries сесії.
2. Фільтр залишає лише entries з `role` = `'user'` або `'assistant'`.
3. Map створює JSONL-рядки `{ "type": "<role>", "message": <message> }`.
4. Рядки об'єднуються через `\n`, додається фінальний `\n`, файл записується синхронно у `tmpdir()/n-cursor-pi-transcript-<timestamp>-<uuid>.jsonl`.
5. Якщо серіалізація кинула виняток — `ctx.ui?.notify?.` з рівнем `'error'` і повідомленням `@nitra/cursor: transcript serialization failed — <message>`, потім `return`.
6. Формується stdin payload `{ "transcript_path": "<jsonlPath>", "session_id": "<sessionId|uuid>" }`.
7. Створюється `envOverride = { ...env, CLAUDE_PROJECT_DIR: ctx.cwd }`.
8. Через `Promise.allSettled` паралельно запускаються:
   - `bash .claude/hooks/capture-decisions.sh` з cwd=`ctx.cwd`, env=`envOverride`, stdin=`stdinPayload`, signal=`ctx.signal`, timeout=180 секунд.
   - `bash .claude/hooks/normalize-decisions.sh` з тими ж параметрами і timeout=600 секунд.
9. `Promise.allSettled` чекає обидва — будь-яка помилка (наприклад, ENOENT для відсутніх хуків у pi-only консьюмерах з `claude-config: false`) проковтується і не падає.
10. Listener резолвиться, pi-runtime продовжує обробку події.

### Контракт з bash

- Бізнес-логіка skip/throttle, мін-інтервалів і вибору LLM CLI (`claude` чи `cursor-agent`) — повністю у `.claude/hooks/capture-decisions.sh` і `.claude/hooks/normalize-decisions.sh`.
- TS-розширення `npm/.pi-template/extensions/n-cursor-adr/index.ts` є **тонким адаптером** pi → bash і не дублює жодної бізнес-логіки.
- Recursion guard через `env.CAPTURE_DECISIONS_RUNNING` і `env.ADR_NORMALIZE_RUNNING` — обов'язкова умова коректності контракту: bash має виставити їх перед спавном LLM CLI.

### Сценарій pi-only консьюмера

Якщо консьюмер pi-template має `claude-config: false` і bash-скриптів `.claude/hooks/capture-decisions.sh` / `.claude/hooks/normalize-decisions.sh` фізично немає — `pi.exec` повертає ENOENT, але `Promise.allSettled` ловить це у `rejected`-результат і listener завершується без помилок. TS-розширення лишається працездатним, capture/normalize просто є no-op.
