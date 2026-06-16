---
session: fce1d1c2-4217-4a3a-bb26-649747c9653b
captured: 2026-06-16T08:55:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fce1d1c2-4217-4a3a-bb26-649747c9653b.jsonl
---

## ADR cspell-fix: заміна whole-file rewrite на класифікацію з поповненням словника

## Context and Problem Statement
`cspell-fix.mjs` у режимі fix надсилав цілий файл у `llmLintFix` (whole-file JSON rewrite), щоб виправити орфографічні помилки. На практиці ~90% «Unknown word» у репо — це валідні українські слова або технічні терміни, що відсутні у словнику, а не справжні одруки. Емпіричний експеримент на реальних файлах репо показав: 2 з 2 файлів падали з таймаутом (`curl exit 28, 120s`) або помилкою парсингу — через необмежений обсяг output.

## Considered Options
* **(a)** whole-file omlx-апплай через наявний `llmLintFix` (патч відповіді як весь файл JSON)
* **(b)** класифікація слів (`typo` vs `valid`) → валідні слова авто-дописати у `.cspell.json`, одруки — список на рев'ю без авто-виправлення
* **(c)** detect-only, нуль LLM

## Decision Outcome
Chosen option: "**(b) класифікація → .cspell.json**", because варіант (a) операційно зламаний на репо (whole-file output необмежений → таймаут/parse-fail), а ~90% знахідок — кандидати у словник, а не одруки; класифікація дає детермінований безпечний прогрес через `.cspell.json` без мутації вихідного коду.

### Consequences
* Good, because transcript фіксує очікувану користь: 0 таймаутів (проти 2/2 у БУЛО), 1 bounded LLM-виклик на прогін замість до 25, +79/80 валідних слів у `.cspell.json` за перший прогін.
* Bad, because рідкісні справжні одруки (1 з 80 у тесті: `аутейдж`→`аудит` — хибний) не виправляються авто, а виносяться на список для рев'ю.

## More Information
- `npm/rules/text/lint/cspell-fix.mjs`: `unknownWords()` дедуплікує distinct-слова, `appendWordsToDict()` дописує у `.cspell.json#words` sorted+dedup; cap `MAX_CLASSIFY_WORDS = 80`.
- Принцип: **bounded output** — output LLM-виклику не залежить від розміру вхідного файлу (bounded JSON vs whole-file rewrite).
- Changeset: `npm/.changes/260615-1315.md` (minor/Changed).

---

## ADR Спільна цеглина preflightLocalModel у npm/lib/llm.mjs

## Context and Problem Statement
Два правила (`doc-files/js/docgen-files-batch.mjs` та `text/lint/cspell-fix.mjs`) мали ідентичну локальну реалізацію preflight omlx-бекенда: перевірка `N_LOCAL_MIN_MODEL`, `pickBackend`, `omlxHealthCheck` — дубляж логіки memory-guard/down/auth. Спека opportunistic LLM-fix tier передбачала спільну цеглину як передумову масштабування на більше правил.

## Considered Options
* Виносити `preflightLocalModel(model)` у `npm/lib/llm.mjs` як загальний хелпер
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "**спільний preflightLocalModel у lib/llm.mjs**", because це усуває дубляж між docgen і cspell, забезпечує єдину точку зміни memory-guard/down/auth логіки і є частиною контракту «спільне ядро + per-rule стратегія» зі спеки.

