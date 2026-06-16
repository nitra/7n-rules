# Перенесення worktree-lifecycle з @nitra/cursor у @7n/mt — дизайн-спека

Дата: 2026-06-16
Власник: @vitaliytv
Статус: Draft — дизайн узгоджено; реалізація = JS-вирівнювання наявного `mt worktree` (бенчмарк JS vs Rust 2026-06-16 → JS). worktree ефемерний.

## Мотивація

worktree-керування зараз живе в `@nitra/cursor` (`scripts/worktree-cli.mjs` + `lib/worktree.mjs`, команда `n-cursor worktree`). Водночас `@7n/mt` (Rust task-graph тул) уже **читає** активні worktree (`discover_worktrees`, `worktree_matches`) як сигнал стану задач. Логіка роздвоєна: створення — JS у cursor, спостереження — Rust у mt.

Рішення: **`@7n/mt` стає власником повного worktree-lifecycle** (create/list/remove/prune/inventory, Rust), а `@nitra/cursor` лише **спирається** на нього — скіли кличуть `mt worktree` напряму. Це усуває дублювання й дає mt єдине джерело правди про worktree (lifecycle + discovery в одному місці).

## Напрям залежності (узгоджено — циклу немає)

- `@nitra/cursor` → додає `@7n/mt` у `dependencies` (+ платформні `@7n/mt-{os}` як `optionalDependencies`, esbuild-патерн). Консумер дістає бінарник `mt` на `bun install`.
- `@7n/mt` (опублікований пакет) **не** має `@nitra/cursor` у рантайм-deps; його використання cursor — лише dev-синк правил у репо `mono`.
- Тому: `@nitra/cursor` → `@7n/mt` (рантайм) і `mono`-репо → `@nitra/cursor` (devDep) — різні рівні, **не цикл**.
- Прийнятий trade-off: cursor — загальний тул; кожен його консумер тепер тягне `@7n/mt` (приймаємо як базовий примітив екосистеми).

## Командний контракт `mt worktree`

Без зворотної сумісності (рішення): команди іменуємо правильно, аліасів немає.

