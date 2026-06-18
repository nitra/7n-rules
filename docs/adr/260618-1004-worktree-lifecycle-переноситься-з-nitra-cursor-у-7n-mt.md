---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-18T10:04:35+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

Ось фрагмент транскрипту. Маю достатньо контексту для ADR. Зафіксую три дизайнових рішення:

## ADR Worktree-lifecycle переноситься з @nitra/cursor у @7n/mt

## Context and Problem Statement
Підсистема управління git-worktrees розташовувалась у `@nitra/cursor` (`npm/scripts/worktree-cli.mjs`, `npm/scripts/lib/worktree.mjs`). Інструмент `mt` (пакет `@7n/mt`) вже має власну потребу у worktree-механізмах для task-graph scanner. Було прийнято рішення перенести повний lifecycle до `mt`, а cursor-скіли кличуть `mt` напряму без проміжного шиму.

## Considered Options
* Залишити lifecycle у `@nitra/cursor` (поточний стан)
* Перенести lifecycle у `@7n/mt`, cursor залежить від нього (обрано)

## Decision Outcome
Chosen option: "Перенести lifecycle у `@7n/mt`, cursor залежить від нього", because `mt` вже є власником worktree-контексту для task-graph; це прибирає дублювання між `worktree-cli.mjs` і `lib/commands/worktree.mjs` у mt; `@7n/mt` є опублікованим пакетом без циклічної залежності (cursor → `@7n/mt` рантайм, `mono`-репо → cursor лише devDep).

### Consequences
* Good, because `@nitra/cursor` позбувається `worktree-cli.mjs` / `lib/worktree.mjs` / `skills/worktree/` — усі worktree-скіли кличуть `mt worktree` напряму.
* Bad, because `@nitra/cursor` тепер залежить від `@7n/mt` — загальний тул прив'язаний до конкретного бінарника екосистеми; кожен consumer cursor'а мусить мати `@7n/mt`.

## More Information
Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. Sequencing: mt-реліз `@7n/mt@0.5.0` → міграція cursor. Верифікація: `npx @7n/mt@0.5.0 worktree` повертає `create|remove|list|prune|inventory`.

---

## ADR Rust vs JS для worktree-lifecycle у mt

## Context and Problem Statement
При проєктуванні `mt worktree` постало питання: реалізовувати lifecycle (create/remove/list/prune/inventory) у Rust-крейті `mt-scanner` чи у наявному JS-шарі `lib/commands/`. У `mt-scanner` вже є `sanitize_branch` і `discover_worktrees`. Було проведено бенчмарк.

## Considered Options
* Реалізувати у Rust (`mt-scanner`), викликати через subprocess з JS-wrapper
* Залишити у JS (`lib/commands/worktree.mjs`) — вирівняти наявну реалізацію

## Decision Outcome
Chosen option: "Залишити у JS", because бенчмарк показав: `mt` входить через Node-wrapper (`bin/mt.js` → `runMtCli`), який дає підлогу ~50 мс. Rust-старт ~10 мс + git ~11 мс = ~21 мс native, але через wrapper: Node ~35 мс + spawn Rust ~10 мс + git = ~70+ мс — **повільніше** за JS (~63 мс). Git-операції I/O-bound; Rust тут нічого не пришвидшує. JS-реалізація є, добре тестується.

### Consequences
* Good, because transcript фіксує очікувану користь: JS-варіант швидший за Rust-через-wrapper (~63 мс проти ~70+ мс); наявний код не потребує портування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Замірялося через `node -e 'const t=process.hrtime.bigint()…'`: Rust noop ~10 мс, `git worktree list` ~11 мс, повний `mt worktree list` (JS) ~63 мс. Бенчмарк дата 2026-06-16.

---

## ADR Ефемерна семантика `mt worktree remove` — гілку видаляти

## Context and Problem Statement
При вирівнюванні контракту `mt worktree remove` виник конфлікт між двома моделями: cursor-worktree-CLI лишав git-гілку після видалення checkout'у, натомість наявний `mt worktree remove` видаляв гілку разом із checkout'ом. Треба було обрати єдину семантику для нового lifecycle.

## Considered Options
* Лишати git-гілку після `remove` (cursor-семантика, `--delete-branch` як опт-ін)
* Видаляти гілку разом із checkout'ом — ефемерна семантика (mt-семантика, обрано)

## Decision Outcome
Chosen option: "Видаляти гілку разом із checkout'ом — ефемерна семантика", because worktree розглядається як ефемерний робочий простір; наявна mt-поведінка відповідає цій моделі, тому її залишено без змін.

### Consequences
* Good, because transcript фіксує очікувану користь: поведінка узгоджена з task-graph-моделлю `mt`, де worktree — тимчасовий контекст виконання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рішення зафіксовано у спеці `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`. Відповідний тест у `npm/lib/commands/worktree.test.mjs` верифікує видалення гілки через `git branch -D`.

---

## ADR `llmFix: true` у `meta.json` — реальний opt-in для LLM-автофіксу

## Context and Problem Statement
Поле `meta.json: llmFix:true` існувало як декларація, але `runLint` в `orchestrate.mjs` його не читав: opportunistic LLM-fix запускався просто на `!readOnly`. Нове правило з LLM-кроком отримало б його ввімкненим за замовчуванням без жодного opt-in — safety-тріаж не забезпечувався кодом.

## Considered Options
* Лишити поточну поведінку (`!readOnly` вмикає fix для всіх правил)
* Провести `llmFix` з `meta.json` через orchestrate → кожне правило-обробник (обрано)

## Decision Outcome
Chosen option: "Провести `llmFix` з `meta.json` через orchestrate", because нові правила не повинні отримувати LLM-fix автоматично; opt-in має бути явним і перевіреним кодом.

### Consequences
* Good, because transcript фіксує очікувану користь: правила без `llmFix:true` отримують detect-only режим навіть за відсутності `--read-only`; `text/meta.json` та `doc-files/meta.json` явно декларують свій opt-in.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/lint/js/orchestrate.mjs` (читає `metaById[id]?.llmFix`, передає в `lint(files, cwd, { readOnly, llmFix })`); `npm/rules/doc-files/js/lint.mjs` (гейт `if (readOnly || !llmFix) return detect`); `npm/rules/text/js/lint.mjs`, `text/lint/lint.mjs`, `text/lint/cspell-fix.mjs` (проводка через `runLintTextSteps`→`runCspellText`); `npm/rules/text/meta.json` (додано `llmFix:true`); `npm/bin/n-cursor.js` (standalone `lint-text` передає `llmFix:true`). Changeset `npm/.changes/260615-1359.md` (`minor/Changed`). Тести 73/73.
