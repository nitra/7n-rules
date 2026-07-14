---
name: n-taze
description: >-
  Оновлення версій модулів проекту (bun/npm і, якщо є Cargo.toml, Rust-крейти
  через cargo-edit) з аналізом major-змін і автоматичним рефакторингом
  несумісного коду
version: '1.1'
---

<!-- n-rules:worktree:start -->
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
npx @7n/mt worktree create "feature/x-taze" "n-taze: worktree-only skill"
cd ".worktrees/feature-x-taze"
```

Тобто branch-argument лишає slash як у git-гілці, а шлях для `cd` бере sanitized форму: slash → `-`.

**Крок 0.1 — bootstrap у новому дереві (після `cd`).** Дерево щойно створене й **без** `node_modules`. Постав залежності локально — тоді `npx @7n/rules <cmd>` бере локальну копію без походу в реєстр:

```bash
bun install
```
<!-- n-rules:worktree:end -->

# n-taze — Оновлення версій проекту

## Мета

Оновити всі модулі проекту (npm/bun-залежності, а за наявності `Cargo.toml` — і Rust-крейти) до останніх версій, виявити major-оновлення, перевірити сумісність змін з кодом проекту і за потреби зрефакторити несумісні місця.

## Передумови

- Чисте робоче дерево (`git status` без незакомічених змін у `package.json` / `bun.lock` / `node_modules`) — інакше різницю не відрізнити від оновлення.
- Встановлений `bun` і доступний `bunx`.
- Запуск з кореня проекту (де лежить `package.json` / `bun.lock`).
- Якщо в проекті є хоч один `Cargo.toml` (не в `node_modules`/`.worktrees`) — додатково встановлений `cargo-edit` (`cargo install cargo-edit`, дає команду `cargo upgrade`). Без нього major-бампи Rust-залежностей неможливо застосувати детерміновано (голий `cargo update` піднімає лише semver-сумісні версії) — **STOP** і попроси користувача встановити перед продовженням кроку 2 для Rust-гілки.

### 0.2. Детекція Rust-крейтів

```bash
find . -name Cargo.toml -not -path "*/node_modules/*" -not -path "*/.worktrees/*" -not -path "*/target/*"
```

Якщо список непорожній — паралельно з npm-гілкою виконуються кроки 1–8 у Rust-варіанті (позначені нижче як «Rust-гілка»). Якщо порожній — Rust-кроки повністю пропускаються.

## Workflow

### 1. Зафіксувати стартовий стан

Перед оновленням зберегти список поточних версій, щоб потім обчислити, які модулі стрибнули через major:

```bash
cp package.json package.json.taze-bak
cp bun.lock bun.lock.taze-bak
```

(У monorepo — також усі `*/package.json` воркспейсів. Файли тимчасові, видалити в кінці.)

**Rust-гілка** — для кожного знайденого на кроці 0.2 `Cargo.toml` (включно з кореневим, якщо є):

```bash
cp Cargo.toml Cargo.toml.taze-bak
cp Cargo.lock Cargo.lock.taze-bak   # якщо lock-файл спільний на workspace — достатньо одного бекапу в корені
```

### 2. Запустити оновлення

```bash
bunx taze -w -r latest
bun install
```

- `-w` — записати нові версії у `package.json`.
- `-r` — рекурсивно по всіх воркспейсах.
- `latest` — піднімати навіть major.

**Rust-гілка:**

```bash
cargo upgrade --incompatible allow
cargo update
```

- `cargo upgrade` (з `cargo-edit`) переписує вимоги версій у кожному `Cargo.toml` workspace-у на останні; `--incompatible allow` явно дозволяє перетинати major-межу (аналог `-r latest` у taze) — без цього флага incompatible-оновлення за замовчуванням ігноруються.
- `cargo update` після цього синхронізує `Cargo.lock` з новими вимогами.

### 3. Виявити major-оновлення

> **Не порівнюй `package.json` вручну.** Класифікацію semver несе CLI — детерміновано, по всіх воркспейсах.

```bash
n-rules taze diff
```

Друкує компактний JSON: `{ "major": [{workspace, pkg, from, to}], "minorPatch": <N>, "totalChanged": <N> }`. `major` — список залежностей, у яких змінилась найлівіша ненульова компонента semver (`1.x→2.x`, `0.4.x→0.5.x`, `0.0.3→0.0.4`); саме він іде в кроки 4–6. `minorPatch` — лічба сумісних (для звіту в кроці 8).

Покриває **прямі** залежності з `package.json` (root + воркспейси). Транзитивні major-стрибки (`bun.lock`) — за потреби переглянь окремо; основний ризик breaking-змін — у прямих.

**Rust-гілка** — для `n-rules taze diff` немає cargo-еквівалента, класифікація ручна: для кожного `Cargo.toml.taze-bak` порівняти версію кожної залежності зі свіжим `Cargo.toml` за тим самим правилом (зміна найлівішої ненульової semver-компоненти = major). Швидкий спосіб — `diff Cargo.toml.taze-bak Cargo.toml` по рядках `<name> = "<version>"` і вручну класифікувати кожну зміну.

### 4. Зібрати breaking changes по кожному major-оновленню

Для кожного модуля зі списку зібрати фактичні відмінності одним з джерел (у порядку пріоритету):

1. **CHANGELOG / Releases репозиторію модуля** — найшвидше і найточніше. Адресу репозиторію взяти з `package.json` модуля у `node_modules/<name>/package.json` (поле `repository`). Дістати релізи між старою і новою версією.
2. **Git-різниця в `node_modules/<name>`** — якщо CHANGELOG відсутній або неінформативний, порівняти попередню версію (з кешу bun: `~/.bun/install/cache/<name>@<old-version>/`) з новою (`node_modules/<name>/`) через `diff -r` по `dist/` / `*.d.ts` / публічних entry-points з `exports`.
3. **Якщо немає кешованої старої версії** — встановити її окремо в тимчасову теку (`mkdir -p /tmp/taze-old && cd /tmp/taze-old && bun add <name>@<old-version>`) і порівняти.

Цікавлять: видалені/перейменовані експорти, змінені сигнатури функцій, змінені типи, змінена поведінка за замовчуванням, видалені CLI-прапорці.

**Rust-гілка** — адресу репозиторію взяти з поля `repository`/`documentation` крейта на `crates.io` (`https://crates.io/crates/<name>`) або з `[package.metadata]`; CHANGELOG зазвичай у `CHANGELOG.md` репозиторію або в GitHub Releases. Якщо немає — `cargo doc` різниця по публічному API (`pub fn`/`pub struct`/`pub trait`) між закешованою старою версією (`~/.cargo/registry/src/*/<name>-<old-version>/`) і новою (`~/.cargo/registry/src/*/<name>-<new-version>/`) через `diff -r src/`.

