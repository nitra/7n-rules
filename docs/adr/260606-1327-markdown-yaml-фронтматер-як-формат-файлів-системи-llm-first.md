---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T13:27:48+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Markdown + YAML-фронтматер як формат файлів системи (LLM-first)

## Context and Problem Statement
Система побудована на файловому state store, де кожен вузол керує своїми файлами. Потрібно обрати формат файлів, зручний передусім для LLM-агентів що читають і пишуть ці файли, але також придатний для парсингу скриптами-оркестраторами.

## Considered Options
* Markdown з YAML-фронтматером
* JSON-файли (наприклад `meta.json`, `repair_history.json`)

## Decision Outcome
Chosen option: "Markdown з YAML-фронтматером", because LLM-агенти тренуються на Markdown і читають/продовжують його природно; фронтматер дає машинозчитувані поля, а тіло — вільний контекст.

### Consequences
* Good, because `repair/<ts>-plan.md` як append-only журнал — інженер читає і продовжує природно без парсингу JSON-масиву.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Додаткове правило зафіксоване в документі: секції що парсить оркестратор/скрипт — англійські заголовки (`## Task`, `## Summary`, `## Done when`); секції з довільними даними — будь-яка мова. Атрибути YAML-фронтматеру — англійська, snake_case. `created_at` — обов'язкове перше поле у фронтматері всіх файлів. Файл `docs/думка.MD`.

---

## ADR Append-only інваріант із ворктрі-межею атомарності

## Context and Problem Statement
Файловий state store потребує механізму атомарності: без нього агент може записати `outputs.md` не доагентувавши CLI-хук, або два агенти можуть одночасно модифікувати один файл, залишаючи граф у невалідному стані.

## Considered Options
* Append-only інваріант (файли лише створюються, ніколи не змінюються після ворктрі-старту)
* Атомарний write через `rename` (write-to-temp + mv) з явними sentinel-файлами
* Транзакційні блокування на рівні ФС

## Decision Outcome
Chosen option: "Append-only інваріант із ворктрі-межею", because git worktree є ізольованою директорією на диску; сам факт merge є єдиною точкою рішення, що усуває потребу в блокуваннях або атомарному rename.

### Consequences
* Good, because конфлікти злиття ворктрі неможливі за визначенням — два ворктрі пишуть лише нові файли з унікальними іменами.
* Good, because transcript фіксує очікувану користь: "Merge = єдина точка рішення: наявність `outputs.md` після merge = вирішено."
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Точна межа інваріанту: до створення ворктрі файли вузла можна вільно змінювати і видаляти; після — тільки нові файли. Для зміни після старту: kill ворктрі → редагуй вільно → restart. Файл `docs/думка.MD`, розділ "Інваріант незмінності".

---

## ADR Стан вузла через наявність файлів замість явного поля `state`

## Context and Problem Statement
Кожен вузол потребує відстеження стану (очікує / виконується / вирішено / помилка / знедійснений). Потрібно вирішити де і як зберігати цей стан.

## Considered Options
* Поле `state:` у YAML-фронтматері `task.md` (або `meta.json`)
* Стан через наявність файлів: `outputs.md` існує = вирішено, `error.md` існує = помилка, активний ворктрі = виконується

## Decision Outcome
Chosen option: "Стан через наявність файлів", because відповідає append-only інваріанту — зміна стану = створення нового файлу, а не модифікація існуючого.

### Consequences
* Good, because transcript фіксує очікувану користь: усунуто потребу в окремому CLI-хуку для зміни стану — сам факт створення файлу є сигналом.
* Bad, because для визначення стану "виконується" потрібно перевіряти `git worktree list`, а не читати файл — трохи дорожче для observability-скрипту.

## More Information
Таблиця станів у `docs/думка.MD`: тільки `task.md` = очікує; активний ворктрі = виконується; `outputs.md` після merge = вирішено; `error.md` після merge = помилка; файл `invalidated` існує = знедійснений.

---

## ADR Distributed topology: `deps:` у `task.md` кожного дочірнього, без центрального граф-файлу

## Context and Problem Statement
Compound-вузол розкладається на підграф дочірніх вузлів. Потрібно вирішити де зберігати топологію цього підграфу — в одному авторитетному файлі чи розподілено.

## Considered Options
* Центральний `graph.md` у батьківському вузлі з повним списком вузлів і ребер
* Distributed topology: кожен дочірній вузол оголошує своїх попередників у полі `deps:` власного `task.md`

## Decision Outcome
Chosen option: "Distributed topology в `deps:` кожного `task.md`", because забезпечує універсальність — жоден центральний файл не потрібно оновлювати при dynamic spawn; оркестратор відновлює повний граф скануванням.

### Consequences
* Good, because динамічний spawn = просто новий дочірній з `task.md` і `deps:`; оркестратор підхоплює при наступному скануванні без змін у батьківських файлах.
* Bad, because для реконструкції топології потрібне сканування всіх `task.md` у `subgraph/` — немає індексу.