| Команда | Поведінка |
|---|---|
| `mt worktree create <branch> "<desc>"` | `git worktree add .worktrees/<sanit> -b <branch>` від HEAD; інвентар `.worktrees/.meta/<sanit>.md`; collision → `firstFree`; dirty-notice про незакомічені зміни основного дерева |
| `mt worktree list` | `git worktree list` + вміст інвентарів |
| `mt worktree remove <branch>` | прибрати checkout + інвентар + **git-гілку** (worktree ефемерний — рішення) |
| `mt worktree prune` | `git worktree prune` + видалити осиротілі інвентарі |
| `mt worktree inventory` | машинний (JSON) стан worktree для task-graph (об'єднує з наявним `discover_worktrees`) |

`desc` для `create` — **обовʼязковий** (як зараз).

## Layout `.worktrees/` (правильно та ефективно)

- **Checkout:** `.worktrees/<sanit>/` — **без змін** (скіли `cd .worktrees/<sanit>` лишаються чинні).
- **Інвентар:** `.worktrees/.meta/<sanit>.md` — винесено з плаского простору (зараз sibling `.worktrees/<sanit>.md`).
- Наслідок: `.worktrees/` містить **лише** worktree-каталоги + один `.meta/`. Discovery (`list`/`prune`/scanner) = «кожен підкаталог крім `.meta` — worktree». Осиротілі = `.meta/*.md` без відповідного `.worktrees/<name>/`.
- `.worktrees/` лишається gitignored (`syncGitignoreWorktree` у cursor — без змін).

## Поведінка, яку зберігаємо 1:1 (порт у Rust)

Чисті функції з `lib/worktree.mjs` → Rust (mt уже має частину: `sanitizeTaskName`, `discover_worktrees`):
- `sanitizeBranch`: trim → `[^a-zA-Z0-9._-]+` у `-` → обрізати краєві `-`; порожнє → помилка. Git-гілка лишає slash, шлях — sanitized.
- `firstFreeBranch`: зайнято (git-гілка АБО checkout-каталог існує) → `base`, `base2`, `base3`… (стеля 1000).
- `buildDescription`: інвентар-`.md` (заголовок=branch, `**Задача**`/`**Дата**`/`**База (коміт)**`, hint на remove — оновити на `mt worktree remove`).
- `buildDirtyNotice`: `git status --porcelain` основного дерева ДО створення; ≤10 файлів — перелік, більше — лише кількість.
- `findOrphanDescFiles`: інвентарі без зареєстрованого checkout.
- worktree завжди від **HEAD** (не від брудного стану).

## Реалізація mt — JS (вирівнювання наявного), НЕ Rust

**Відкриття:** mt **уже має** `mt worktree add|remove|list` (JS: `lib/commands/worktree.mjs`, config-driven `resolveWorktreesDir`, `sanitizeBranch` синхр. з Rust `sanitize_branch`). Завдання — **вирівняти**, не писати з нуля.

**Бенчмарк JS vs Rust (2026-06-16):** `mt` входить через Node-wrapper `bin/mt.js` (підлога ~50 мс, неминуча). Повний `mt worktree list` (JS) ≈ **63 мс**; Rust-lifecycle через той самий wrapper додав би spawn (~10 мс) → **~70+ мс, повільніше**. Rust-native (~21 мс) вимагав би викинути Node-wrapper для всього CLI — окрема велика ініціатива. git-op (~11 мс) і Rust-старт (~10 мс) затьмарені Node-стартом. **Висновок: worktree-логіка лишається у JS** (швидше за поточної архітектури + вже реалізовано).

**Обсяг вирівнювання `commands/worktree.mjs`:**
- `add` → `create`;
- додати `prune` (git prune + видалити осиротілі інвентарі) і `inventory` (JSON стан для task-graph, поверх `discover_worktrees`);
- інвентар → `.meta/` layout;
- `firstFreeBranch` (колізія → base2/base3…);
- dirty-notice з переліком ≤10 файлів (замість загального warning);
- `remove` — **лишається ефемерним** (видаляє гілку), як зараз.

## Міграція cursor

**Видалити:**
- `scripts/worktree-cli.mjs`, `lib/worktree.mjs` + їхні тести (`scripts/tests/worktree-cli.test.mjs`, `lib/tests/worktree.test.mjs`);
- `case 'worktree'` + `runWorktreeCli`-import у `bin/n-cursor.js` (+ рядок у шапці/`default`-помилці);
- скіл-пакет `skills/worktree/` (логіка тепер у mt) — або лишити тонкий скіл, що документує `mt worktree`? (див. відкрите).

**Перемкнути на `mt worktree`:**
- інжектований preflight-снипет `n-cursor:worktree:start` у `lib/worktree-notice.mjs`: `npx @nitra/cursor worktree add …` → `mt worktree create …`; bootstrap = `bun install` (тягне `@7n/mt`) → `mt worktree create` (retry-обгортка ETARGET прибрана — це бінарник, не npx-резолв);
- правило `rules/worktree/worktree.mdc` — на `mt worktree`;
- `skills/worktree/SKILL.md` (якщо лишаємо) — на `mt worktree`.

**Лишити без змін:**
- `syncGitignoreWorktree` (`.worktrees/` gitignored);
- `injectWorktreeNotice` як механізм інжекту (міняється лише вміст снипета).

**Залежність:**
- `@7n/mt` у `dependencies` + `@7n/mt-{darwin-arm64,linux-x64}` у `optionalDependencies`;
- аналог `ensureNitraCursorInRootDevDependencies` — переконатись, що `@7n/mt` є в консумера (або документувати в правилі).

## Sequencing (узгоджено)

1. **mt:** вирівняти наявний JS `mt worktree` (create/prune/inventory/.meta/firstFree/dirty-notice) + тести; **опублікувати** `@7n/mt` із новим контрактом.
2. **cursor:** піднятись на опубліковану версію `@7n/mt`; видалити worktree-CLI/lib/тести/bin-команду; перемкнути снипет/правило/скіл; додати залежність. **Major bump** (breaking: `n-cursor worktree` зникає).
3. Консумери (включно з `mono`/mt) — синк підтягне нову проводку + `bun install` дасть `mt`.

## Тестування

- mt: юніт чистих функцій (sanitize/firstFree/description/dirty/orphan); інтеграція create→list→remove→prune на tmp-репо.
- cursor: оновити/прибрати worktree-тести; перевірити інжект снипета (worktree-notice тест) із новим вмістом; smoke синку.

## Рішення (закриті питання)

- **Доля `skills/worktree/`:** **прибрати зовсім** — worktree стає mt-командою, не cursor-скілом. Конвенцію worktree-only-скілів несуть `worktree.mdc` + інжектований снипет; окремий скіл — зайвий шар. Прибрати також `skill list` згадку й синк-логіку для нього (skills-масив у `.n-cursor.json` консумерів).
- **Розповсюдження `mt`:** підтверджено — через npm optionalDependencies (платформні `@7n/mt-{os}`).
