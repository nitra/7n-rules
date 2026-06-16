---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-16T16:30:19+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

Step 1 (вирівнювання `mt worktree`) завершено — 17/17 тести, eslint без errors.

Що зроблено у `mt`:
- `add`→`create` (no-compat), `remove` ефемерний (видаляє гілку), `prune`+`inventory` (JSON) нові підкоманди
- `.worktrees/.meta/<sanit>.md` layout (замість плаского `.worktrees/<sanit>.md`)
- `firstFreeBranch` (auto base2/base3 при колізії), dirty-notice з переліком файлів
- тест оновлено (17 кейсів), changeset `260616-1404.md`

Далі — step 2: cursor-міграція на `mt worktree`. Починаємо?
[user]
так
[user]
Хочу уточнити плани по transkritu, а не кожен раз описувати контекст
---
TRANSCRIPT ENDS

Based on the session above, produce ADR documents as described. Output only the markdown blocks with no additional text.

## ADR cspell-fix: заміна whole-file rewrite на classify+словник

## Context and Problem Statement
Наявна схема `cspell-fix` передавала весь файл у локальну LLM і просила повернути переписаний файл без орфографічних помилок. Це спричиняло масові таймаути (curl exit 28, 120 с), відмови через `memory-guard` (файли до ~18 GB після JSON-серіалізації), парс-фейли та нуль корисних фіксів при ~1406 знахідках у репо.

## Considered Options
* Whole-file LLM rewrite (стара схема): модель повертає весь файл — один виклик per file
* Classify + словник: модель класифікує унікальні невідомі слова (`typo` / `valid`), `valid` → дедетермінистично дописуються у `.cspell.json#words`, `typo` → лише пропозиція на рев'ю (не застосовується)

## Decision Outcome
Chosen option: "classify + словник", because whole-file rewrite спричиняв таймаути/guard/parse-fail і не давав корисного результату; classify-схема — bounded (≤80 слів / 1 виклик), детермінована і мутує лише `.cspell.json`.

### Consequences
* Good, because transcript фіксує очікувану користь: 0 таймаутів, 0 memory-guard-відмов, 79/80 слів коректно класифіковано → дописано у словник; 4/4 юніт-тести.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/text/lint/cspell-fix.mjs`, `npm/rules/text/lint/tests/cspell-fix.test.mjs`. Константа `MAX_CLASSIFY_WORDS = 80`. Дедуп через `new Set()` по всьому виводу cspell — слово в 50 файлах класифікується один раз. `appendWordsToDict` — детерміністичний sorted append у `.cspell.json`. `typo` — лише `process.stdout.write` на рев'ю. Changeset: `npm/.changes/260615-1315.md`.

---

## ADR спільний `preflightLocalModel` у `lib/llm.mjs`

## Context and Problem Statement
Локальний preflight (перевірка доступності omlx-моделі: `memory-guard` / `down` / `auth`) був продубльований у `doc-files/js/docgen-files-batch.mjs` і `text/lint/cspell-fix.mjs` як локальні функції `preflightProblem`.

## Considered Options
* Дублювати preflight у кожному правилі окремо
* Винести `preflightLocalModel(model)` у спільний `npm/lib/llm.mjs`

## Decision Outcome
Chosen option: "винести у `npm/lib/llm.mjs`", because дублювання порушує принцип єдиної точки зміни; спільне ядро opportunistic LLM-fix tier має лежати в одному місці.

### Consequences
* Good, because transcript фіксує очікувану користь: обидва правила перемкнуто на спільний хелпер, тести 134/134.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/lib/llm.mjs` (нова функція `preflightLocalModel`), `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/text/lint/cspell-fix.mjs`, `npm/rules/doc-files/js/tests/docgen-files-batch.test.mjs`. Changeset: `npm/.changes/260615-1344.md`. Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.

---

## ADR opt-in `meta.json: llmFix:true` — реальний safety-тріаж