## More Information
`deps:` посилаються лише на siblings (вузли в тому ж `subgraph/`). Поле містить лише `id` без шляху; скрипт резолвить як `../<dep-id>/`. Файл `docs/думка.MD`, розділ "Топологія і spawn".

---

## ADR Злиття `inputs.md` у `task.md` — єдиний вхідний файл вузла

## Context and Problem Statement
Початкова схема передбачала два окремі файли: `task.md` (місія агента) і `inputs.md` (посилання на вхідні дані). Агент при старті читав обидва.

## Considered Options
* Два окремі файли: `task.md` + `inputs.md`
* Один файл `task.md` із секцією `## Inputs`

## Decision Outcome
Chosen option: "Один файл `task.md` із секцією `## Inputs`", because агент читає один файл замість двох, задача і дані завжди разом — контекст цілісний.

### Consequences
* Good, because transcript фіксує очікувану користь: менше файлів при spawn, спрощений протокол.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Секція `## Inputs` містить підсекції `### <name>` з полем `ref:` або inline-текстом. Три форми `ref:`: весь файл, секція за заголовком (`#section-name`), діапазон рядків (`lines N-M`). Файл `docs/думка.MD`, схема `task.md`.

---

## ADR Принцип plan → action → fact як write-ahead log для всіх операцій

## Context and Problem Statement
Агент або інженер може впасти посеред операції (spawn підграфу, kill ворктрі, патч вузла), залишаючи систему у невизначеному стані. Потрібен механізм відновлення.

## Considered Options
* Write-ahead log через пару файлів `*-plan.md` / `*-fact.md` для кожної операції
* Транзакційна семантика на рівні CLI-команд

## Decision Outcome
Chosen option: "plan → action → fact через файли", because відповідає append-only інваріанту; відновлення зводиться до сканування `*-plan.md` без відповідного `*-fact.md`.

### Consequences
* Good, because transcript фіксує очікувану користь: "якщо є `plan.md` без `fact.md` → операція не завершена → продовжити".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Застосовується до: `ops/spawn-plan/fact-<ts>.md`, `ops/kill-plan/fact-<ts>.md`, `patches/patch-plan/fact-<ts>.md`, `repair/<ts>-plan.md` / `repair/<ts>-fact.md`. Алгоритм відновлення: `scan tasks/**/ops/*-plan*.md` без відповідного `*-fact*.md`. Файл `docs/думка.MD`, розділ "Принцип plan → action → fact".

---

## ADR Time budget замість лічильника спроб як convergence guard для інженера

## Context and Problem Statement
АгентІнженер запускається при помилці вузла і може робити необмежену кількість спроб відновлення. Потрібен механізм що запобігає нескінченному циклу.

## Considered Options
* `max_attempts: N` — жорсткий ліміт кількості спроб
* Time budget — фіксований часовий відрізок (наприклад 10 хвилин), необмежена кількість спроб

## Decision Outcome
Chosen option: "Time budget", because реалістичніше обмеження ніж лічильник спроб; інженер може адаптувати стратегію залежно від залишку часу.

### Consequences
* Good, because transcript фіксує очікувану користь: "багато часу → складна спроба, мало часу → швидкий fix."
* Good, because максимальний час до ескалації передбачуваний: `depth × budget`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Time budget зберігається у полі `deadline` файлу `repair/<ts>-plan.md`. Ієрархія ескалації: кожен батьківський рівень отримує свіжий (не залишковий) budget. Root timeout → повідомлення SeniorEngineer. Файл `docs/думка.MD`, розділ "Ескалація і time budget".

---

## ADR Wrapper-скрипт як компілятор контексту для repair-сеансів

## Context and Problem Statement
АгентІнженер запускається в новому сеансі без пам'яті про попередні спроби. Потрібен механізм передачі контексту про вже випробувані підходи.

## Considered Options
* Інженер самостійно читає всі `repair/*.md` файли перед початком
* Wrapper-скрипт компілює всі попередні `repair/*-fact.md` і передає як блок у system prompt
* Центральний `repair/summary.md` що оновлюється після кожного сеансу (порушує append-only)

## Decision Outcome
Chosen option: "Wrapper-скрипт компілює контекст", because інженер отримує готовий контекст без зайвих файлових операцій; `repair/summary.md` відкинутий як порушення append-only інваріанту.

### Consequences
* Good, because transcript фіксує очікувану користь: чистий інтерфейс для інженера, файли залишаються append-only.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — поведінка wrapper-скрипту при великій кількості сеансів не специфікована.

## More Information
Один файл = один сеанс інженера (може містити кілька спроб у межах time budget). Секція `## Prior attempts summary` у `repair/<ts>-plan.md` — заповнюється wrapper-скриптом. Файл `docs/думка.MD`, схема `repair/<ts>-plan.md`.
