---
name: n-taze
description: >-
  Оновлення версій модулів проекту з аналізом major-змін і автоматичним
  рефакторингом несумісного коду
---

<!-- n-cursor:worktree:start -->
> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-taze/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-taze`. Суфікс `taze` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
```

**Root-assert.** Якщо `pwd` **не** збігається з виводом `git rev-parse --show-toplevel` — ти в **піддиректорії** робочого дерева (worktree-шляхи нижче відносні до кореня репо). Спершу перейди в корінь: `cd <toplevel>` (literal-шлях із виводу), і лише тоді продовжуй preflight. Не створюй worktree з піддиректорії — `cd .worktrees/<…>` звідти впаде.

Якщо `git rev-parse --show-toplevel` показав, що ти **не** в `.worktrees/`, візьми вивід `git branch --show-current` як `<current-branch>` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка `feature/x`:

```bash
npx @nitra/cursor worktree add "feature/x-taze" "n-taze: worktree-only skill"
cd ".worktrees/feature-x-taze"
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

# n-taze — Оновлення версій проекту

## Мета

Оновити всі модулі проекту до останніх версій, виявити major-оновлення, перевірити сумісність змін з кодом проекту і за потреби зрефакторити несумісні місця.

## Передумови

- Чисте робоче дерево (`git status` без незакомічених змін у `package.json` / `bun.lock` / `node_modules`) — інакше різницю не відрізнити від оновлення.
- Встановлений `bun` і доступний `bunx`.
- Запуск з кореня проекту (де лежить `package.json` / `bun.lock`).

## Workflow

### 1. Зафіксувати стартовий стан

Перед оновленням зберегти список поточних версій, щоб потім обчислити, які модулі стрибнули через major:

```bash
cp package.json package.json.taze-bak
cp bun.lock bun.lock.taze-bak
```

(У monorepo — також усі `*/package.json` воркспейсів. Файли тимчасові, видалити в кінці.)

### 2. Запустити оновлення

```bash
bunx taze -w -r latest
bun install
```

- `-w` — записати нові версії у `package.json`.
- `-r` — рекурсивно по всіх воркспейсах.
- `latest` — піднімати навіть major.

### 3. Виявити major-оновлення

Порівняти `package.json.taze-bak` з оновленим `package.json` (а також `bun.lock.taze-bak` ↔ `bun.lock` для транзитивних). Для кожної залежності, у якої змінилась перша значуща цифра semver (`1.x.x → 2.x.x`, `0.4.x → 0.5.x`, `0.0.x → 0.1.x`) — додати в список «потребує перевірки».

Minor/patch — пропускати, їх вважаємо сумісними.

### 4. Зібрати breaking changes по кожному major-оновленню

Для кожного модуля зі списку зібрати фактичні відмінності одним з джерел (у порядку пріоритету):

1. **CHANGELOG / Releases репозиторію модуля** — найшвидше і найточніше. Адресу репозиторію взяти з `package.json` модуля у `node_modules/<name>/package.json` (поле `repository`). Дістати релізи між старою і новою версією.
2. **Git-різниця в `node_modules/<name>`** — якщо CHANGELOG відсутній або неінформативний, порівняти попередню версію (з кешу bun: `~/.bun/install/cache/<name>@<old-version>/`) з новою (`node_modules/<name>/`) через `diff -r` по `dist/` / `*.d.ts` / публічних entry-points з `exports`.
3. **Якщо немає кешованої старої версії** — встановити її окремо в тимчасову теку (`mkdir -p /tmp/taze-old && cd /tmp/taze-old && bun add <name>@<old-version>`) і порівняти.

Цікавлять: видалені/перейменовані експорти, змінені сигнатури функцій, змінені типи, змінена поведінка за замовчуванням, видалені CLI-прапорці.

### 5. Перевірити сумісність з кодом проекту

Для кожного breaking change знайти його використання в коді проекту:

```bash
rg -n "<імпорт|функція|опція>" --type ts --type js --type vue
```

Класифікувати:

- **сумісно** — проект не використовує зачеплене API → нічого не робити.
- **несумісно** — використання знайдено → перейти до п. 6.

### 6. Рефакторинг несумісних місць

Для кожного несумісного місця — застосувати міграцію згідно з changelog модуля (перейменувати імпорт, оновити сигнатуру виклику, замінити видалену опцію еквівалентом тощо). Після правок:

```bash
bun run lint
bun run typecheck   # якщо є
bun test            # якщо є
```

Якщо міграція нетривіальна або неоднозначна — **не вгадувати**, залишити TODO у коді з посиланням на CHANGELOG і винести в підсумковий звіт як ручну дію.

### 7. Прибрати тимчасові файли

```bash
rm package.json.taze-bak bun.lock.taze-bak
```

(І решту бекапів воркспейсів, якщо створювались.)

### 8. Звіт користувачу

Коротко в одному повідомленні:

- **Оновлено (minor/patch):** кількість пакетів, без деталей.
- **Major-оновлення:** список `<name>: <old> → <new>` з посиланням на release notes.
- **Зрефакторено автоматично:** список файлів і коротко що саме змінено.
- **Потребує ручного втручання:** список TODO з причиною (нетривіальна міграція / неоднозначність / падіння тестів).
- **Стан перевірок:** `lint` / `typecheck` / `test` — pass/fail з номером рядка, де впало.

## Примітка

- Не запускати `bun run lint` паралельно з іншими ESLint-задачами — діє правило з кореневого `CLAUDE.md`.
- Якщо проект — `npm/` пакет цього репо, після змін у `package.json` / коді треба підняти `version` і додати запис у `CHANGELOG.md` згідно з `npm/CLAUDE.md`.
- При великій кількості major-оновлень розбити PR по одному модулю на коміт — щоб `git bisect` залишався корисним.
