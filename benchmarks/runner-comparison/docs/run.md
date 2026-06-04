# run.mjs

## Огляд

Файл `benchmarks/runner-comparison/run.mjs` — це виконуваний spike-бенчмарк, який вимірює тривалість прогону Stryker (mutation testing) для двох різних конфігурацій test-runner-ів (`bun` vs `vitest`) і, за бажанням, окремо запускає incremental-сценарій (другий прогін `vitest` без змін у коді). Скрипт працює як CLI під `bun`/`node` (shebang `#!/usr/bin/env bun`), запускає `bunx stryker run <config>` у директорії `demo`, парсить отриманий `mutation.json`-репорт, рахує mutation score та зводить результати трьох сценаріїв у Markdown-файл `SPIKE.md` поряд зі скриптом, а також у per-run `.log`/`.json` файли в теці `results/`.

Скрипт є top-level ES-module з імперативним кодом «на верхньому рівні» (немає експортів), приймає прапорець `--scenario=<name>`, виходить з кодом `2` при невідомому імені сценарію та продовжує до наступного сценарію (без виходу) при невдалому виконанні Stryker.

Підтримувані сценарії:

- `full-bun` — повний прогін Stryker із конфігом `stryker.bun.config.mjs` і `testRunner` із цього конфігу.
- `full-vitest` — повний прогін Stryker із конфігом `stryker.vitest.config.mjs` і `testRunner` із цього конфігу.
- `incremental-vitest-noop` — другий запуск `stryker.vitest.config.mjs` без чищення `reports/` (вимірює incremental-режим у no-op-варіанті).

## Експорти / API

Файл нічого не експортує (`export ...` відсутні) — це CLI-скрипт із побічними ефектами. «Публічний API» виражений через CLI-аргументи та артефакти.

### CLI-інтерфейс

- Без аргументів: запускає всі три сценарії послідовно у порядку `full-bun`, `full-vitest`, `incremental-vitest-noop`.
- `--scenario=full-bun` — запустити лише сценарій `full-bun`.
- `--scenario=full-vitest` — запустити лише сценарій `full-vitest`.
- `--scenario=incremental-vitest-noop` — запустити лише сценарій `incremental-vitest-noop`.
- Будь-яке інше значення `--scenario=<name>` — вивести `Unknown scenario: <name>` у `stderr` і вийти з кодом `2`.

### Артефакти, які створює `run.mjs`

- `benchmarks/runner-comparison/results/<scenario>-<ISO-timestamp>.log` — повний `stdout` + `STDERR`-роздільник + `stderr` процесу Stryker.
- `benchmarks/runner-comparison/results/<scenario>-<ISO-timestamp>.json` — структура `result` (див. розділ «Функції»).
- `benchmarks/runner-comparison/SPIKE.md` — зведений Markdown-звіт з табличкою та критеріями рішення.

ISO-timestamp формується з `new Date().toISOString()` із заміною всіх `:` і `.` на `-`.

## Функції

`run.mjs` не оголошує жодних `function` чи `class`. У файлі є дві локальні стрілкові функції на верхньому рівні, які використовуються лише при генерації фінального Markdown-звіту:

### `speedup(s)`

- Сигнатура: `const speedup = s => ...`
- Параметри:
  - `s` — об'єкт результату сценарію (`{ scenario, durationMs, ... }`) або `undefined`.
- Повертає: `string` — рядок виду `"N.NN×"` із співвідношенням `baseline / s.durationMs`, де `baseline = bunFull?.durationMs ?? null` (час `full-bun`). Якщо `baseline` хибне або `s.durationMs` хибне — повертає `'n/a'`.
- Side effects: немає (pure).

### `fmt(s)`

- Сигнатура: `const fmt = s => ...`
- Параметри:
  - `s` — об'єкт результату сценарію або `undefined`.
- Повертає: `string` — один рядок Markdown-таблиці. Якщо `s.error` істинне — формат `| <scenario> | — | ERROR (<error>) | — | — |`. Інакше — `| <scenario> | <totalMutants|—> | <durationMs/1000 з 1 десятковим>s | <score|—>% | <speedup(s)> |`.
- Side effects: немає (pure); читає замикання `speedup`.

### Імперативна логіка верхнього рівня (псевдо-«функція `main`»)

Хоча `main`-обгортки немає, основний потік на верхньому рівні має чітку послідовність. Опис ефектів:

