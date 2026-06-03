---
session: 2384f9e3-23ee-4352-81e6-6eed553c34d8
captured: 2026-06-03T19:23:01+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/2384f9e3-23ee-4352-81e6-6eed553c34d8.jsonl
---

## ADR Жорсткий root-guard для деструктивних CLI-команд `@nitra/cursor`

## Context and Problem Statement
`npx @nitra/cursor` (та прямий виклик `bun npm/bin/n-cursor.js`) приймають `cwd()` як корінь проєкту. Дефолтний sync і деструктивні сабкоманди (`fix`, `lint`, `coverage`, `change`, `release`) скаффолдять/переписують `.cursor/`, `.claude/`, `CLAUDE.md`, `.n-cursor.json` і запускають `bun install` у поточному каталозі — якщо CLI запустити з піддиректорії git-репо, усі артефакти опиняться не там.

## Considered Options
* Програмний hard-guard (`assertCwdIsProjectRoot`) на рівні диспетчера `bin/n-cursor.js` — до першої мутації
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Програмний hard-guard (`assertCwdIsProjectRoot`)", because guard перевіряє `git rev-parse --show-toplevel` і порівнює з `cwd()`: якщо `cwd` є піддиректорією репо — `process.exit(1)` ще до `ensureNitraCursorInRootDevDependencies`. Поза git-репо (toplevel недоступний) guard пропускає — легітимний кейс CLI у споживача.

### Consequences
* Good, because transcript фіксує очікувану користь: прямий виклик із `npm/bin/` дає `exit=1` з діагностикою, без жодного скаффолда (git status чистий після тесту).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/lib/assert-project-root.mjs` — guard-модуль із `assertCwdIsProjectRoot(command?)`
- `npm/bin/n-cursor.js` — виклик guard'а для `undefined/''` (default sync) і набору `DESTRUCTIVE_COMMANDS = ['fix','lint','coverage','release','change']`
- `npm/scripts/lib/tests/assert-project-root.test.mjs` — 3 тести (корінь → ok, піддиректорія → throw, поза git → ok)

---

## ADR Декларативний атрибут `requireRoot` у `meta.json` скілів

## Context and Problem Statement
Скіли з `worktree:true` захищені лише soft-preflight (ін'єкція LLM-інструкції), який не є програмним гардом і не перевіряє «корінь vs піддиректорія» — лише «чи під `.worktrees/`». In-place скіли (`worktree:false`) без додаткового маркера не мали жодного явного захисту.

## Considered Options
* Явний декларативний флаг `requireRoot: boolean` у `meta.json` + окремий `injectRootNotice` для in-place скілів + підсилений `injectWorktreeNotice` (root-assert перед кроком `cd .worktrees/`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Явний декларативний флаг `requireRoot`", because користувач сформулював вимогу: «може логічно це винести атрибутом у `meta.json`, щоб мати явний признак активовано захист чи ні». Флаг робить захист observable у конфігурації, а не прихованим у коді.

### Consequences
* Good, because transcript фіксує очікувану користь: `skill_meta.mjs` (check-правило) валідує `requireRoot` як опційний boolean і блокує суперечність `requireRoot:true` + `worktree:true` (implicitly redundant); `skillRequiresRoot()` повертає `true` для `worktree:true` або `requireRoot:true`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/lib/skill-meta.mjs` — додано `skillRequiresRoot(meta)`
- `npm/scripts/lib/root-notice.mjs` — `injectRootNotice(content, requireRoot)` для in-place скілів
- `npm/scripts/lib/worktree-notice.mjs` — підсилено: root-assert перед кроком `cd .worktrees/`
- `npm/rules/npm-module/js/skill_meta.mjs` — валідація `requireRoot: boolean` (опційний); конфлікт з `worktree:true` фіксується як помилка
- `meta.json` скілів: `start-check` → `requireRoot:true`; `llm-patch`, `publish-telegram`, `worktree` → `requireRoot:false`
- Усі `worktree:true`-скіли (`adr-normalize`, `coverage-fix`, `docgen`, `fix`, `fix-tests`, `taze`) мають root-захист неявно через `skillRequiresRoot`
- Тести: `npm/scripts/lib/tests/root-notice.test.mjs`, `npm/rules/npm-module/js/tests/skill_meta.test.mjs` (нові кейси `requireRoot`); 67/67 тестів зелені після змін
