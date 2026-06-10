---
session: 1690e3a1-2584-4296-ba8a-06744b7c2f1a
captured: 2026-06-10T14:51:31+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1690e3a1-2584-4296-ba8a-06744b7c2f1a.jsonl
---

## ADR Розділення `docgen` на `doc-files` і `doc-aggregate`

## Context and Problem Statement
Скіл `n-docgen` є монолітом: він і генерує доку на кожен файл (Tier 1), і будує агреговані ARCHITECTURE.md та доменні доки (Tier 2–3). Потрібно зробити файлову документацію обовʼязковим кроком кожної задачі (як lint), а агрегацію — легковаговою операцією за запитом.

## Considered Options
* Розділити на два окремі скіли (`doc-files` і `doc-aggregate`) без будь-якого fallback на старий `docgen`
* Лишити `n-docgen` і додати режими через прапорці (монолітний варіант)

## Decision Outcome
Chosen option: "Розділити на `doc-files` і `doc-aggregate` без fallback", because Tier 1 і Tier 2–3 мають різні режими запуску (обовʼязковий vs за запитом), різну worktree-семантику та різні life-cycle-и еволюції.

### Consequences
* Good, because `doc-files` можна зробити обовʼязковим кроком задачі (інтегрувати в hook) незалежно від важкого агрегатора.
* Bad, because необхідно мігрувати та/або задублювати спільні модулі (`docgen-prompts.mjs`, `docgen-ignore.mjs`, `docgen-scan.mjs`), а старий `npm/skills/docgen` видаляється повністю.

## More Information
Файл специфікації: `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md`. CLI-точки входу: `npx @nitra/cursor doc-files <scan|check|gen|stamp>` і `npx @nitra/cursor doc-aggregate modules`. Старий `npm/skills/docgen/` та CLI-namespace `docgen` видаляються без fallback і alias.

---

## ADR CRC32 у frontmatter як маркер актуальності файлової доки

## Context and Problem Statement
`doc-files` має генерувати доку лише для файлів, які дійсно змінились. Потрібний детермінований спосіб визначити «застарілість» доки без залежності від git-стану (базова гілка, rebase, незакомічені зміни).

## Considered Options
* CRC32 вмісту джерела у frontmatter doc-файлу (`docgen.crc`)
* git-diff відносно базової гілки/HEAD

## Decision Outcome
Chosen option: "CRC32 у frontmatter", because hook не може покладатись на git-стан (базова гілка може бути невизначеною, або файл вже оброблений в поточній задачі); CRC дає O(1)-перевірку лише за вмістом файлу.

### Consequences
* Good, because transcript фіксує очікувану користь: перевірка стійка між гілками, не залежить від git-контексту, дозволяє hook-у вирішувати «stale vs fresh» без LLM.
* Bad, because frontmatter потрібно підтримувати актуальним — за рахунок детермінованого CLI-кроку `doc-files stamp`, а не субагента.

## More Information
Формат frontmatter:
```markdown
---
docgen:
source: src/lib/foo.js
crc: a3f1c9e0
---
```
CRC рахується над байтами джерела (crc32, hex). Stale = доки немає АБО `crc(джерело) ≠ crc у frontmatter`. CLI `doc-files check` повертає список stale-файлів без LLM. CLI `doc-files stamp <docPath> <srcPath>` — записує свіжий CRC після генерації (JS, без субагента).

---

## ADR Stop-hook як механізм обовʼязковості `doc-files`

## Context and Problem Statement
`doc-files` має бути обовʼязковим кроком задачі — аналог lint. Потрібен механізм, який буде тригерити перевірку після правки джерельних файлів і не давати продовжити без актуальної доки.

## Considered Options
* Stop-hook (сильний гейт: блокує зупинку агента до виправлення)
* PostToolUse-fix hook (слабший: сигналить Claude, але не блокує)

## Decision Outcome
Chosen option: "Stop-hook", because user явно обрав «сильніший гейт (Stop-hook)» — він не дозволяє завершити задачу, поки `doc-files check` повертає stale-файли.

### Consequences
* Good, because transcript фіксує очікувану користь: документація не може залишитись застарілою після завершення будь-якої задачі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Тригер: matcher на `Edit|Write|MultiEdit` (або окремий Stop-hook matcher). CLI-точка входу: `npx @nitra/cursor doc-files check`. Конфігурація через `.claude/settings.json`. Механізм аналогічний наявному `post-tool-use-fix` (`npm/scripts/post-tool-use-fix.mjs`, `n-cursor.js:1636`).

---

## ADR JS-оркестрація генерації доки (без Claude-субагентів)

## Context and Problem Statement
Генерація доки для всіх stale-файлів задачі може бути обʼємною. Потрібна оркестрація, яка не перевантажить модель і забезпечить стабільний throughput незалежно від кількості файлів.

## Considered Options
* JS-оркестратор (`docgen-batch.mjs` + `docgen-gen.mjs`) — генерація через `callOmlx`/`resolveModel` напряму
* Диспатч Claude-субагентів (попередній підхід `n-docgen`)

## Decision Outcome
Chosen option: "JS-оркестратор", because user зафіксував: «важливо щоб оркестрацією займався js, щоб модель не заморилася»; крім того, наявний `docgen-batch.mjs` вже реалізує повний pipeline: scan → класифікація → цикл → stats, з роутингом sym<4 → локальна модель, sym≥4 → Claude cloud.

### Consequences
* Good, because transcript фіксує очікувану користь: JS-pipeline не споживає контекст Claude-агента, масштабується на велику кількість файлів, використовує наявний `docgen-gen.mjs`/`docgen-batch.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Наявні модулі: `npm/skills/docgen/js/docgen-batch.mjs`, `npm/skills/docgen/js/docgen-gen.mjs` (функція `generateDoc()`, багатостадійний pipeline з quality-threshold). CLI-команда `doc-files gen [--root <dir>]` викликає JS-оркестратор, а не субагент.

---

## ADR Дублювання спільних модулів між `doc-files` і `doc-aggregate`

## Context and Problem Statement
`docgen-prompts.mjs`, `docgen-ignore.mjs`, `docgen-scan.mjs` потенційно потрібні обом новим скілам. Постало питання: shared-модуль чи копія в кожному пакеті.

## Considered Options
* Дублювання — кожен скіл має власну копію модулів
* Спільний внутрішній пакет / re-export

## Decision Outcome
Chosen option: "Дублювання", because user відповів «дублювання, бо далі кожен з них буде змінюватись окремо» — `doc-files` і `doc-aggregate` еволюціонують незалежно, shared-залежність стала б перешкодою.

### Consequences
* Good, because кожен скіл можна змінювати без ризику зламати інший; відсутня coupling через спільний модуль.
* Bad, because зміни в базовій логіці (ignore-glob, scan-алгоритм) потрібно вносити в обидва місця окремо.

## More Information
Модулі до копіювання: `docgen-prompts.mjs`, `docgen-ignore.mjs`, `docgen-scan.mjs` з `npm/skills/docgen/js/`. Після копіювання кожен скіл (`npm/skills/doc-files/`, `npm/skills/doc-aggregate/`) підтримує свою копію незалежно.