1. Обчислює константи шляхів: `HERE`, `DEMO`, `RESULTS`, `REPORTS`.
2. Формує мапу `SCENARIOS` зі статичних імпортів `bunStrykerConfig`, `vitestStrykerConfig`, `vitestConfig`.
3. Парсить `process.argv.slice(2)`: шукає аргумент із префіксом `--scenario=`, бере його значення (`split('=')[1]`).
4. Формує робочий список `list`: або `[scenarioArg]`, або повний порядок `['full-bun', 'full-vitest', 'incremental-vitest-noop']`.
5. `mkdirSync(RESULTS, { recursive: true })` — гарантує наявність теки `results/`.
6. Ініціалізує `summary = []`.
7. Для кожного `name` зі списку `list` виконує блок «один сценарій» (див. нижче).
8. Після циклу формує `bunFull`, `vitFull`, `vitNoop`, `baseline = bunFull?.durationMs ?? null` і будує Markdown-звіт у `md` (масив рядків, що зливається через `'\n'`).
9. `writeFileSync(join(HERE, 'SPIKE.md'), md)` і виводить `→ SPIKE.md updated`.

#### Блок «один сценарій»

Для поточного `name`:

1. `cfg = SCENARIOS[name]`; якщо `cfg` відсутній — `console.error('Unknown scenario: <name>')`, `process.exit(2)` (миттєвий вихід, наступні сценарії не виконуються).
2. Якщо `cfg.cleanReports === true` і `REPORTS` існує — `rmSync(REPORTS, { recursive: true, force: true })`. Для `incremental-vitest-noop` чищення не відбувається — це принципово (incremental спирається на попередній `incremental-vitest.json`).
3. Якщо у `summary` вже є щонайменше один запис (тобто це не перший сценарій у поточному прогоні) — `await sleep(2000)` (`setTimeout` з `node:timers/promises`).
4. Друкує `\n=== <name> ===`.
5. Формує `ts = new Date().toISOString().replaceAll(/[:.]/g, '-')`.
6. Формує `logPath = <RESULTS>/<name>-<ts>.log`.
7. `t0 = performance.now()`.
8. `proc = spawnSync('bunx', ['stryker', 'run', cfg.config], { cwd: DEMO, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } })`.
9. `durationMs = Math.round(performance.now() - t0)`.
10. `writeFileSync(logPath, (proc.stdout ?? '') + '\n---STDERR---\n' + (proc.stderr ?? ''))`.
11. Якщо `proc.status !== 0` — друкує `✗ <name>: stryker exit <status>, log: <logPath>` у `stderr`, додає до `summary` `{ scenario: name, durationMs, error: 'exit <status>', logPath }` і робить `continue` (на наступний сценарій).
12. `mutationPath = <REPORTS>/stryker/mutation.json`; якщо файл відсутній — друкує `✗ <name>: no mutation.json at <mutationPath>` у `stderr`, додає `{ scenario, durationMs, error: 'no mutation.json', logPath }` і `continue`.
13. `report = JSON.parse(readFileSync(mutationPath, 'utf8'))`.
14. Підрахунок мутантів: ініціалізує `killed = 0, noCoverage = 0, survived = 0, timeout = 0`. Для кожного `file` у `Object.values(report.files ?? {})` і кожного `m` у `file.mutants ?? []` `switch (m.status)` інкрементує відповідний лічильник для `'Killed'`, `'Survived'`, `'Timeout'`, `'NoCoverage'`. Інші статуси (`'Pending'`, `'CompileError'`, `'Ignored'`, `'RuntimeError'`) ігноруються (коментар `// No default`).
15. `total = killed + survived + timeout + noCoverage`.
16. `score = total > 0 ? Math.round((1000 * (killed + timeout)) / total) / 10 : 0` — десяткові частки відсотка (одна цифра після коми).
17. Збирає `result` (див. структуру нижче), записує `<RESULTS>/<name>-<ts>.json` через `JSON.stringify(result, null, 2)`.
18. Друкує `✓ <name>: <durationMs>ms, <total> mutants, score <score>%`.
19. `summary.push(result)`.

#### Структура `result` (запис у JSON-файл і `summary`)

- `scenario: string` — `name` сценарію.
- `durationMs: number` — час прогону Stryker у мілісекундах (округлено).
- `testRunner: string` — `cfg.testRunner` із відповідного Stryker-config-файлу.
- `totalMutants: number` — сума `killed + survived + timeout + noCoverage`.
- `killed: number`.
- `survived: number`.
- `timeout: number`.
- `noCoverage: number`.
- `score: number` — mutation score у відсотках із одним знаком після коми, формула `(killed + timeout) / total × 100`.
- `versions.node: string` — `process.versions.node`.
- `versions.bun: string | null` — `process.versions.bun ?? null`.
- `logPath: string` — абсолютний шлях до `.log`-файлу.

