---
session: 1690e3a1-2584-4296-ba8a-06744b7c2f1a
captured: 2026-06-10T15:59:31+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1690e3a1-2584-4296-ba8a-06744b7c2f1a.jsonl
---

## ADR Розділення монолітного скіла `docgen` на `doc-files` і `doc-aggregate`

## Context and Problem Statement
Скіл `docgen` поєднував два концептуально різних режими роботи: Tier 1 — генерацію файлової документації (по одному файлу) і Tier 2+3 — агрегуючу документацію (module-summary, доменні доки). Перший підходить для обов'язкового запуску на кожній задачі, а другий — для запиту за потреби; виконувати обидва разом завжди є надмірним.

## Considered Options
* Лишити `docgen` монолітним, додавши флаг `--tier`
* Розділити на окремі скіли `doc-files` (Tier 1) і `doc-aggregate` (Tier 2+3)

## Decision Outcome
Chosen option: "Розділити на `doc-files` і `doc-aggregate`", because розподіл дозволяє зробити `doc-files` обов'язковим кроком задачі (аналогічно lint) без залежності від важкого агрегатного прогону; `doc-aggregate` лишається worktree-only за запитом.

### Consequences
* Good, because transcript фіксує очікувану користь: `doc-files` запускається у поточному робочому дереві задачі (не worktree), а `doc-aggregate` — у worktree-ізоляції; lifecycleʼи не змішуються.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/doc-files/` — `meta.json`: `{ "auto": "завжди", "worktree": false, "requireRoot": true }`
- `npm/skills/doc-aggregate/` — `meta.json`: `{ "worktree": true }`
- Старий `npm/skills/docgen` видалено без fallback і без redirect-alias (рішення явно зафіксовано в transcript: «видаляємо, без fallback»).
- Модулі (`docgen-gen.mjs`, `docgen-prompts.mjs`, `docgen-extract.mjs`) **дубльовані** в обидва скіли без спільного `_shared` — щоб кожен скіл міг еволюціонувати незалежно (рішення #2 у transcript).

---

## ADR CRC32 у frontmatter для детекції застарілості файлової документації

## Context and Problem Statement
Скіл `doc-files` має визначати, чи є наявна `<dir>/docs/<stem>.md` актуальною для відповідного кодового файлу. Потрібен детермінований маркер застарілості, придатний для викликів з PostToolUse hook і Stop-hook (без LLM, без git-контексту).

## Considered Options
* `git diff --name-only HEAD` — порівняння зі стороні git
* CRC32 байтів джерела, збережений у frontmatter документації

## Decision Outcome
Chosen option: "CRC32 у YAML frontmatter", because hook не залежить від git-стану (база, rebase, незакомічене) і перевірка є O(1): порахувати CRC джерела → порівняти з полем `crc` у frontmatter доки.

### Consequences
* Good, because transcript фіксує очікувану користь: стійкість між гілками; відсутність хибних-позитивів, якщо доку вже оновили в межах задачі (CRC збігається → `stale: false`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- CRC32 обчислює `node:zlib` (`zlib.crc32`), доступний з Node 22.2+ (версія в репо — v26.3.0).
- Frontmatter-схема: `docgen: { source: "src/lib/foo.js", crc: "<hex>" }`.
- JS штампує CRC у тому ж `writeFile`-кроці, що і саму доку; `doc-files stamp` — для міграції наявних доків без CRC.
- Реалізація: `npm/skills/doc-files/js/docgen-crc.mjs` — `sourceCrc(filePath)`, `readDocMeta(docPath)`, `writeDocMeta(docPath, meta, body)`.

---

## ADR JS-оркестрація генерації (без диспатчу субагентів моделлю)

## Context and Problem Statement
Масовий перший прогін `doc-files gen` на сотні кодових файлів може «заморити» модель, якщо вона сама диспатчить субагентів і тримає всі результати в контексті. Потрібен шлях, що не залежить від розміру контексту моделі.

## Considered Options
* Модель диспатчить субагентів (попередній підхід `n-docgen`)
* JS-оркестратор — CLI-процес керує чергою, батчингом, роутингом, CRC-штампом

## Decision Outcome
Chosen option: "JS-оркестратор", because наявний pipeline `docgen-batch.mjs` + `docgen-gen.mjs` (`callOmlx`, `resolveModel`, роутинг `sym < 4 → gemma3:4b` / `sym ≥ 4 → Claude Sonnet`) вже реалізує повний JS-шлях без участі моделі. Скіл стає «тонким» — лише кличе `doc-files gen`.

### Consequences
* Good, because transcript фіксує очікувану користь: масовий перший прогін на сотні файлів не заморює модель; порційний запуск через `--from/--limit`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Оркестратор: `npm/skills/doc-files/js/docgen-files-batch.mjs` (нащадок `docgen-batch.mjs`).
- CLI: `npx @nitra/cursor doc-files gen [--root <dir>] [--from <n>] [--limit <n>]`.
- CLI: `npx @nitra/cursor doc-files stamp [--root <dir>]` — детерміністичний ретрофіт CRC без LLM.

---

## ADR Двошаровий гейт: PostToolUse сигнал + Stop-hook блок

## Context and Problem Statement
Потрібно зробити оновлення файлової документації обов'язковим, але PostToolUse hook (детермінований CLI) не може сам генерувати доку — тільки виявляти дрейф. Одного Stop-hook'а достатньо для блоку, але він надто пізній для сигналу.

## Considered Options
* Лише PostToolUse (м'який сигнал)
* Лише Stop-hook (блок)
* Двошарово: PostToolUse сигналить, Stop-hook блокує

## Decision Outcome
Chosen option: "Двошарово (PostToolUse + Stop-hook)", because PostToolUse дає Claude фідбек одразу після правки (і Claude може регенерувати доку до завершення задачі), а Stop-hook як «сильніший гейт» блокує завершення, якщо дрейф не усунули.

### Consequences
* Good, because transcript фіксує очікувану користь: двошаровий гейт мінімізує ймовірність, що задача завершиться з застарілою докою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- PostToolUse matcher: `Edit|Write|MultiEdit`; викликає `npx @nitra/cursor doc-files check --hook`.
- Stop-hook: `npx @nitra/cursor doc-files check --stop`; блокує (`exit 1`) лише якщо `stale ≤ 50`.
- Налаштування: `npm/.claude-template/settings.template.json`.

---

## ADR `git diff --name-only HEAD` як джерело змінених файлів у Stop-hook

## Context and Problem Statement
Stop-hook (`doc-files check --stop`) має перевіряти лише файли, змінені в поточній задачі — щоб не аналізувати весь проєкт на кожному стопі. Потрібен метод вибору файлів, що балансує між точністю і швидкістю.

## Considered Options
* `git diff --name-only HEAD` (working tree + staged, але не закомічене в межах задачі)
* Список із PostToolUse (накопичення між хуками)
* `git stash list` / інші git-методи

## Decision Outcome
Chosen option: "`git diff --name-only HEAD`", because це найшвидший одноразовий виклик; explicit компроміс прийнятий: файли, закомічені в межах задачі, можуть випасти з перевірки.

### Consequences
* Good, because transcript фіксує очікувану користь: детермінований виклик без стану між запусками.
* Bad, because transcript явно фіксує відомий недолік: якщо файл закомічено всередині задачі, він не потрапляє в `diff HEAD` і гейт його пропустить.

## More Information
- Формулювання з transcript: «найшвидший; допускається, якщо не завжди спрацює».
- Реалізація: `execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root })` у `npm/skills/doc-files/js/docgen-scan.mjs`.

---

## ADR Поріг гейта > 50 для першого масового прогону

## Context and Problem Statement
На першому запуску `doc-files` сотні файлів не матимуть документації (або CRC). Stop-hook блокував би завершення кожної задачі до повної генерації, що робить першу ітерацію нефункціональною.

## Considered Options
* Блокувати завжди (будь-яка кількість stale)
* Не блокувати, якщо stale > N (конфігурований поріг)
* Окремий env-flag для bypass

## Decision Outcome
Chosen option: "Не блокувати, якщо stale > 50 (конфігурований поріг)", because рішення дозволяє масовий перший прогін відбутися без блоку; після генерації кількість stale природно падає нижче порогу і гейт починає діяти штатно.

### Consequences
* Good, because transcript фіксує очікувану користь: перший масовий прогін (`doc-files gen`) не заблокований гейтом.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Дефолт: `50`; конфігурується через `env.N_CURSOR_DOC_FILES_GATE_MAX`.
- При перевищенні порогу: `exit 0` (не блокує), але виводить попередження з пропозицією запустити `npx @nitra/cursor doc-files gen`.
- Реалізація: `npm/skills/doc-files/js/docgen-scan.mjs` — `runDocFilesCheckCli`.
