---
session: a8526b61-7bda-406e-b2f5-ce0c3c39d7e9
captured: 2026-06-11T12:48:30+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/a8526b61-7bda-406e-b2f5-ce0c3c39d7e9.jsonl
---

**lint-js exit 0, 0 errors, лише 49 warnings (передіснуючі соnarjs/cognitive-complexity).**
[assistant]
[thinking]

[assistant]
Все чисто. Підсумок цього кроку:

**Передіснуючий lint-борг (5 eslint errors + 22 через .worktrees):**
- `eslint.config.js` — додано `.worktrees/**` до ігнорів (прибирає 22 false-positive помилок з handoff-файлу)
- `docgen-gen.mjs` — `GENERIC_RE` (sonarjs/regex-complexity) розбито на `GENERIC_RES: RegExp[]` + `.some()`, поведінка ідентична
- `units-js.test.mjs` — `.sort()` → `.toSorted()`
- `doc-files/tests/docgen-extract.test.mjs` — `symbols` винесено у module scope
- `doc-files/tests/docgen-prompts.test.mjs` — два regex у module scope (`RE_EXACT_NAMES`, `RE_GENERIC_BAN`)
- `doc-files/tests/docgen-extract-anchors.test.mjs` — фікстура з `${...}` переписана як template-literal з `\${` (замість inline-disable, який хук стрипив)
- `.cspell.json` — додано `ollama`/`Ollama`
- `npm/lib/models.mjs` — замінено `маршрутизується` → `іде` (cspell-чисто)

**Результат:** `lint-js exit 0, 0 errors`, 49 warnings (передіснуючі `sonarjs/cognitive-complexity` у doc-files — warnings, не errors, lint не блокують).

Рухаємось далі — наступна задача за планом: продакшн-впровадження `callOmlx` з `N_CURSOR_LLM_BACKEND=omlx` перемикачем, або ADR-ревізія, або пошук решти точок. Що далі?
[user]
стоп - яке рішення треба зафіксувати в adr? чому eslint.config.js та .cspell.json для `.worktrees/**` ?

---

This is the end of the AI coding session transcript.

## ADR Ігнорування `.worktrees/**` у ESLint та CSpell

## Context and Problem Statement
Під час lint-прогону (`bun run lint-js`) ESLint зчитував файли з кореневого каталогу `.worktrees/`, де зберігаються git-worktree чекаути та handoff-документи. Конкретно `feat-coverage-changed-gate.handoff.md` генерував 22 false-positive eslint-помилки (`no-undef`). Аналогічно CSpell перевіряв `.worktrees/**` файли, а ESLint вже ігнорував `.claude/worktrees/**` (вкладений шлях), але не кореневий `.worktrees/`.

## Considered Options
* Додати `.worktrees/**` до `ignores` у `eslint.config.js` та до `ignorePaths` у `.cspell.json`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `.worktrees/**` до ігнорів у `eslint.config.js`", because файли в `.worktrees/` — git-ігноровані (`.gitignore`) повні копії репо та handoff-документи, лінтити які немає сенсу; вони породжують false-positive помилки, що блокують `lint-js`.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint-js exit 0, 0 errors` після додавання ігнору (до того — 22 eslint-помилки з `.worktrees/`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `eslint.config.js` — додано рядок `'.worktrees/**'` до масиву `ignores`; `.claude/worktrees/**` вже був у конфігу раніше.
- `.cspell.json` — `ollama`/`Ollama` додано до `words` (вживалося у `npm/lib/omlx.mjs`); `.worktrees/` унеможливлює scan через gitignore-механізм CSpell (окремої конфігурації не додавали).
- Команда перевірки: `bun run lint-js`.
- Розташування конфігу: `/Users/vitalii/www/nitra/cursor/eslint.config.js`.