Для гілки помилки запис у `summary` має поля `scenario`, `durationMs`, `error`, `logPath` (без `testRunner`, `totalMutants`, лічильників, `score`, `versions`).

#### Markdown-звіт `SPIKE.md`

Формується через `[...].join('\n')` як одна рядкова конкатенація. Структура:

- Заголовок `# Vitest Runner Spike — Results`.
- Рядок `Generated: <ISO-now>`.
- Секція `## Numbers` із Markdown-таблицею `| Сценарій | Мутантів | Час | Score | Speedup vs full-bun |`. Три рядки таблиці формує `fmt(bunFull)`, `fmt(vitFull)`, `fmt(vitNoop)` (порядок фіксований; для відсутнього сценарію `fmt(undefined)` дає `| undefined | — | 0.0s | — | n/a |`, бо optional-chaining `s?.scenario` тут не використано в гілці без error).
- Секція `## Environment` із bullet-списком `Node: <version>` і `Bun: <version|n/a>`.
- Секція `## Decision criteria` — три bullet-и з критеріями (`Strong win`, `Marginal`, `No win`) щодо співвідношень часів `full-vitest`, `full-bun`, `incremental-noop`.
- Секція `## Reproduce` — fenced-блок `bash` із командою `cd benchmarks/runner-comparison && bun run.mjs`.

## Залежності

### Node.js / Bun built-ins

- `node:console` — `console.log`, `console.error`.
- `node:child_process` — `spawnSync` (синхронний запуск `bunx stryker run ...`).
- `node:perf_hooks` — `performance.now()` для вимірювання тривалості.
- `node:process` — `process.argv`, `process.env`, `process.exit`, `process.versions.node`, `process.versions.bun`.
- `node:timers/promises` — `setTimeout as sleep` для `await sleep(2000)` між сценаріями.
- `node:fs` — `existsSync`, `mkdirSync`, `readFileSync`, `rmSync`, `writeFileSync`.
- `node:path` — `dirname`, `join`.
- `node:url` — `fileURLToPath` для обчислення `HERE` із `import.meta.url`.

### Локальні модулі (ESM-імпорти за відносним шляхом)

- `./demo/stryker.bun.config.mjs` як default-імпорт `bunStrykerConfig` — потрібне поле `bunStrykerConfig.testRunner`.
- `./demo/stryker.vitest.config.mjs` як default-імпорт `vitestStrykerConfig` — потрібне поле `vitestStrykerConfig.testRunner`.
- `./demo/vitest.config.js` як default-імпорт `vitestConfig` — використовується `vitestConfig.test.environment` для сценаріїв `full-vitest` і `incremental-vitest-noop` (але далі в `result` це поле НЕ потрапляє — воно лише зчитується у `SCENARIOS`-мапу як `vitestEnvironment`, але в фінальний JSON/Markdown не записується).

### Зовнішні CLI

- `bunx` (із Bun runtime) — використовується як ім'я бінарного файлу у `spawnSync`. Якщо `bunx` недоступний у `PATH`, `spawnSync` поверне ненульовий `status` або помилку, і сценарій буде записаний як `error`.
- `stryker` — викликається через `bunx stryker run <config>` із `cwd: DEMO`.

### Очікувані файли в `demo/`

- `demo/stryker.bun.config.mjs`, `demo/stryker.vitest.config.mjs`, `demo/vitest.config.js` — імпортуються як ESM-модулі (мають бути валідні default-експорти).
- `demo/reports/stryker/mutation.json` — створюється самим Stryker-ом після успішного прогону; `run.mjs` його лише читає.

## Потік виконання / Використання

### Швидкий старт

```bash
cd benchmarks/runner-comparison
bun run.mjs                                # усі 3 сценарії
bun run.mjs --scenario=full-bun            # лише full-bun
bun run.mjs --scenario=full-vitest         # лише full-vitest
bun run.mjs --scenario=incremental-vitest-noop  # лише incremental-noop
```

### Покроковий потік (повний прогін без аргументів)

