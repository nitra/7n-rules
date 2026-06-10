---
session: 1690e3a1-2584-4296-ba8a-06744b7c2f1a
captured: 2026-06-10T14:58:24+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1690e3a1-2584-4296-ba8a-06744b7c2f1a.jsonl
---

## ADR Розділення `docgen` на `doc-files` і `doc-aggregate`

## Context and Problem Statement
Існуючий скіл `n-docgen` є монолітом (Tier 1–3) з обовʼязковим запуском у worktree і без механізму примусового виконання. Треба виділити документацію на рівні файлу як обовʼязковий крок кожної задачі (аналогічно lint), залишивши агрегатну документацію як опціональну операцію.

## Considered Options
* Розділити `docgen` на два незалежних скіли: `doc-files` (Tier 1, обовʼязковий) і `doc-aggregate` (Tier 2+3, за запитом)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розділити `docgen` на `doc-files` і `doc-aggregate`", because `doc-files` повинен запускатись у поточному робочому дереві задачі (не worktree-only) — аналогічно до lint, а `doc-aggregate` лишається важкою операцією, що виконується за запитом у worktree. Старий `npm/skills/docgen` видаляється без fallback, спільні модулі (`docgen-prompts.mjs`, `docgen-ignore.mjs`, `docgen-scan.mjs`) копіюються в обидва скіли без спільного `_shared`, оскільки вони еволюціонуватимуть незалежно.

### Consequences
* Good, because transcript фіксує очікувану користь: документація на рівні файлу стає частиною звичайного флоу задачі без необхідності ручного запуску.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Скіл: `npm/skills/docgen/`, `CLAUDE.md` (конвенція аналогічна lint). CLI: `npx @nitra/cursor doc-files scan|check|gen|stamp`, `npx @nitra/cursor doc-aggregate modules`. Файл спеки: `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md`.

---

## ADR CRC32 у frontmatter для виявлення застарілої документації

## Context and Problem Statement
Скіл `doc-files` має виявляти, чи документ для конкретного файлу актуальний після змін у джерелі. Потрібен механізм детекції застарілості, що працює без знання git-стану і не ламається між гілками.

## Considered Options
* CRC32 у YAML frontmatter doc-файлу
* Порівняння через `git diff` відносно базової гілки

## Decision Outcome
Chosen option: "CRC32 у YAML frontmatter doc-файлу", because він не залежить від git-стану (base ref, rebase, незакоміченого), CRC рахується O(1) за вмістом джерела, і дає однозначну відповідь «свіжа чи ні» навіть якщо доку вже оновили в межах поточного diff. git-diff крихкий: залежить від визначення «бази задачі» і не бачить, чи доку вже переписали.

### Consequences
* Good, because transcript фіксує очікувану користь: hook може звіряти CRC детерміновано без LLM і без git-контексту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Формат frontmatter у doc-файлі:
```markdown
---
docgen:
source: src/lib/foo.js
crc: a3f1c9e0
---
```
CRC рахується над байтами джерела (crc32, hex). Stale = доки немає **або** `crc(джерело) ≠ crc у frontmatter`. CRC штампує JS (`doc-files gen` або `doc-files stamp` для міграції) в тому самому `writeFile`-кроці, не LLM.

---

## ADR JS-оркестрація генерації документації без LLM-субагентів

## Context and Problem Statement
Під час масового першого прогону `doc-files gen` (потенційно сотні файлів) потрібно було вирішити, хто керує батчингом і паралелізмом: модель (Claude subagent per file) чи JS-рівень.

## Considered Options
* JS-оркестрація через наявний `docgen-batch.mjs` / `docgen-gen.mjs`
* Claude диспатчить окремих субагентів на кожен файл (поточна схема скіла `n-docgen`)

## Decision Outcome
Chosen option: "JS-оркестрація через наявний `docgen-batch.mjs` / `docgen-gen.mjs`", because модель «заморюється» тримаючи сотні файлів у контексті при масовому прогоні; наявний JS-шлях (`generateDoc()` → `callOmlx`/`resolveModel`, роутинг sym<4 → локальна модель, sym≥4 → Claude cloud) вже реалізує батчинг, quality-threshold і порційний прогін (`--from/--limit`). Скіл стає тонким фасадом, що лише кличе `doc-files gen`.

### Consequences
* Good, because transcript фіксує очікувану користь: стабільна оркестрація без виснаження контексту моделі на великих прогонах.
* Neutral, because transcript не містить підтвердження наслідку щодо покриття крайніх випадків у JS-шляху порівняно з агентним підходом.

## More Information
Ключові файли: `npm/skills/docgen/js/docgen-batch.mjs`, `npm/skills/docgen/js/docgen-gen.mjs`. CLI точка входу: `npx @nitra/cursor doc-files gen [--from N] [--limit N]`.

---

## ADR Stop-hook як гейт застарілої документації з порогом 50 файлів

## Context and Problem Statement
Потрібно примусово забезпечити актуальність `doc-files` перед завершенням задачі. Механізм мав визначити: який тип hook, як ідентифікувати «змінені в задачі» файли і як не блокувати гігантський першій прогін.

## Considered Options
* PostToolUse hook (сигналізує, не блокує) як єдиний механізм
* Двошаровий механізм: PostToolUse (м'який сигнал) + Stop-hook (жорстке блокування)

## Decision Outcome
Chosen option: "Двошаровий механізм: PostToolUse + Stop-hook", because Stop-hook дає «сильніший гейт» — блокує завершення задачі за наявності stale-документів, тоді як PostToolUse лише сигналить після кожного Edit/Write. Для виявлення «змінених у задачі» джерел обрано найшвидший варіант — `git diff --name-only HEAD` (допускається, що не завжди спрацює точно). Якщо stale-файлів >50 — Stop-hook не блокує (обхід для масового першого прогону).

### Consequences
* Good, because transcript фіксує очікувану користь: задача фізично не може завершитись із застарілою документацією за звичайних умов.
* Bad, because transcript фіксує явне компромісне рішення: `git diff --name-only HEAD` «не завжди спрацює» — прийнято свідомо в обмін на швидкість.

## More Information
Stop-hook викликає `doc-files check --changed-only` (через `git diff --name-only HEAD`), повертає non-zero якщо є stale і кількість ≤50. Конфігурація: `.claude/settings.json`, matcher `Stop`. PostToolUse matcher: `Edit|Write|MultiEdit`.
