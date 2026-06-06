---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T20:37:16+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Уніфікований `run_NNN.md` з полем `actor`

## Context and Problem Statement
Для фіксації спроб виконання вузла розглядались окремі файли: `error.md` для технічних збоїв, `repair_history_NNN.md` для спроб інженера, і потенційні окремі файли для аудитора. Це породжувало кілька структур з різними іменуваннями, але однаковою семантикою — "хтось спробував щось зробити з вузлом".

## Considered Options
* Окремі файли на кожен тип актора: `error.md`, `repair_history_NNN.md`, `audit_NNN.md`
* Єдиний `run_NNN.md` з полем `actor: agent | engineer | human | auditor`

## Decision Outcome
Chosen option: "Єдиний `run_NNN.md` з полем `actor`", because агент, інженер, аудитор і людина — це той самий патерн "спроба вирішити вузол"; різниця лише у тому що продукується, тому одна схема охоплює всі випадки.

### Consequences
* Good, because transcript фіксує очікувану користь: інженер читає всю `run_NNN.md` історію як єдиний документ і не повторює попередніх рішень.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `tasks/<node-id>/run_001.md`. Поля фронтматеру: `created_at`, `actor`, `result: success | failed`, `worktree` (тільки якщо failed). Секції: `## Reasoning` (агент/інженер), `## Script` (wrapper), `## Ref` (агент/інженер). NNN — порядковий номер, wrapper рахує `ls run_*.md | wc -l + 1`, zero-padded до 3 цифр.

---

## ADR Повністю immutable файлова модель без append-only файлів

## Context and Problem Statement
Початковий дизайн мав append-only файли (`outputs.md`, `error.md`, `repair_history.md`) — нові секції дописувались до існуючих файлів. Це суперечило загальному принципу "файли лише створюються, ніколи не змінюються" прийнятому для ворктрі-ізоляції.

## Considered Options
* Append-only файли: `outputs.md`, `error.md` з секціями `## Run N`
* Повністю immutable: кожна спроба = новий файл (`run_001.md`, `run_002.md`; `outputs_001.md`, `outputs_002.md`)

## Decision Outcome
Chosen option: "Повністю immutable", because всі файли під час роботи мають бути immutable — це уніфікує модель і прибирає виняток для append-only файлів.

### Consequences
* Good, because transcript фіксує очікувану користь: скрипт читає файл з найбільшим номером як актуальний; відновлення після збою — скануванням `run_*.md` без `outputs_*.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Скасовані файли: `error.md`, `repair_history.md`, `repair_context.md`, `outputs.md` (append-only версія). Актуальна структура вузла: `task.md`, `run_NNN.md`, `outputs_NNN.md`, `invalidated`. Конфіг: `tasks_dir`, `worktrees_dir` у `.n-cursor.json`.

---

## ADR Аудитор: агент сам ініціює перевірку через `graph audit`

## Context and Problem Statement
Потрібен механізм якісного гейту між виконанням агента і `resolved`-станом. Варіанти: прапор `audit: true` у `task.md` (батько вирішує), або агент сам вирішує після виконання.

## Considered Options
* Поле `audit: true` у `task.md` — батько вирішує при spawn що потрібна перевірка
* Агент сам викликає `graph audit` замість `graph done` коли не впевнений

## Decision Outcome
Chosen option: "Агент сам викликає `graph audit`", because агент бачить результат свого виконання і краще за батька оцінює чи потрібна незалежна перевірка.

### Consequences
* Good, because transcript фіксує очікувану користь: аудитор бачить `task.md` (зокрема `## Done when`) + всі зміни агента у ворктрі і дає оцінку відповідності критерію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Аудитор запускається wrapper-скриптом у тому самому ворктрі (read-only). Пише `run_(NNN+1).md` з `actor: auditor`. При `result: failed` — агент перезапускається в тому ж ворктрі з контекстом зауважень. Після 3 поспіль `actor: auditor, result: failed` — wrapper зупиняється, чекає людину. Модель аудитора: `audit_model` у `.n-cursor.json` (дефолт `claude-haiku-4-5-20251001`). Команди: `graph audit <path>`, `graph done <path>`.

---

## ADR git `post-merge` hook як оркестратор наступних вузлів

## Context and Problem Statement
Після завершення вузла система повинна автоматично знайти і запустити розблокованих наступників. Варіанти: ручний запуск людиною, `graph run` як демон, або git hook.

## Considered Options
* Ручний запуск — людина після кожного merge вирішує що запустити
* `graph run` як демон — сам чекає merge і продовжує
* git `post-merge` hook → `graph run --auto`

## Decision Outcome
Chosen option: "git `post-merge` hook → `graph run --auto`", because `graph run` залишається одноразовою командою, а git-інфраструктура тригерить оркестрацію — найчистіший поділ відповідальностей.

### Consequences
* Good, because transcript фіксує очікувану користь: людина тільки запускає кореневий вузол, далі система сама до кінця (або до `failed`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `.git/hooks/post-merge` з `n-cursor graph run --auto`. Wrapper-скрипт після успішного merge автоматично тригерить hook. `graph run --auto` сканує граф, знаходить вузли де `deps → resolved`, запускає паралельно в межах `max_worktrees`. Команда: `n-cursor graph setup` встановлює hook при ініціалізації проекту.
