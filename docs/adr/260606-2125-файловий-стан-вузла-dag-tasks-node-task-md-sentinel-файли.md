---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-06T21:25:08+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Файловий стан вузла DAG (`tasks/<node>/task.md` + sentinel-файли)

## Context and Problem Statement
Нова архітектура `n-cursor graph` (з `docs/думка.MD`) потребує механізму зберігання стану кожного вузла DAG без центральної бази даних — щоб кілька ізольованих ворктрі могли паралельно читати і писати стан, не конфліктуючи.

## Considered Options
* Файловий стан: наявність/відсутність `task.md`, `run_NNN.md`, `outputs_NNN.md`, `invalidated` у директорії `tasks/<node>/` деривує стан вузла
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Файловий стан через sentinel-файли", because архітектура `docs/думка.MD` явно визначає стан через присутність файлів: `waiting` (лише `task.md`), `running` (активний ворктрі), `resolved` (`outputs_NNN.md` існує), `failed` (`run_NNN.md` без `outputs_NNN.md`), `invalidated` (sentinel `invalidated`).

### Consequences
* Good, because transcript фіксує очікувану користь: ізольовані ворктрі читають стан без координуючого процесу; реалізація `state.mjs` — чисті функції без мутацій, 28 тестів пройшли.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: `npm/scripts/graph/state.mjs` (відкочено). Функції `deriveNodeState`, `latestNumbered`, `nextNumbered`, `sanitizePathToWorktreePrefix`. Тести: `npm/scripts/graph/tests/state.test.mjs`. Команда `graph status` виводить: `○ waiting`, `◉ running`, `✓ resolved`, `✗ failed`, `⊘ invalidated`.

---

## ADR Паралельний модуль `npm/scripts/graph/` поряд зі старою `dispatcher/graph.mjs`

## Context and Problem Statement
Існуюча `dispatcher/graph.mjs` реалізує read-only перегляд `docs/graphs/<g>/nodes/*.md` (стара spec). Нова архітектура `думка.MD` потребує autonomous task orchestration на основі `tasks/<node>/task.md`. Обидва інтерфейси — `n-cursor graph`.

## Considered Options
* Паралельна реалізація: нова логіка в `npm/scripts/graph/`, стара перейменована на `graph-dag` через CLI routing
* Пряма заміна: видалити `dispatcher/graph.mjs`, переписати під нову spec
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Паралельна реалізація", because реалізація показала: 13 тестів старої `dispatcher/graph.mjs` залишаються зеленими; нова система ізольована в `npm/scripts/graph/`; CLI routing `case 'graph'` → нова система, `case 'graph-dag'` → legacy.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun vitest run scripts/dispatcher/tests/` — 42 тести passed (3 файли) після додавання нової системи.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
CLI dispatch (`npm/bin/n-cursor.js` ліній ~1770–1790): `case 'graph'` → `scripts/graph/index.mjs`; `case 'graph-dag'` → `scripts/dispatcher/graph.mjs`; `case 'watch'` → `scripts/graph/watch.mjs`. Зміни відкочено після сесії за запитом користувача.

---

## ADR Sentinel-файл `.ncursor-signal` для комунікації агент→wrapper

## Context and Problem Statement
У режимі `graph run` wrapper-процес запускає claude CLI в ізольованому ворктрі. Агент сигналізує про результат (успіх, провал, запит аудиту, декомпозиція в підзадачі) до завершення свого процесу — wrapper повинен знати, яку дію виконати після `exit`.

## Considered Options
* Sentinel-файл: команди `graph done/failed/spawn/audit` пишуть `.ncursor-signal` у директорію вузла перед `exit`; wrapper читає файл після завершення процесу
* Exit codes: різні exit codes для різних сигналів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Sentinel-файл `.ncursor-signal`", because файловий підхід природно узгоджується з файловою моделлю стану DAG; wrapper читає сигнал асинхронно після завершення процесу; агент не залежить від реалізації wrapper-у.

### Consequences
* Good, because transcript фіксує очікувану користь: `signals.mjs` реалізує чотири команди (`done`, `audit`, `failed`, `spawn`) через єдиний механізм файлу.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Реалізація: `npm/scripts/graph/signals.mjs` (відкочено). Формат файлу: `type: done|audit|failed|spawn`. `run.mjs` читає файл після завершення процесу, видаляє sentinel, виконує відповідну дію (merge, spawn auditor, write run record).

---

## ADR Відкат реалізації та перехід до ітеративного проектування

## Context and Problem Statement
Після повної реалізації нової системи `n-cursor graph` (10+ файлів, 28 нових тестів, CLI routing) користувач вирішив відкотити всі зміни і перейти до ітеративної дискусії перед наступною імплементацією.

## Considered Options
* Ітеративне проектування: спочатку обговорити архітектурні рішення, потім поетапно реалізовувати
* Пряма реалізація за наявною spec (обрано спочатку)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Ітеративне проектування", because `git checkout -- npm/bin/n-cursor.js && rm -rf npm/scripts/graph/` — явний відкат після повної реалізації; transcript закінчується запитом "давай ітеративно дискусію для побудування одруження".

### Consequences
* Good, because transcript фіксує очікувану користь: менший ризик впровадити архітектуру, яка не відповідає потребам після глибшого обговорення.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Відкочені зміни: `npm/bin/n-cursor.js` (`git checkout --`), `npm/scripts/graph/` (`rm -rf`), `.changes/260606-2107.md` (`rm -f`). Зміни до сесії (решта `M`-файлів) залишилися недоторканими.
