---
name: n-fix
description: >-
  Виправити проєкт відповідно до всіх правил в .cursor/rules/
---

<!-- n-cursor:worktree:start -->
> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-fix/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-fix`. Суфікс `fix` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
```

**Root-assert.** Якщо `pwd` **не** збігається з виводом `git rev-parse --show-toplevel` — ти в **піддиректорії** робочого дерева (worktree-шляхи нижче відносні до кореня репо). Спершу перейди в корінь: `cd <toplevel>` (literal-шлях із виводу), і лише тоді продовжуй preflight. Не створюй worktree з піддиректорії — `cd .worktrees/<…>` звідти впаде.

Якщо `git rev-parse --show-toplevel` показав, що ти **не** в `.worktrees/`, візьми вивід `git branch --show-current` як `<current-branch>` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка `feature/x`:

```bash
npx @nitra/cursor worktree add "feature/x-fix" "n-fix: worktree-only skill"
cd ".worktrees/feature-x-fix"
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

# n-fix — автоматичне виправлення проєкту

## Scope

Цей скіл відповідає **лише за структуру** проєкту: щоб `.cursor/rules/` + `npx @nitra/cursor fix` були задоволені (наявність конфігів, залежностей, скриптів, GitHub workflows, відсутність заборонених файлів). **Лінт-порушення у самому коді** (ESLint, oxlint, jscpd, cspell, knip, sonarjs, stylelint тощо) — **поза скоупом**; їх діагностує й виправляє **`/n-lint`** (`bun run lint`).

## Workflow

```bash
n_cursor_npx fix
```

Exit 0 = чисто, 1 = є unresolved (перевір вивід — буде список правил що не закрились після 3 ітерацій).

Якщо змінились залежності — `bun i`. Якщо змінились JS/TS файли — `oxfmt .`.

Для конкретних правил: `n_cursor_npx fix bun ga`.