## Context and Problem Statement
Прапор `meta.json: llmFix:true` (рішення D4 зі спеки opportunistic LLM-fix tier) оголошував opt-in для LLM-fix-кроку, але ніхто його не читав: `runLint` у `orchestrate.mjs` запускав opportunistic-fix просто на умові `!readOnly`. Нове lint-правило з LLM-кроком отримало б його увімкненим за замовчуванням без явного дозволу.

## Considered Options
* Залишити `llmFix` декоративним (opportunistic-fix = `!readOnly`)
* Провести `llmFix` з `meta.json` через orchestrate → lint-контракт кожного правила

## Decision Outcome
Chosen option: "провести `llmFix` через orchestrate", because без реального тріажу будь-яке майбутнє lint-правило ненавмисно отримало б LLM-fix; opt-in має бути явним і машино-верифікованим.

### Consequences
* Good, because transcript фіксує очікувану користь: `runLint` тепер читає `metaById[id]?.llmFix`, передає `{ readOnly, llmFix }` у `lint()`; правило без прапора = detect-only; тести 73/73; pre-existing `no-unsanitized/method` помилку в `orchestrate.mjs` закрито justify-disable.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/lint/js/orchestrate.mjs`, `npm/rules/doc-files/js/lint.mjs`, `npm/rules/text/js/lint.mjs`, `npm/rules/text/lint/lint.mjs`, `npm/rules/text/lint/cspell-fix.mjs`, `npm/rules/text/meta.json` (`llmFix:true` додано), `npm/bin/n-cursor.js` (lint-text→`llmFix:true`), `npm/rules/doc-files/js/tests/lint.test.mjs`. Changeset: `npm/.changes/260615-1359.md`. Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.

---

## ADR перенесення worktree-lifecycle з @nitra/cursor у @7n/mt

## Context and Problem Statement
Керування git-worktree (`add/remove/list/prune`, інвентарні `.md`-файли, dirty-notice, колізії імен) жило у `@nitra/cursor` (`npm/scripts/worktree-cli.mjs` + `npm/scripts/lib/worktree.mjs`). Паралельно `@7n/mt` (монорепо-тул) вже мав наявну JS-реалізацію `mt worktree add|remove|list` і Rust-discovery `discover_worktrees` для task-graph. Прийнято рішення, що `@nitra/cursor` залежатиме від `@7n/mt`, а скіли cursor кличуть `mt worktree` напряму.

## Considered Options
* Лишити worktree-lifecycle у `@nitra/cursor`
* Перенести у Rust-крейт `scanner` у `mt`
* Вирівняти наявний JS `mt worktree` під узгоджений контракт (JS у `@7n/mt`)

## Decision Outcome
Chosen option: "вирівняти наявний JS `mt worktree`", because бенчмарк (2026-06-16) показав, що `mt` входить через Node-wrapper (~35 мс незмінна підлога), тому Rust-spawn додав би зайвий процес і сповільнив (~70+ мс проти ~63 мс JS); worktree ефемерний (remove видаляє гілку — наявна mt-семантика коректна).

### Consequences
* Good, because transcript фіксує очікувану користь: єдина відповідальна сторона для worktree-lifecycle; `@nitra/cursor` позбудеться `worktree-cli.mjs`/`lib/worktree.mjs`/bin-команди/скіла; `mt worktree` отримав `create|remove|list|prune|inventory`, `.worktrees/.meta/<sanit>.md` layout, `firstFreeBranch`, dirty-notice з переліком; 17/17 тести в mt.
* Bad, because `@nitra/cursor` набуває залежності від `@7n/mt` — зовнішній бінарник стає вимогою для всіх консумерів cursor.

## More Information
Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. Sequencing: mt-реліз → cursor-міграція на опубліковану `@7n/mt`. Changeset mt: `npm/.changes/260616-1404.md`. Файли mt: `npm/lib/commands/worktree.mjs`, `npm/lib/commands/worktree.test.mjs`, `npm/lib/cli.mjs`. Layout: `.worktrees/<sanit>/` (checkout, без змін) + `.worktrees/.meta/<sanit>.md` (інвентар, new). Бенчмарк: Rust noop ~10 мс, git worktree list ~11 мс, повний `mt worktree list` (JS) ~63 мс.