### Consequences
* Good, because transcript фіксує очікувану користь: обидва правила прибрали локальний `preflightProblem` і тепер кличуть `preflightLocalModel(model)` з `lib/llm.mjs`; 134/134 тести пройшли після оновлення мока `healthMock → preflightLocalModel`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/lib/llm.mjs`: новий `export function preflightLocalModel(model)` — повертає `string|null`.
- `npm/rules/doc-files/js/docgen-files-batch.mjs`: `preflightProblem()` видалено, call-site замінено на `preflightLocalModel(DEFAULT_LOCAL_MODEL)`.
- `npm/rules/text/lint/cspell-fix.mjs`: аналогічно.
- Changeset: `npm/.changes/260615-1344.md` (patch/Changed).

---

## ADR Дротування meta.json: llmFix через orchestrate — єдиний safety opt-in

## Context and Problem Statement
Поле `meta.json: llmFix:true` у правилах було **декоративним**: `runLint` у `orchestrate.mjs` не читало прапор і передавало fix-можливість просто на `!readOnly`. Тобто нове правило з LLM-fix-кроком отримало б його ввімкненим за замовчуванням, що порушує safety-тріаж зі спеки.

## Considered Options
* Читати `llmFix` з `meta.json` в `runLint` і передавати у `lint(files, cwd, { llmFix })`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "**читати llmFix з metaById і пробрасувати в lint()**", because тільки явний opt-in через meta забезпечує safety-тріаж: правила без `llmFix:true` лишаються detect-only незалежно від прапору `--read-only`.

### Consequences
* Good, because transcript фіксує очікувану користь: `orchestrate.mjs` читає `metaById[id]?.llmFix`, передає у `lint`; `doc-files/js/lint.mjs` і `text/lint/lint.mjs` гейтують LLM-fix на `llmFix`; новий тест «без llmFix → detect-only, генерацію не чіпаємо» пройшов.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/lint/js/orchestrate.mjs`: `const llmFix = Boolean(metaById[id]?.llmFix)` → `mod.lint(files, cwd, { readOnly, llmFix })`.
- `npm/rules/text/meta.json`: додано `"llmFix": true`.
- `npm/rules/doc-files/meta.json` вже мав `llmFix: true`.
- Changeset: `npm/.changes/260615-1359.md` (minor/Changed).
- Попутньо виявлена pre-existing помилка `no-unsanitized/method` на HEAD (`orchestrate.mjs:118`, динамічний `import(lintPath)`) — закрита justified disable з поясненням «lintPath — package-internal, нуль зовнішнього входу».

---

## ADR Перенесення worktree-lifecycle у @7n/mt

## Context and Problem Statement
`n-cursor worktree` (`worktree-cli.mjs` + `lib/worktree.mjs`) реалізовує повний lifecycle: create/list/remove/prune + інвентарний `.md` + dirty-notice. `@7n/mt` (mono-тул, Rust + `@7n/mt` npm) вже має worktree-discovery (`discover_worktrees`, `worktree_matches`) для task-graph, але не має lifecycle-команд. Дублювання логіки, а cursor-скіли завжди запускаються через `n-cursor worktree add` — це некогерентно.

## Considered Options
* Перенести повний worktree-lifecycle у `@7n/mt` (Rust), cursor-скіли кличуть `mt worktree` напряму, `worktree-cli.mjs` видаляється
* Залишити як є
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "**повний перенос lifecycle у @7n/mt, cursor → залежить від @7n/mt**", because mt уже є природним домом для worktree-операцій (discovery там), cursor-спіли завжди потребують lifecycle і мають вшитий preflight-снипет, а виданий `@7n/mt` npm-пакет дозволяє залежність без циклу.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина реалізація lifecycle, discovery+lifecycle в одному місці, cursor звільняється від власного git-шим.
* Bad, because `@nitra/cursor` (загальний тул) набуває coupling до `@7n/mt` (конкретний бінарник); кожен консумер cursor матиме `@7n/mt` у deps.

## More Information
- Цільове іменування: `mt worktree create <branch> "<desc>"` | `list` | `remove <branch> [--force]` | `prune` | `inventory` (JSON для task-graph). Аліасів для зворотної сумісності не буде.
- Layout: checkout `.worktrees/<sanit>/`, інвентар переноситься у `.worktrees/.meta/<sanit>.md` (чистий підкаталог, discovery тривіальний).
- Sequencing: спершу publish `@7n/mt` з worktree-lifecycle, потім міграція cursor.
- Спека: `docs/specs/2026-06-16-worktree-lifecycle-to-mt.md`.
- Поточний контракт JS: `npm/scripts/worktree-cli.mjs`, `npm/scripts/lib/worktree.mjs` (sanitizeBranch, firstFreeBranch, buildDescription, buildDirtyNotice, findOrphanDescFiles — чисті функції, детерміновані порти у Rust).
