---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T08:31:40+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR `n-cursor worktree` — кросплатформний CLI для git-worktree

## Context and Problem Statement
Команда використовує `git worktree`, але ніякого єдиного інструменту для виконання конвенції `.worktrees/<sanitized>/` + інвентарного `.md`-файлу не існувало. Агентські сесії дублювали одне й те саме рішення у різних spec-файлах паралельно.

## Considered Options
* Кросплатформний CLI `n-cursor worktree add/remove/list/prune` з санітизацією слеша і примусовим `.md`-описом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`n-cursor worktree add/remove/list/prune`", because ця форма узгоджена з існуючою командою CLI, дозволяє одноманітне виконання конвенції `.worktrees/<sanitized>/`, й `feat/demo` → `.worktrees/feat-demo/` зберігає ієрархію без вкладення каталогів.

### Consequences
* Good, because transcript фіксує очікувану користь: CLI гарантує правильне розташування (`.worktrees/`), опис обовʼязковий (G1), слеш у гілці перетворюється на дефіс, smoke-тест пройшов (`add`, `list`, `remove`, `prune`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано: `npm/scripts/lib/worktree.mjs` (чиста логіка `sanitizeBranch`, `worktreePaths`, `buildDescription`, `findOrphanDescFiles`), `npm/scripts/worktree-cli.mjs` (оркестратор), `case 'worktree'` у `npm/bin/n-cursor.js`. Тести: 9 unit + 6 CLI тестів. Коміт `8227d43` (чиста логіка), `f675d8a` (CLI), `5a779a1` (диспетчер). Spec: `docs/superpowers/specs/2026-05-31-worktree-cli-design.md`.

---

## ADR Правило `worktree` — pure-doc (J1), нормалізація сироти

## Context and Problem Statement
`n-worktrees.mdc` існував лише в `.cursor/rules/` без канонічного джерела в `npm/rules/worktree/`, порушуючи інваріант пакету: `discoverBundledRuleNames` не знав про нього і міг видалити його при наступному sync.

## Considered Options
* **J1 — pure-doc**: створити `npm/rules/worktree/worktree.mdc` як документацію конвенції, без programmatic check
* **J2 — doc + programmatic check**: додатково валідувати структуру `.worktrees/` (наявність `.md`, відсутність осиротілих), дзеркалюючи `prune`-логіку CLI

## Decision Outcome
Chosen option: "J1 — pure-doc", because CLI інструмент вже гарантує правильне розташування; окремий `check` дублював би гарантії, які дає сам tool. YAGNI — `check` структури worktree має сенс пізніше, якщо worktree почнуть створювати повз CLI.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-worktree.mdc` тепер керується sync, `npm/rules/worktree/worktree.mdc` є каноном, `.n-cursor.json` містить `"worktree"` у `rules`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Коміт `f0c3e6c` (видалення сироти), `d443126` (канонічне джерело + sync). `CLAUDE.md` оновлено: `@.cursor/rules/n-worktrees.mdc` → `@.cursor/rules/n-worktree.mdc`. `skill_meta` check виходить з кодом 0 (включно з новим скілом `worktree`).

---

## ADR Spec B — схема `meta.json` для правил (4 форми `auto`, glob-уніфікація)

## Context and Problem Statement
Автодетект правил у `auto-rules.mjs` був жорстко захардкований: `AUTO_RULE_ORDER` (28 елементів), `AUTO_RULE_DEPENDENCIES`, `autoRuleChecks[]`, мертві `auto.md`-файли (29 шт.). Паралельна міграція skills вже перевела їх на data-driven `meta.json`; треба те саме зробити для правил.

## Considered Options
* **G1 — повний data-driven**: 4 форми `auto` у `meta.json` (`"завжди"` / `["rule"]` / `{glob}` / `{predicate,arg}`), реєстр предикатів у коді, порядок і залежності виводяться з даних
* Інші варіанти в transcript не обговорювалися (обрано G1 у попередньому brainstorming, підтверджено в цій сесії).

## Decision Outcome
Chosen option: "G1 — повний data-driven з 4 формами `auto`", because це усуває дублювання між хардкодом і `auto.md`, дзеркалить вже впроваджену архітектуру skills, і дозволяє порядок та залежності виводити автоматично замість ручного підтримання масивів.

### Consequences
* Good, because transcript фіксує очікувану користь: видалення 29 `auto.md`, прибирання хардкод `AUTO_RULE_ORDER`/`AUTO_RULE_DEPENDENCIES`, увімкнення `tauri`-автодетекту (раніше `auto.md` існував, але не підключався до детекту).
* Bad, because Task 4 переписує ядро `auto-rules.mjs` — головний ризик регресії; 45 тестів `auto-rules.test.mjs` служать контрактом.

## More Information
Spec: `docs/superpowers/specs/2026-05-31-rule-meta-json-design.md`. Plan: `docs/superpowers/plans/2026-05-31-rule-meta-json.md` (9 задач, 1170 рядків). Ключові рішення: Type A → єдина glob-форма (масив замість brace-expr, щоб не покладатись на `globToRegex` brace-підтримку); `globToRegex` береться з `npm/rules/npm-module/js/package_structure.mjs:374`; 6 предикатів у реєстрі: `repoUrlMarker`, `depInAnyPackageJson`, `gqlTaggedTemplate`, `hasuraConfigMarker`, `jsBunDbSignal`, `nestedPackageWithoutVite`; цикл імпортів розривається через `rule-meta-helpers.mjs`.

---

## ADR `tauri` — увімкнути автодетект (раніше мертвий)

## Context and Problem Statement
`npm/rules/tauri/auto.md` існував із умовою `@tauri-apps/api`, але `detectAutoRules` ніколи не виконував цей check (tauri не було підключено до `autoRuleChecks[]` у коді). Правило було доступне лише вручну через `.n-cursor.json`.

## Considered Options
* Увімкнути автодетект `tauri` через `meta.json` з предикатом `depInAnyPackageJson`
* Лишити `tauri` opt-in (без `auto` в `meta.json`)

## Decision Outcome
Chosen option: "Увімкнути автодетект", because `auto.md` вже декларував умову (`@tauri-apps/api`), тобто намір активації існував — просто ніколи не реалізовувався. Міграція на `meta.json` — природний момент виправити це.

### Consequences
* Good, because transcript фіксує очікувану користь: правило тепер активується автоматично для `@tauri-apps/api`-проєктів.
* Neutral, because transcript не містить підтвердження наслідку для наявних репозиторіїв, що мають `@tauri-apps/api` (вони не перевірялись).

## More Information
`npm/rules/tauri/meta.json`: `{ "auto": { "predicate": "depInAnyPackageJson", "arg": ["@tauri-apps/api"] } }`. Тест у `auto-rules.test.mjs` Task 5: `'tauri'` додається до `ALL_RULES`, новий кейс детекту через `dependencies`.
