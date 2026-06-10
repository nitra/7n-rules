# `.worktrees/` гарантовано gitignored через окремий sync-крок

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

`n-cursor worktree add` створює каталог `.worktrees/<name>/` та супутні локальні файли (інвентарний `.md`, `.flow.json`, `.events.jsonl`), але не гарантувала наявність рядка `.worktrees/` у `.gitignore`. У репо без цього рядка worktree-артефакти вилізали в `git status` як untracked, а інвентарний `.md` можна було випадково закомітити.

## Considered Options

* A. Lazy via `worktree add` — дописувати `.worktrees/` у `.gitignore` безпосередньо в команді `worktree add` (`worktree-cli.mjs`)
* B1. Eager sync-крок безумовно — окремий top-level `runSyncStep` у `npm/bin/n-cursor.js` при кожному `npx @nitra/cursor` sync
* B2. Eager sync-крок з гейтом за worktree-rule у `.n-cursor.json` (за симетрією з adr-фрагментом)

## Decision Outcome

Chosen option: "B1 — окремий sync-крок, безумовно", because гейт за worktree-rule (B2) розриває звʼязок між продюсером (`n-cursor flow`/CLI, `alwaysApply: true`) і гарантією ignore: можна вимкнути worktree-rule, але `flow init` далі створює `.worktrees/` без ignore-рядка. Варіант A вводить паралельну gitignore-механіку поза наявною конвенцією sync і спрацьовував би лише через CLI, а не через `npx @nitra/cursor`. Sync-крок лягає в існуючий протестований патерн (`ensureGitignoreEntries`, append-only, idempotent) і не змішує концерни `syncClaudeConfig` (Claude-конфіг-бандл) із ортогональним worktree-концерном.

### Consequences

* Good, because `.worktrees/` гарантовано gitignored з першого `npx @nitra/cursor`, незалежно від тумблерів правил і без ручного рядка в `.gitignore`.
* Good, because `ensureGitignoreEntries` — idempotent: якщо рядок уже є, виконується no-op без побічних ефектів.
* Bad, because у репо, де worktree ніколи не використовується, sync дописує один зайвий ignore-рядок — нешкідливий no-op, але не нульовий side-effect.

## More Information

- Новий модуль: `npm/scripts/lib/sync-gitignore-worktree.mjs` + тести `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs`
- Точка вмонтування: `npm/bin/n-cursor.js`, `runSync()`, окремий `runSyncStep` після блоку Claude-конфіг (~рядок 1435)
- Базова утиліта: `npm/scripts/utils/ensure-gitignore-entries.mjs` (`ensureGitignoreEntries(cwd, entries, sectionLabel)` → `{ added: string[] }`)
- Зразок повернення: прапор `gitignoreWorktree: boolean` у звіт (за зразком `gitignoreAdr`)
- Коміт: `e0f5e52` у гілці `feat-worktree-gitignore`; реліз: `@nitra/cursor@3.9.0`
- Рядки `.gitignore` у корені репо: рядок 9 — `.claude/worktrees/`, рядок 10 — `.worktrees/`
- Правило `n-flow.mdc`: `alwaysApply: true` — продюсер `.worktrees/`-артефактів активний завжди незалежно від конфігурації правил

## Update 2026-06-01

Деталі щодо розміщення sync-кроку і умов гейтингу:

**Чому не всередині `syncClaudeConfig`**: функція `syncClaudeConfig` (`npm/scripts/sync-claude-config.mjs`) має ранній `return` при `claude-config: false`. Вкладення `.worktrees/`-кроку всередину призвело б до дірки — репо з вимкненим claude-config не отримувало б ignore-рядка, хоча `flow` від claude-config не залежить. Кожен `runSyncStep` — один концерн; нема прихованого зчеплення через опт-аут.

**Чому гейт за worktree-rule (B2) відхилено**: продюсер артефактів `.worktrees/` — `flow` (`alwaysApply: true`) і `worktree-cli`, активні незалежно від worktree-rule. ADR-фрагмент коректно гейтується, бо продюсер (adr Stop-hook) і гейт (adr-rule) — та сама сутність; для worktree ця симетрія не виконується.

Ключові файли: `npm/bin/n-cursor.js` (`runSync`, `runSyncStep`), `npm/scripts/sync-claude-config.mjs` (ранній return при `claude-config: false`), `npm/scripts/utils/ensure-gitignore-entries.mjs`.

## Update 2026-06-01

### Відхилені варіанти та обґрунтування вибору b1

