---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:44:19+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Зафіксовано. Файловий контракт у memory повний.

Готові переносити все в `docs/думка.MD`? Це буде суттєве оновлення — таблиця станів, схеми файлів, нові правила `deps/`, composite synthesis, `allow_replan`, history/ структура. Хочеш що я зробив це одним агентом або будемо ітерувати разом?
[user]
Одним агентом. Запусти в worktree

---

[The transcript ends here. The ADR hook is now processing the above session.]
</thinking>

## ADR Дизайн файлового контракту задачного графу (`n-cursor graph`)

## Context and Problem Statement
У процесі проєктування системи `n-cursor graph` — рекурсивного самомодифікованого DAG задач із файловим зберіганням стану — виявлено 15 структурних вад і 4 ризики масштабування. Сесія присвячена їх ітеративному розбору та прийняттю рішень до початку реалізації.

## Considered Options
* Існуючий дизайн з `task.md` frontmatter для стану, `invalidated` sentinel, одним `waiting`-станом, центральним індексом
* Гібридний файловий дизайн: sentinel-файли як носії стану, `deps/` директорія, `history/` для аудиту, дворівнева таблиця станів — описано нижче

## Decision Outcome
Chosen option: "Гібридний файловий дизайн зі суворим listing-інваріантом", because всі стани вузла мають визначатись виключно переліком файлів і директорій без читання вмісту; підтверджено в кожному рішенні сесії.

### Consequences

**Таблиця станів (фінальна):**

| # | Ключова умова | Стан |
|---|---|---|
| 1 | `task.md`, немає `a.md`/`h.md` | `unassigned` |
| 2 | `a.md` або `h.md`, немає `plan_001.md` | `waiting-plan` |
| 3 | `plan_001.md`, deps НЕ resolved | `blocked` |
| 4 | `plan_001.md`, deps resolved | `waiting-run` |
| 5a | `running_<pid>_until_<ts>`, `ts > now()` | `running` (агент) |
| 5b | `running_0_until_0` | `running` (людина) |
| 6 | `running_<pid>_until_<ts>`, `ts ≤ now()` | `stalled` |
| 7 | `run_NNN.md` | `failed` |
| 8 | `fact_NNN.md` + `pending-audit_NNN.md` | `pending-audit` |
| 9 | `fact_NNN.md` | `resolved` |

Пріоритет: `resolved` > `pending-audit` > `stalled` > `running` > `failed` > `blocked` > `waiting-run` > `waiting-plan` > `unassigned`

**Ключові рішення по вадах:**

* Good, because **Вада №1**: `running_<pid>_until_<ts>` — PID + deadline в імені. Watch/wrapper перевіряє `kill -0 <pid>`; `pid == "0"` → людина, skip Unix check.
* Good, because **Вада №2**: `waiting-plan` / `waiting-run` — симетричні стани для агента і людини; `a.md`/`h.md` = хто; стан = що потрібно.
* Good, because **Вада №3+5**: `deps/` вкладена структура дзеркалює `tasks/`; всі файли з `.md`; шлях відносно `tasks/`.
* Good, because **Вада №4**: composite вузол отримує власний `fact_NNN.md` через synthesis agent після того як всі діти resolved.
* Good, because **Вади №6+14**: внутрішній LLM-аудитор видалено; агент self-verifies `## Done when`; зовнішній async аудит через `require_approval: true` → `pending-audit_NNN.md` + `graph audit approve/reject`.
* Good, because **Вада №7**: `graph migrate` при кожному релізі; `schema_version:` не потрібен.
* Good, because **Вада №8**: `mode:` видалено з `plan_001.md`; єдине джерело правди — `a.md`/`h.md`.
* Good, because **Вада №9**: wrapper витягує `## Blockers` + `## Next Attempt` з усіх failed `run_*.md` → compact summary для наступного агента; `run_*.md` і `fact_*.md` ніколи не співіснують (`fact` = успіх, `run` = тільки провал).
* Good, because **Вада №10**: при composite planning агент пише `a.md`/`h.md` для кожної дочірньої задачі.
* Good, because **Вада №13**: `running_0_until_0` для людини; `graph done --actor human` → wrapper перевіряє `## Done when` → пише `fact_NNN.md (actor: human)`.
* Good, because **Вада №15**: `allow_replan: true` у `a.md` дозволяє агенту автономно переключити `hint: atomic` → composite; за замовчуванням — `failed` з пропозицією для людини.
* Good, because **Ризики №1**: `agent_concurrency` черга агентів; людські worktrees без обмежень.
* Good, because **Ризики №2+3**: `graph kill` = архів у `<tasks-root>/.history/` + `git rm`; `graph invalidate` = архів `fact_*.md`/`run_*.md` всередині вузла; `invalidated` sentinel видалено.
* Bad, because transcript не містить підтверджених негативних наслідків; ризик №4 (clock skew на distributed FS) — out of scope для MVP.

## More Information

Файли: `docs/думка.MD`, `/Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/project_graph_design_review.md`

Схеми `a.md`: `model_tier`, `skills`, `require_approval`, `allow_replan`. Схеми `fact_NNN.md`: `actor: agent|human`, `model_tier` (agent-only), `duration_sec` (agent-only). `run_NNN.md` обов'язково містить `## Blockers` та `## Next Attempt`.

Monorepo: кожен workspace має власний `tasks/` root з `.history/` як сиблінгом. `NCURSOR_TASKS_DIR` вказує активний root. Один `n-cursor watch` на один root.

`plan_001.md` — завжди один файл на вузол (не `plan_002`). `graph replan` архівує до `history/<ts>-replan/` і дозволяє написати новий.

Human flow: `graph start --actor human` можна викликати з `waiting-plan` або `waiting-run` (план опціональний для людини).
