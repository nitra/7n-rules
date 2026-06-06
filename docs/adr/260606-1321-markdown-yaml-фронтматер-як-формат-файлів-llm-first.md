---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T13:21:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Markdown + YAML фронтматер як формат файлів (LLM-first)

## Context and Problem Statement
Система зберігає стан графу у файловій системі. Потрібен формат, зручний і для скриптів-оркестраторів, і для LLM-агентів, що читають контекст і дописують журнали.

## Considered Options
* Markdown + YAML фронтматер
* JSON-файли

## Decision Outcome
Chosen option: "Markdown + YAML фронтматер", because фронтматер дає машинозчитувані поля (ребра, мітки часу), а тіло — вільний Markdown, який LLM читає і продовжує природно без реконструкції контексту.

### Consequences
* Good, because `repair_history.md` як append-only журнал дозволяє агенту дочитати і дописати наступну спробу без парсингу JSON-масиву.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Контракт: секції, які парсить скрипт/оркестратор, мають англійські заголовки; секції з довільними даними — будь-яка мова. Файли: `task.md`, `outputs.md`, `error.md`, `ops/spawn-plan-<ts>.md`, `patches/patch-plan-<ts>.md`.

---

## ADR Append-only інваріант з межею ворктрі

## Context and Problem Statement
Файловий state store без транзакційних гарантій може потрапити в невалідний стан якщо агент записує файл але падає до виклику CLI-хука зміни стану.

## Considered Options
* Append-only: файли лише створюються, ніколи не змінюються; стан — наявність файлів
* Mutable файли з атомарним `rename` + CLI-хуком

## Decision Outcome
Chosen option: "Append-only з межею ворктрі", because `git worktree add` є чіткою та спостережуваною межею: до її перетину файли вільно редагуються/видаляються; після — тільки нові файли. Merge ворктрі = єдина точка рішення оркестратора.

### Consequences
* Good, because конфлікти при `git merge` двох ворктрі неможливі за визначенням — кожен ворктрі лише створює файли з унікальними іменами.
* Good, because transcript фіксує очікувану користь: гонка між записом `outputs.md` і сигналом скасування закрита архітектурно — merge gate не пропускає часткового стану.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Правило: `до worktree add` — вільне редагування; `після worktree add` — append-only. Стан вузла кодується наявністю файлів: `running` sentinel → `outputs.md` (resolved) або `error.md` (failed).

---

## ADR Розподілена топологія у `task.md` кожного дочірнього вузла

## Context and Problem Statement
При spawn складеного вузла потрібно десь зберігати топологію підграфу (ребра між дочірніми). Централізований `graph.md` є кандидатом, але потребує оновлення при динамічному spawn.

## Considered Options
* Централізований `graph.md` у батьківському вузлі
* Кожен дочірній вузол у своєму `task.md` знає своїх попередників через поле `deps:`

## Decision Outcome
Chosen option: "Розподілена топологія у `task.md`", because підхід дає універсальність: динамічний spawn (додавання нових дочірніх після часткового виконання) не потребує оновлення жодного центрального файлу — новий дочірній просто з'являється зі своїм `deps:`.

### Consequences
* Good, because оркестратор відновлює повний граф скануванням усіх `task.md` у `subgraph/` — жодного центрального файлу оновлювати не потрібно.
* Good, because transcript фіксує очікувану користь: `git merge` двох ворктрі чистий, бо кожен пише лише свій `task.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поле `deps:` містить лише `id` сусідів (siblings у межах того самого `subgraph/`). Скрипт резолвить шлях як `../<dep-id>/`. Кросрівневі залежності — через `inputs.md` батьківського рівня.

---

## ADR Часовий бюджет замість лічильника спроб для збіжності ремонту

## Context and Problem Statement
Інженер-агент при відновленні вузла може входити в нескінченний цикл (спроба → помилка → спроба). Потрібен convergence guard.

## Considered Options
* Ліміт кількості спроб (`max_attempts: N`)
* Часовий бюджет (`time_budget_sec: 600`) з необмеженою кількістю спроб

## Decision Outcome
Chosen option: "Часовий бюджет", because ліміт спроб штучно відсікає валідні рішення, а час відповідає реальним витратам (compute, wall clock). Агент адаптує стратегію: багато часу → складна спроба, мало → швидкий fix.

### Consequences
* Good, because transcript фіксує очікувану користь: агент бачить залишок часу і змінює тактику замість механічного повтору.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поля у `repair_context.json`: `deadline` (ISO 8601, встановлюється один раз), `started_at`, `time_budget_sec`, `attempts: []`. При timeout: `node.state = unresolvable`, escalate до батька. Кожен рівень ескалації отримує свіжий бюджет. Root timeout → notify SeniorEngineer через `senior_report.json`.

---

## ADR План → дія → факт як universal операційний протокол

## Context and Problem Statement
При збої агента між кроками складної операції (kill залежних → patch вузла) система може залишитись у стані де залежні вузли вбиті але патч не застосовано. Немає механізму відновлення.

## Considered Options
* Запис наміру перед дією + запис результату після
* Транзакційний менеджер

## Decision Outcome
Chosen option: "План → дія → факт через файли", because це write-ahead log без зовнішньої інфраструктури. Скрипт відновлення сканує `*-plan.md` без відповідного `*-fact.md` і знає що відновити.

### Consequences
* Good, because transcript фіксує очікувану користь: при збої між kill залежних і патчем — `patch-plan.md` існує без `patch-fact.md`, система знає що продовжити.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Патерн застосовується до: spawn (`ops/spawn-plan-<ts>.md` / `ops/spawn-fact-<ts>.md`), kill (`ops/kill-plan-<ts>.md` / `ops/kill-fact-<ts>.md`), патч (`patches/patch-plan-<ts>.md` / `patches/patch-fact-<ts>.md`). Алгоритм відновлення: `scan tasks/**/*-plan*.md → якщо відповідний *-fact.md відсутній → відновити операцію`.

---

## ADR Об'єднання `task.md` і `inputs.md` в один файл вузла

## Context and Problem Statement
При spawn агент-батько створює два файли: `task.md` (місія) і `inputs.md` (посилання на дані). Агент-дитина читає обидва. Питання: чи є сенс у їх розділенні.

## Considered Options
* Два окремих файли: `task.md` + `inputs.md`
* Один файл `task.md` із секцією `## Inputs`

## Decision Outcome
Chosen option: "Один файл `task.md` із секцією `## Inputs`", because агент читає один файл замість двох, місія і дані завжди разом, контекст цілісний. Патчування inputs не потребує версіонування файлу — до старту ворктрі файл вільно редагується, після старту — kill ворктрі і редагуй вільно.

### Consequences
* Good, because transcript фіксує очікувану користь: менше файлів при spawn, один read для агента.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальна схема: фронтматер — `created_at`, `parent` (відносно `tasks/`), `deps` (лише siblings id). Секції: `## Task`, `## Done when`, `## Inputs` — англійські (парсяться скриптом); підсекції `### <name>` з `ref:` або inline-текст. Атрибути фронтматеру та імена файлів — англійська; тіло документів — будь-яка мова.
