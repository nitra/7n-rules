---
name: n-adr-normalize
description: >-
  Ручний запуск ADR-нормалізації — обхід порогу й min-interval, прогон одного
  батчу чернеток через LLM, перегляд результату через git diff
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
npx @nitra/cursor worktree add "feature/x-adr-normal" "n-adr-normal: worktree-only skill"
cd ".worktrees/feature-x-adr-normal"
```

Тобто branch-argument лишає slash як у git-гілці, а шлях для `cd` бере sanitized форму: slash → `-`.

**Крок 0.1 — bootstrap у новому дереві (після `cd`, окремий крок — поза «без-expansion» блоком вище).** Дерево щойно створене й **без** `node_modules`. Спершу постав залежності локально: тоді `npx` бере локальну копію `@nitra/cursor` і гонки з CDN немає взагалі. Retry-обгортка нижче — safety-net на випадок, коли версію щойно опубліковано, але edge-кеш CDN ще її не має: `npm` тоді падає з `ETARGET`/`notarget` **до** запуску бінарника (внутрішній JS-retry у `n-cursor` для цього кейсу марний — бінарник ще не стартував).

```bash
# Локальна копія @nitra/cursor (девзалежність споживача) — npx бере її, без походу в реєстр.
bun install

# n_cursor_npx <args> — обгортка bootstrap-виклику "npx @nitra/cursor <args>".
# Ретраїмо ЛИШЕ транзитні помилки реєстру/мережі (CDN ще не пропагував щойно
# опубліковану версію). Реальний nonzero від CLI (fix повернув ❌, lint-помилка) —
# віддаємо одразу, без ретраю. Інтервал 30с; дефолт-ліміт 5 хв
# (env N_CURSOR_NPX_RETRY_MAX_MIN), hard-ceiling 10 хв.
# Чому 5 хв: CDN-пропагація npm зазвичай < 2 хв, 5 хв — запас; довше → ймовірно
# реальна проблема (невірна версія / аутейдж), краще віддати помилку, ніж висіти.
n_cursor_npx() {
  max_min="${N_CURSOR_NPX_RETRY_MAX_MIN:-5}"
  case "$max_min" in '' | *[!0-9]*) max_min=5 ;; esac
  [ "$max_min" -gt 10 ] && max_min=10
  deadline=$(( $(date +%s) + max_min * 60 ))
  attempt=1
  transient='ETARGET|notarget|No matching version|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|50[0-9] |502 Bad Gateway|503 Service Unavailable|504 Gateway'
  while :; do
    err=$(mktemp)
    npx @nitra/cursor "$@" 2>"$err"
    code=$?
    cat "$err" >&2
    [ "$code" -eq 0 ] && { rm -f "$err"; return 0; }
    if grep -Eq "$transient" "$err" && [ "$(date +%s)" -lt "$deadline" ]; then
      rm -f "$err"
      echo "n-cursor: очікую пропагації версії по CDN… спроба $attempt, повтор через 30с" >&2
      attempt=$((attempt + 1))
      sleep 30
    else
      rm -f "$err"
      return "$code"
    fi
  done
}
```

Усі подальші bootstrap-виклики `npx @nitra/cursor <cmd>` у цій сесії роби через `n_cursor_npx <cmd>`. Якщо опинився у свіжому shell без цієї функції — спершу повтори блок вище (`bun install` + визначення `n_cursor_npx`).
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