### 5. Перевірити сумісність з кодом проекту

Для кожного breaking change знайти його використання в коді проекту:

```bash
rg -n "<імпорт|функція|опція>" --type ts --type js --type vue
```

Класифікувати:

- **сумісно** — проект не використовує зачеплене API → нічого не робити.
- **несумісно** — використання знайдено → перейти до п. 6.

**Rust-гілка:**

```bash
rg -n "<use-шлях|функція|макрос>" --type rust
```

Та сама класифікація сумісно/несумісно.

### 6. Рефакторинг несумісних місць

Для кожного несумісного місця — застосувати міграцію згідно з changelog модуля (перейменувати імпорт, оновити сигнатуру виклику, замінити видалену опцію еквівалентом тощо). Після правок:

```bash
npx @7n/rules lint
bun run typecheck   # якщо є
bun test            # якщо є
```

**Rust-гілка** — після правок:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Якщо міграція нетривіальна або неоднозначна — **не вгадувати**, залишити TODO у коді з посиланням на CHANGELOG і винести в підсумковий звіт як ручну дію.

### 7. Прибрати тимчасові файли

```bash
rm package.json.taze-bak bun.lock.taze-bak
```

(І решту бекапів воркспейсів, якщо створювались.)

**Rust-гілка:**

```bash
rm Cargo.toml.taze-bak Cargo.lock.taze-bak
```

(І бекапи по кожному workspace-члену, якщо створювались окремо.)

### 8. Звіт користувачу

Коротко в одному повідомленні:

- **Оновлено (minor/patch):** кількість пакетів (`minorPatch` із кроку 3), без деталей.
- **Major-оновлення:** список `<name>: <old> → <new>` з посиланням на release notes.
- **Зрефакторено автоматично:** список файлів і коротко що саме змінено.
- **Потребує ручного втручання:** список TODO з причиною (нетривіальна міграція / неоднозначність / падіння тестів).
- **Стан перевірок:** `lint` / `typecheck` / `test` — pass/fail з номером рядка, де впало.

Якщо на кроці 0.2 знайдені Rust-крейти — додати окрему секцію **Rust-крейти** з тим самим переліком (оновлено / major / зрефакторено / потребує ручного втручання), і в **Стан перевірок** — окремо `cargo fmt` / `cargo clippy` / `cargo test`.

## Примітка

- Не запускати `npx @7n/rules lint` паралельно з іншими ESLint-задачами — діє правило з кореневого `CLAUDE.md`.
- Якщо проект — `npm/` пакет цього репо, після змін у `package.json` / коді треба підняти `version` і додати запис у `CHANGELOG.md` згідно з `npm/CLAUDE.md`.
- При великій кількості major-оновлень розбити PR по одному модулю на коміт — щоб `git bisect` залишався корисним. Це стосується і Rust-крейтів окремо від npm-пакетів.
- `cargo upgrade --incompatible allow` редагує `Cargo.toml` навіть для залежностей без доступних breaking changes в змінах API — завжди звіряй крок 4 (CHANGELOG) перед тим, як вважати оновлення безпечним, а не лише факт успішної компіляції.
