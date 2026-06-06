---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T20:31:14+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

`audit: true` — незалежна перевірка успіху вузла. Базова ідея: після `result: success` від основного агента — запустити окремого агента (аудитор) що перевіряє чи `## Done when` у `task.md` справді виконаний.

Питання:

**Хто аудитор** — той самий wrapper із `--actor auditor` запускає новий `run_NNN.md` з `actor: auditor`, або окрема команда?

**Що перевіряє** — тільки читає `outputs_NNN.md` + `task.md#Done when`, або може читати весь граф?

**Тригер** — коли `audit: true` в `task.md` → wrapper автоматично запускає аудитора після успішного агента?

**Провал аудиту** — якщо аудитор каже `result: failed` → вузол повертається в `waiting`?
[user]
так, провал аудиту - відповідає ть же інженер є аудит це теж окремий тип `actor`

[assistant] Тобто:

- `audit: true` в `task.md` → wrapper після `result: success` запускає `run_NNN.md` з `actor: auditor`
- Аудитор перевіряє `## Done when` і виносить `result: success | failed`
- Провал → вузол у `failed` → інженер бере в роботу (той же механізм)
- Аудитор — тільки читає, не змінює граф

Тоді `actor` енум: `agent | engineer | human | auditor` — вже є в схемі.

**Ще одне питання:** `audit: true` — завжди за замовчуванням чи людина явно вмикає по вузлу?
[user]
Аудитор — тільки читає - можна надати права написати в свій run_NNN.md

[assistant]
Звісно — аудитор пише свій `run_NNN.md` (з `actor: auditor`), це і є його "право запису". Він не змінює `task.md`, інші вузли, граф — тільки свій запис про перевірку.

Схема його `run_NNN.md`:
```markdown
---
created_at: 2026-06-06T10:10:00Z
actor: auditor
result: failed
---
## Reasoning
Перевірив outputs_001.md: результат є, але ## Done when вимагає формат JSON — отримано Markdown.
Вузол не виконав критерій завершення.
```

**Питання:** `audit: true` — завжди увімкнено або людина вмикає явно на вузлі?
[user]
людина вмикає явно на вузлі

[assistant] `audit: false` за замовчуванням, людина ставить `audit: true` в `task.md` де потрібна перевірка.

---

Transcript ends here.
---

## ADR Об'єднання `inputs.md` у `task.md`

## Context and Problem Statement
Під час проєктування файлової структури вузла виникло питання: зберігати references до вхідних даних в окремому `inputs.md` чи об'єднати їх з описом задачі в `task.md`.

## Considered Options
* Окремий `inputs.md` — батько пише посилання на дані у відокремленому файлі
* Злиття `## Inputs` у `task.md` — секція з посиланнями живе в тому ж файлі, що й місія

## Decision Outcome
Chosen option: "Злиття `## Inputs` у `task.md`", because агент читає один файл замість двох, менше файлів при spawn, і задача та дані залишаються цілісним контекстом.

### Consequences
* Good, because transcript фіксує очікувану користь: "агент читає один файл замість двох — менше церемоній при spawn".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл схеми: `docs/думка.MD`. Протокол зміни inputs до старту ворктрі: вільне редагування `task.md`; після старту — kill ворктрі → редагування → restart.

---

## ADR Уніфікація `run_NNN.md` для всіх типів акторів

## Context and Problem Statement
У системі є кілька типів акторів що виконують вузли: агент, інженер, людина, аудитор. Виникло питання про окремі типи файлів для кожного (наприклад `repair_history_NNN.md` для інженера) або єдиний уніфікований формат.

## Considered Options
* `repair_history_NNN.md` окремо від звичайних запусків агента
* Єдиний `run_NNN.md` з полем `actor: agent | engineer | human | auditor`

## Decision Outcome
Chosen option: "Єдиний `run_NNN.md`", because і звичайний агент, і інженер — це "спроба вирішити вузол" з однаковою структурою (reasoning, result, ref); уніфікація усуває дублювання структури.

### Consequences
* Good, because transcript фіксує очікувану користь: "не плодить окрему структуру".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Схема файлу: фронтматер з `created_at`, `actor`, `result`, `worktree` (опціонально при failed); секції `## Reasoning` (обов'язкова), `## Script` (wrapper, тільки при падінні), `## Ref` (опціонально).

---

## ADR Видалення `patches/` та `ops/` директорій

## Context and Problem Statement
Початкова архітектура передбачала `ops/spawn-plan`, `ops/kill-plan`, `patches/NNN-plan/fact` для відновлення після збою за патерном plan→action→fact. Постало питання чи ці файли реально потрібні.

## Considered Options
* Зберігати `ops/` і `patches/` для crash recovery
* Видалити — вся інформація міститься в `run_NNN.md`; recovery через сканування файлів

## Decision Outcome
Chosen option: "Видалити `ops/` і `patches/`", because spawn відбувається в ворктрі — при збої весь ворктрі не застосовується і граф залишається чистим; crash recovery через `ops/` ігнорується на поточному етапі.

### Consequences
* Good, because transcript фіксує очікувану користь: "нуль зайвих директорій".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли видалені з документа `docs/думка.MD`. Опис patch-логіки інженера перенесено в `## Reasoning` секцію `run_NNN.md`.

---

## ADR Автоматичний тригер наступника через git post-merge hook

## Context and Problem Statement
Після завершення агента треба тригернути запуск наступних вузлів. Питання: хто і як запускає `graph run` після merge ворктрі.

## Considered Options
* Людина вручну запускає кожен вузол
* `graph run` — довгоживучий демон-цикл що чекає merge
* Git `post-merge` hook тригерить `graph run --auto`

## Decision Outcome
Chosen option: "Git `post-merge` hook", because кожен компонент залишається простим і одноразовим — wrapper мержить, hook тригерить, `graph run --auto` сканує готових наступників.

### Consequences
* Good, because transcript фіксує очікувану користь: "максимально чистий автоматичний варіант".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Ланцюг: агент завершує → wrapper пише `run_NNN.md` → wrapper виконує `git merge` → git `post-merge` hook → `graph run --auto` → сканує граф, запускає всіх розблокованих наступників.

---

## ADR Аудитор як окремий тип актора з `audit: true` в `task.md`

## Context and Problem Statement
Після успіху агента немає незалежної перевірки чи критерій `## Done when` справді виконаний. Виникло питання про механізм аудиту.

## Considered Options
* Без аудиту — агент сам декларує `result: success`
* Аудитор як окремий `actor` — запускається wrapper-ом після `result: success` якщо `audit: true`

## Decision Outcome
Chosen option: "Аудитор як окремий `actor`", because незалежна перевірка критерію завершення підвищує надійність; провал аудиту передається інженеру за тим самим механізмом що й провал агента.

### Consequences
* Good, because transcript фіксує очікувану користь: "незалежна перевірка ## Done when".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поле `audit: false` за замовчуванням у `task.md`; людина явно ставить `audit: true`. Аудитор пише власний `run_NNN.md` з `actor: auditor`, читає `outputs_NNN.md` і `task.md#Done when`, виносить `result: success | failed`. Провал → вузол у `failed` → інженер.
