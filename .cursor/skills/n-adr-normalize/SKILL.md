---
name: n-adr-normalize
description: >-
  Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного
  батчу чернеток через LLM, перегляд результату через git diff
version: '1.0'
---

<!-- n-cursor:worktree:start -->
> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-adr-normal/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-adr-normal`. Суфікс `adr-normal` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
```

**Root-assert.** Якщо `pwd` **не** збігається з виводом `git rev-parse --show-toplevel` — ти в **піддиректорії** робочого дерева (worktree-шляхи нижче відносні до кореня репо). Спершу перейди в корінь: `cd <toplevel>` (literal-шлях із виводу), і лише тоді продовжуй preflight. Не створюй worktree з піддиректорії — `cd .worktrees/<…>` звідти впаде.

Якщо `git rev-parse --show-toplevel` показав, що ти **не** в `.worktrees/`, візьми вивід `git branch --show-current` як `<current-branch>` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка `feature/x`:

```bash
npx @7n/mt worktree create "feature/x-adr-normal" "n-adr-normal: worktree-only skill"
cd ".worktrees/feature-x-adr-normal"
```

Тобто branch-argument лишає slash як у git-гілці, а шлях для `cd` бере sanitized форму: slash → `-`.

**Крок 0.1 — bootstrap у новому дереві (після `cd`).** Дерево щойно створене й **без** `node_modules`. Постав залежності локально — тоді `npx @nitra/cursor <cmd>` бере локальну копію без походу в реєстр:

```bash
bun install
```
<!-- n-cursor:worktree:end -->

# n-adr-normalize — ручна нормалізація ADR-чернеток

Скіл запускає `.claude/hooks/normalize-decisions.sh` поза звичайним Stop-hook-тригером. Корисно, коли:

- Поріг `ADR_NORMALIZE_THRESHOLD` ще не досягнуто, але хочеш почистити inbox.
- Минулого разу LLM відмовився, тепер минув ще не весь `ADR_NORMALIZE_MIN_INTERVAL_HOURS` — хочеш повторити одразу.
- Спочатку треба побачити, що саме LLM зробить (`ADR_NORMALIZE_DRY=1`).

## Передумови

- Правило `adr` увімкнене у `.n-cursor.json` (`"adr"` у `rules`).
- `.claude/hooks/normalize-decisions.sh` існує (`npx @nitra/cursor` поклав його сюди).
- У `PATH` доступний `claude` або `cursor-agent` (інакше скрипт мовчки вийде).
- У `docs/adr/` є чернетки — файли з `session: …` у YAML frontmatter.

## Кроки

1. **Dry-run** (не міняє файли, лише пише план у `.claude/hooks/normalize-decisions.log`):

   ```bash
   ADR_NORMALIZE_THRESHOLD=0 \
   ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 \
   ADR_NORMALIZE_DRY=1 \
     bash .claude/hooks/normalize-decisions.sh
   ```

   Потім переглянь план: `tail -100 .claude/hooks/normalize-decisions.log`.

2. **Реальний прогон одного батчу** (за замовчуванням до 30 чернеток):

   ```bash
   ADR_NORMALIZE_THRESHOLD=0 \
   ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 \
     bash .claude/hooks/normalize-decisions.sh
   ```

3. **Перегляд результату** — скрипт нічого не комітить:

   ```bash
   git status docs/adr/
   git diff docs/adr/
   ```

   Видалені файли — `delete`-операція. Нові файли `<timestamp>-<slug>.md` (timestamp-префікс чернетки збережено) — `rewrite`. Модифіковані clean-файли — `merge-into`.

4. **Прийняти / відкотити:**
   - Прийняти все: `git add docs/adr/ && git commit -m "adr: normalize batch"`.
   - Відкотити конкретний файл: `git checkout -- docs/adr/<file>` (для `rewrite` цього мало — треба ще `git restore --staged` і `rm` нового).
   - Відкотити весь батч: `git checkout -- docs/adr/ && git clean -f docs/adr/` (видалить і untracked rewrite-результати).

5. **Повторити для наступного батчу**, якщо чернеток ще багато. Кожен запуск обробляє до `ADR_NORMALIZE_BATCH` файлів (default 10, найстарші за часовою позначкою у назві).

## Tuning через ENV

- `ADR_NORMALIZE_BATCH=30` — більший батч (менше викликів LLM, більше токенів за раз).
- `ADR_NORMALIZE_MODEL=opus` — інша модель `claude -p`.
- `ADR_NORMALIZE_CURSOR_MODEL=…` — інша модель для cursor-agent fallback.
- `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` — вимкнути structural skip для tooling-only сесій (default `1`). Корисно лише якщо хочеш зберегти чернетки навіть для правок у `.cspell.json` / `CHANGELOG.md` / `version`-bump-ів.

## Якщо щось пішло не так

- LLM повернув криву JSON → у логу буде `invalid JSON response (first 200 chars): …`. Запусти ще раз — нерідко це разовий збій.
- Скрипт виходить миттєво без логу → перевір `ADR_NORMALIZE_RUNNING` у env (recursion guard) і чи репо не у стані merge/rebase.
- Перейменування зробило дублі імен (`<timestamp>-<slug>-2.md`) → це нормально, скрипт детермінований; під час review можна обʼєднати руками й видалити `-2`.
- ADR-чернетки видаляються мовчки → це structural tooling-only skip. Перевір лог: `tail .claude/hooks/normalize-decisions.log | grep tooling-only`. Для діагностики на capture-стороні: `tail .claude/hooks/capture-decisions.log | grep tooling-only`. Аби тимчасово вимкнути — `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 bash .claude/hooks/normalize-decisions.sh`.