1. `mkdir -p results/` (через `mkdirSync(RESULTS, { recursive: true })`).
2. Сценарій `full-bun`:
   - `rm -rf demo/reports/` (бо `cleanReports: true`).
   - `bunx stryker run stryker.bun.config.mjs` у `demo/` із `FORCE_COLOR=0`.
   - Збір метрик, запис `results/full-bun-<ts>.log` і `results/full-bun-<ts>.json`.
3. `await sleep(2000)` (бо `summary.length > 0`).
4. Сценарій `full-vitest`:
   - `rm -rf demo/reports/` (бо `cleanReports: true`).
   - `bunx stryker run stryker.vitest.config.mjs` у `demo/`.
   - Збір метрик, запис `results/full-vitest-<ts>.log` і `results/full-vitest-<ts>.json`.
5. `await sleep(2000)`.
6. Сценарій `incremental-vitest-noop`:
   - НЕ чистить `demo/reports/` (бо `cleanReports: false`) — це дозволяє Stryker-у з конфігом `stryker.vitest.config.mjs` використати наявний `incremental-vitest.json` і виміряти incremental-режим (другий запуск без змін у коді).
   - `bunx stryker run stryker.vitest.config.mjs` у `demo/`.
   - Збір метрик, запис `results/incremental-vitest-noop-<ts>.log` і `.json`.
7. Формування `SPIKE.md` із трьома рядками таблиці, секціями `Environment`, `Decision criteria`, `Reproduce`.

### Критерії рішення (із згенерованого `SPIKE.md`)

- **Strong win** (рекомендовано міграцію на vitest-runner): `full-vitest ≤ 0.5 × full-bun` AND `incremental-noop ≤ 0.1 × full-vitest`.
- **Marginal**: співвідношення `full-vitest / full-bun` у діапазоні `0.5×–0.8×` — потрібен додатковий сценарій `touch-1-source`.
- **No win**: `> 0.8×` — міграція не виконується.

### Поведінка при помилках

- `spawnSync` повернув `status !== 0` — пишеться `.log`, у `summary` потрапляє запис із полем `error: 'exit <status>'`, цикл продовжується наступним сценарієм. У `SPIKE.md` `fmt(s)` віддає рядок `| <scenario> | — | ERROR (exit <N>) | — | — |`.
- `mutation.json` не з'явився — у `summary` потрапляє запис `error: 'no mutation.json'`, формат у `SPIKE.md` аналогічний.
- Невідоме ім'я сценарію через `--scenario=<bad>` — миттєвий `process.exit(2)` без формування `SPIKE.md` і без записів у `summary`.
- Помилки `JSON.parse(...)` для `mutation.json` НЕ оброблені — кинуть exception, який перерве весь скрипт (необроблено).
- Помилки `readFileSync`/`writeFileSync` НЕ оброблені — кинуть exception, що зупинить скрипт.

### Side effects (повний перелік)

- Створення теки `benchmarks/runner-comparison/results/` (рекурсивно).
- Видалення теки `benchmarks/runner-comparison/demo/reports/` (для сценаріїв з `cleanReports: true`).
- Породження дочірнього процесу `bunx stryker run <config>` у `benchmarks/runner-comparison/demo/`.
- Запис файлів: `results/<scenario>-<ts>.log`, `results/<scenario>-<ts>.json`, `SPIKE.md`.
- Виведення у `stdout`: рядки `=== <name> ===`, `✓ <name>: ...`, `→ SPIKE.md updated`.
- Виведення у `stderr`: `Unknown scenario: ...`, `✗ <name>: ...`.
- Зміна `process.env` дочірнього процесу: `FORCE_COLOR=0` (тільки для дочірнього `spawnSync`-процесу, не для самого `run.mjs`).
- Завершення процесу: `process.exit(2)` при невідомому сценарії; інакше — нормальний вихід після завершення top-level `await`.

### Параметри середовища, які впливають на виконання

- `PATH` — має містити `bunx` (Bun) і `stryker` (через `bunx`).
- Файли `demo/stryker.bun.config.mjs`, `demo/stryker.vitest.config.mjs`, `demo/vitest.config.js` мають існувати та бути валідними ESM-модулями.
- Для сценарію `incremental-vitest-noop` має існувати файл `demo/<incrementalFile>` (наприклад `demo/incremental-vitest.json`), створений попереднім прогоном `full-vitest`; інакше Stryker виконає повний прогон і метрики `incremental-noop` будуть некоректні. У самому коді `run.mjs` поле `incrementalFile` тільки декларується в `SCENARIOS`, але далі не використовується — наявність incremental-файлу залежить виключно від конфігу Stryker і чи був попередньо запущений `full-vitest`.
