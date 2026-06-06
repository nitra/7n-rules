---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T14:06:44+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Файловий формат вузлів — LLM-first Markdown з YAML-фронтматером

## Context and Problem Statement
Кожен вузол графу задач зберігає свій стан у файловій системі. Потрібно обрати формат файлів, зручний і для скриптів-оркестраторів, і для LLM-агентів що читають і записують ці файли.

## Considered Options
* JSON для всіх файлів стану
* Markdown з YAML-фронтматером (LLM-first)

## Decision Outcome
Chosen option: "Markdown з YAML-фронтматером", because LLM-агент читає Markdown природно і може продовжувати запис без парсингу, а фронтматер надає машинозчитувані поля для скрипту-оркестратора. Окремо зафіксовано правило розподілу: атрибути YAML-фронтматеру та заголовки секцій що парсить скрипт — англійські; секції з довільними даними — будь-яка мова.

### Consequences
* Good, because transcript фіксує очікувану користь: `repair_history.md` як append-only журнал — агент просто читає і дописує, без реконструкції контексту з JSON-масиву.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли вузла: `task.md`, `outputs.md`, `error.md`, `repair_history.md`. Директорії: `subgraph/`, `ops/`, `patches/`. Поле `created_at` (ISO 8601) — перше поле фронтматеру у всіх файлах без винятку. Всі імена файлів і директорій — англійська (зафіксовано в контракті у `docs/думка.MD`).

---

## ADR Append-only інваріант з межею git-worktree

## Context and Problem Statement
При паралельному виконанні вузлів у різних git-worktree виникає ризик race condition: агент може записати `outputs.md` одночасно з тим як інженер скасовує вузол. Потрібен механізм атомарності без блокувань.

## Considered Options
* Атомарний `rename` + перевірка sentinel-файлу скасування
* Git-worktree як межа атомарності: append-only після створення worktree

## Decision Outcome
Chosen option: "Git-worktree як межа атомарності", because ворктрі є природною ізоляцією: наступники не стартують поки ворктрі не змерджено, а інженер опрацьовує стан при merge. До створення ворктрі файли вузла можна вільно редагувати або видаляти; після — тільки нові файли, нічого не змінюється.

### Consequences
* Good, because transcript фіксує очікувану користь: race condition і проблема "атомарності запису" закриваються архітектурно, без додаткових механізмів блокування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Правило: `немає worktree → редагуй вільно; є worktree → kill worktree → редагуй вільно → restart`. Зафіксовано в `docs/думка.MD` у розділі "Інваріант незмінності".

---

## ADR Топологія графу — розподілена у `task.md` кожного дочірнього вузла

## Context and Problem Statement
Граф задач динамічно розкладається агентами під час виконання. Потрібно вирішити де зберігати ребра підграфу щоб оркестратор міг відновити повну топологію і щоб динамічний spawn (додавання нових вузлів під час виконання) не вимагав оновлення центрального файлу.

## Considered Options
* Центральний файл `graph.md` у батьківському вузлі
* Топологія розподілена: кожен дочірній вузол у своєму `task.md` зберігає поле `deps:` з посиланнями на попередників-siblings

## Decision Outcome
Chosen option: "Топологія розподілена у `task.md`", because це забезпечує універсальність: динамічний spawn = просто новий дочірній з `deps:`, без оновлення жодного центрального файлу. Оркестратор відновлює повний граф скануванням всіх `task.md` у `subgraph/`.

### Consequences
* Good, because transcript фіксує очікувану користь: динамічний spawn не порушує append-only інваріант — новий файл, нічого не змінюється.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поле `deps:` у `task.md` містить тільки `id` siblings (відносні, без шляху), оскільки всі залежності завжди в межах одного `subgraph/`. Поле `parent:` — відносний шлях від `tasks/`. Поле `id` вилучено з фронтматеру — читається з імені директорії. Зафіксовано в `docs/думка.MD`.

---

## ADR Патерн plan → action → fact як універсальний WAL

## Context and Problem Statement
При збої агента або скрипту між операціями (наприклад kill залежних → patch вузла) система може опинитись у невалідному стані без можливості відновлення. Потрібен механізм відновлення після будь-якого збою.

## Considered Options
* Атомарні транзакції через lock-файли
* Write-ahead log через файлову пару `*-plan.md` / `*-fact.md`

## Decision Outcome
Chosen option: "Write-ahead log через файлову пару `*-plan.md` / `*-fact.md`", because будь-яка операція (spawn, kill, patch) спочатку записує намір у `*-plan.md`, виконує дію, потім фіксує результат у `*-fact.md`. Наявність `*-plan.md` без відповідного `*-fact.md` = незавершена операція, яку потрібно відновити.

### Consequences
* Good, because transcript фіксує очікувану користь: оркестратор при старті сканує `ops/**/*-plan.md` — якщо відповідний `*-fact.md` відсутній, відновлює операцію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `ops/spawn-plan-<ts>.md`, `ops/spawn-fact-<ts>.md`, `ops/kill-plan-<ts>.md`, `ops/kill-fact-<ts>.md`, `patches/patch-plan-<ts>.md`, `patches/patch-fact-<ts>.md`. Патерн також застосовується до самого `task.md` як плану агента і `outputs.md` як факту. Зафіксовано в `docs/думка.MD` у розділі "Принцип plan → action → fact".

---

## ADR Злиття `task.md` і `inputs.md` в один файл

## Context and Problem Statement
При spawn батько писав два окремі файли: `task.md` (місія) і `inputs.md` (посилання на вхідні дані). Це подвоювало кількість файлів на вузол і вимагало від агента читати два файли перед початком роботи.

## Considered Options
* Окремі файли `task.md` і `inputs.md`
* Об'єднаний `task.md` з секцією `## Inputs`

## Decision Outcome
Chosen option: "Об'єднаний `task.md` з секцією `## Inputs`", because агент читає один файл і отримує одночасно місію і посилання на дані; менше ceremony при spawn. Патч inputs не вимагає версіонування — достатньо kill worktree і вільного редагування.

### Consequences
* Good, because transcript фіксує очікувану користь: агент отримує цілісний контекст з одного читання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальна структура `task.md`: фронтматер (`created_at`, `parent`, `deps`), секції `## Task`, `## Done when`, `## Inputs` — обов'язкові, англійські заголовки. Підсекції `### <port-name>` у `## Inputs` містять `ref:` або inline-текст. `ref:` обов'язковий якщо є файл на який можна посилатись. Зафіксовано в `docs/думка.MD`.
