---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-06T21:08:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Нова система task orchestration DAG в `npm/scripts/graph/`

## Context and Problem Statement

Існуючий `npm/scripts/dispatcher/graph.mjs` — read-only прототип, що сканує `docs/graphs/<g>/nodes/*.md` та деривує статус з artifact-файлів (plan/claim/fact/ask/ans). Документ `docs/думка.MD` описує принципово іншу архітектуру: рекурсивний ОАГ задач на основі `tasks/<node>/task.md` з автономним виконанням агентами, worktree-ізоляцією та lifecycle через сигнальні файли.

## Considered Options

* Розширити існуючий `dispatcher/graph.mjs` з backward-compat шаром для нового формату
* Створити окремий модуль `npm/scripts/graph/` і залишити старий `dispatcher/graph.mjs` незайманим

## Decision Outcome

Chosen option: "Створити окремий модуль `npm/scripts/graph/`", because архітектури несумісні на рівні file layout і state machine: старий формат читає `docs/graphs/` з artifact-типами, новий — `tasks/` з присутністю sentinel-файлів; заміна зламала б існуючі 13 тестів `dispatcher/tests/graph.test.mjs` без жодної практичної користі.

### Consequences

* Good, because старі 42 тести `dispatcher/tests/` залишились зеленими (3 файли, 42 тести).
* Good, because нова система отримала ізольований простір для нових тестів (`graph/tests/state.test.mjs`, 28 тестів).
* Bad, because `n-cursor graph` тепер фактично має дві реалізації під різними route-ами — потенційна плутанина до видалення legacy `dispatcher/graph.mjs`.

## More Information

Нові файли: `npm/scripts/graph/config.mjs`, `state.mjs`, `scan.mjs`, `setup.mjs`, `init.mjs`, `invalidate.mjs`, `signals.mjs`, `run.mjs`, `kill.mjs`, `watch.mjs`, `index.mjs`, `tests/state.test.mjs`.

CLI routing: `npm/bin/n-cursor.js` — `case 'graph'` тепер імпортує `../scripts/graph/index.mjs`; доданий `case 'watch'` → `../scripts/graph/watch.mjs`.

---

## ADR Стан вузла деривується з присутності файлів (sentinel-based state machine)

## Context and Problem Statement

Для autonomous DAG потрібен механізм збереження стану вузлів між незалежними процесами (wrapper, агент, CLI, watch). Стан має бути читабельним без окремого daemon або lock-файлу.

## Considered Options

* Центральний JSON-стейт файл (`.n-cursor/state.json`)
* Sentinel-файли у директорії вузла (присутність файлів = стан)

## Decision Outcome

Chosen option: "Sentinel-файли у директорії вузла", because кожен вузол самодостатній — стан деривується з того, які файли існують у `tasks/<node>/`: лише `task.md` → `waiting`; є `run_NNN.md` без `outputs_NNN.md` і активний worktree → `running`; є `outputs_NNN.md` → `resolved`; є `invalidated` → `invalidated`; є `run_NNN.md` без виходу і без worktree → `failed`.

### Consequences

* Good, because transcript фіксує очікувану користь: `graph status` і `graph scan` не потребують daemon і атомарно читаються будь-яким процесом.
* Good, because агент може перевірити власний стан через звичайний `ls` або `existsSync`.
* Bad, because race condition між записом `outputs_NNN.md` і видаленням worktree потенційно може дати хибний `running` стан — transcript не містить підтвердженого вирішення цієї проблеми.

## More Information

Реалізація: `npm/scripts/graph/state.mjs` — функції `deriveState(nodeDir, worktrees)`, `sanitizePathToWorktreePrefix(rel)`, `findLatestFile(dir, prefix)`, `nextFilename(dir, prefix, ext)`. Сигнальні файли агента: `npm/scripts/graph/signals.mjs` — `graph done <path>`, `graph audit <path>`, `graph failed <path>`, `graph spawn <path>` пишуть `.signal` в директорію вузла, wrapper читає після завершення процесу.

---

## ADR `n-cursor watch` — окрема top-level команда замість підкоманди `graph`

## Context and Problem Statement

Watchdog-моніторинг (stale worktrees, post-merge trigger, auto-run) потребує окремого entrypoint, що запускається як post-merge hook (`git commit` → merge → `n-cursor watch`), а не через `n-cursor graph watch`.

## Considered Options

* `n-cursor graph watch` — підкоманда існуючої `graph` групи
* `n-cursor watch` — самостійна top-level команда

## Decision Outcome

Chosen option: "`n-cursor watch`", because post-merge hook пише коротку команду без підкоманди, і це відповідає патерну інших daemon-подібних команд (`n-cursor fix`, `n-cursor flow`); архітектура думка.MD явно виділяє `watch` окремо від `graph`.

### Consequences

* Good, because transcript фіксує очікувану користь: hook записується як `n-cursor watch` без аргументів, що мінімізує помилки конфігурації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

CLI routing: `npm/bin/n-cursor.js` — доданий `case 'watch'` → `import('../scripts/graph/watch.mjs')`. Hook встановлюється командою `n-cursor graph setup` у `.git/hooks/post-merge`. Файл реалізації: `npm/scripts/graph/watch.mjs`.