Додатково розглядалися:
- **A (lazy)** — `ensureGitignoreEntries()` у `worktree add` CLI в момент створення каталогу; відхилено як неповне (не покриває `flow init` та інші продюсери).
- **B2 (gated)** — sync-крок, гейтований за наявністю worktree-правила в `.n-cursor.json`; відхилено: вимкнене правило + активний `flow` залишає дірку.
- **Вмонтування всередині `syncClaudeConfig()`** — відхилено: функція має ранній `return` при `claude-config: false`, що ховало б запис; неправильне змішування концернів.

Обраний **b1** (окремий безумовний sync-крок): продюсер `.worktrees/` (`n-flow.mdc: alwaysApply: true`) завжди активний; гейт за тумблером розсинхронив би виробника і `.gitignore`. Утиліта `ensureGitignoreEntries()` вже існувала і є idempotent — інтеграція коштувала один виклик.

### Деталі реалізації

- Новий модуль: `npm/scripts/lib/sync-gitignore-worktree.mjs` (обгортка над `ensureGitignoreEntries`)
- Тести: `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` (4 тести: fresh-repo, idempotency, append-only, existing gitignore)
- Spec: `docs/specs/2026-06-01-worktree-add-gitignore.md`
- Plan: `docs/plans/2026-06-01-worktree-add-gitignore.md`
- Коміт: `e0f5e52 feat(sync): гарантувати .worktrees/ у .gitignore під час sync`
- Базова утиліта: `npm/scripts/utils/ensure-gitignore-entries.mjs` (idempotent append-only з header-коментарем; також використовується для Stryker temp-каталогів)

## Update 2026-06-01

### Реалізація

Коміт реалізації: `e0f5e52 feat(sync): гарантувати .worktrees/ у .gitignore під час sync`. Spec: `docs/specs/2026-06-01-worktree-add-gitignore.md`; Plan: `docs/plans/2026-06-01-worktree-add-gitignore.md`. Тести: `npm/scripts/lib/tests/sync-gitignore-worktree.test.mjs` — 4 кейси (fresh repo → `written: true`; idempotency; append-only зі збереженням кастомного вмісту; `written` boolean у return).

### Відмова від гейтингу за worktree-правилом

Під час дизайну розглядалося умовне дописування `.worktrees/` у `.gitignore` лише коли worktree-правило увімкнено у `.n-cursor.json` — аналогія з `gitignoreAdr` у `sync-claude-config.mjs` (`const includeAdrHook = ... rules.includes('adr')`). Відхилено на користь безумовного кроку (b1).

**Причина:** для `adr` гейт коректний — продюсер (ADR Stop-hook) і тумблер — одна сутність; якщо правило вимкнено, артефактів нема. Для worktree продюсер (`flow init` / `worktree-cli`) є `alwaysApply: true` і незалежний від worktree-rule — гейт за правилом розсинхронізував би ігнорування з реальним продюсером.

Наслідки: репо, де worktree-rule вимкнено але `flow init` використовується, не отримує брудний `git status`. Репо без worktree — несе один зайвий ignore-рядок (idempotent noop).

## Update 2026-06-01

Деталі реалізації та обґрунтування безумовного запису (b1 vs b2):

Новий модуль `npm/scripts/lib/sync-gitignore-worktree.mjs` — тонка обгортка над `ensureGitignoreEntries` з одним патерном `.worktrees/`. Підключений як окремий `runSyncStep` у `n-cursor.js` (сусід `syncClaudeConfig`), а не всередині неї (яка має ранній `return` при `claude-config: false` — це відʼєднало б запис від реального продюсера). Звіт: `'.gitignore (worktree)'`.

**b1 (безумовно) vs b2 (гейт за `rules.includes('worktree')`):** обрано b1, бо продюсер `.worktrees/` — це `flow` (`n-flow.mdc`, `alwaysApply: true`) і `worktree-cli`, незалежні від rule-тумблерів. Гейт b2 міг розсинхронізувати продюсента й ignore-рядок: вимкнення worktree-rule → рядок зникає, але `flow init` далі створює `.worktrees/` → повертається dirty-status проблема. Для `adr` гейт коректний (продюсер і гейт — одна сутність); для `flow` — ні. Мінус b1: репо без worktree-usage отримує зайвий рядок у `.gitignore` — нешкідливий no-op.

Ідемпотентність: якщо рядок вже є — no-op. Коміт `e0f5e52`. Файли: `npm/scripts/lib/sync-gitignore-worktree.mjs` (новий, 4 тести), `npm/bin/n-cursor.js`.
