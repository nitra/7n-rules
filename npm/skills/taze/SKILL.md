---
name: n-taze
description: >-
  Оновлення версій модулів проекту (bun/npm; якщо є Cargo.toml — Rust-крейти
  через cargo-edit; якщо є pyproject.toml — Python-пакети через uv) з
  аналізом major-змін і автоматичним рефакторингом несумісного коду
version: '1.2'
---

# n-taze — Оновлення версій проекту

## Мета

Оновити всі модулі проекту (npm/bun-залежності, а за наявності `Cargo.toml`/`pyproject.toml` — і Rust-крейти/Python-пакети) до останніх версій, виявити major-оновлення, перевірити сумісність змін з кодом проекту і за потреби зрефакторити несумісні місця.

## Оркестрація (npm/bun-, Rust- і Python-гілка) — не одним промптом

`npx @7n/rules skill pi|cursor|codex taze` **не** передає цей файл одним суцільним
промптом в один агентський хід — так робив старий дизайн, і саме тому реальний
прогін міг зависати без жодної діагностики (один величезний непрозорий хід на
весь монорепо, без проміжних зупинок для перевірки прогресу). Замість цього `npm/skills/taze/js/orchestrate.mjs`:

1. Детерміновано, без LLM, виконує кроки 1-3 нижче для всіх гілок: npm/bun (бекап → `bunx taze -w -r latest` → `bun install` → `n-rules taze diff`); якщо знайдені `Cargo.toml`, Rust (бекап → `cargo upgrade --incompatible allow` → `cargo update` → `collectCargoDiff` з `cargo-diff.mjs`, детермінований cargo-еквівалент `n-rules taze diff` — парсить кожен `Cargo.toml` через `smol-toml`, класифікує major за тим самим правилом caret-семантики, включно з Cargo-скороченими версіями `"1"`/`"0.4"`); якщо знайдений кореневий `pyproject.toml`, Python (бекап → по кожній прямій залежності `uv remove <pkg>` + `uv add <pkg>[extras] --bounds lower` → `collectUvDiff`, парсить PEP 508/PEP 440 через `smol-toml`, той самий caret-принцип класифікації).
2. Для кожного **окремого** major-пакета/крейта з diff-у — один ізольований, обмежений виклик обраного раннера (кроки 4-6, лише для цього запису; промпт генерує `buildDependencyPrompt`/`buildCargoDependencyPrompt`/`buildUvDependencyPrompt`, не цей SKILL.md).
3. Детерміновано прибирає бекапи (крок 7) і компонує звіт (крок 8) з результатів усіх ітерацій.

Не-npm екосистеми оркестратор веде через **EcosystemProvider-порт**
(`@7n/rules/plugin-api`, spec `docs/specs/2026-07-18-lang-plugins-extraction-spec.md`)
— плагіни, що доставляються автоматично при першому запуску за файловим сигналом
(extension-point `taze`): Rust — **`@7n/rules-lang-rust`** (кореневий `Cargo.toml`),
Python — **`@7n/rules-lang-python`** (кореневий `pyproject.toml`). На чисто-JS
проєкті без цих сигналів у звіті немає навіть згадки про інші екосистеми.

Якщо `Cargo.toml` знайдені, але `cargo-edit` не встановлено — Rust-гілка **не**
блокує інші гілки: оркестратор пропускає Rust-обробку і в звіті перелічує
знайдені `Cargo.toml` як такі, що потребують ручного прогону (нижче). Так само,
якщо `pyproject.toml` знайдений, але `uv` не встановлено — Python-гілка **не**
блокує інші гілки.

Переваги: падіння/timeout на одному пакеті/крейті не втрачає прогрес по інших;
кожен виклик успадковує власний timeout раннера (короткий, бо скоуп малий —
один запис, не весь монорепо); видно прогрес по записах, а не чорну скриньку.

Кроки 1-8 нижче лишаються джерелом правди щодо ЗМІСТУ роботи (що саме робить
кожен крок) — оркестратор їх виконує програмно (1-3/7/8) або як промпт на
один запис (4-6) для всіх гілок.

## Передумови

- Чисте робоче дерево (`git status` без незакомічених змін у `package.json` / `bun.lock` / `node_modules`) — інакше різницю не відрізнити від оновлення.
- Встановлений `bun` і доступний `bunx`.
- Запуск з кореня проекту (де лежить `package.json` / `bun.lock`).
- Якщо в проекті є хоч один `Cargo.toml` (не в `node_modules`/`.worktrees`) — бажано встановлений `cargo-edit` (`cargo install cargo-edit`, дає команду `cargo upgrade`). Без нього major-бампи Rust-залежностей неможливо застосувати детерміновано (голий `cargo update` піднімає лише semver-сумісні версії) — оркестратор пропускає Rust-гілку (без блокування інших гілок) і перелічує знайдені `Cargo.toml` у звіті як такі, що потребують ручного прогону кроків 2-8 нижче.
- Якщо в проекті є кореневий `pyproject.toml` — бажано встановлений `uv`. Без нього major-бампи Python-залежностей неможливо застосувати детерміновано — оркестратор пропускає Python-гілку (без блокування інших гілок) і перелічує `pyproject.toml` у звіті як такий, що потребує ручного прогону кроків 2-8 нижче.

### 0.2. Детекція Rust-крейтів

```bash
find . -name Cargo.toml -not -path "*/node_modules/*" -not -path "*/.worktrees/*" -not -path "*/target/*"
```

Якщо список непорожній — паралельно з npm-гілкою виконуються кроки 1–8 у Rust-варіанті (позначені нижче як «Rust-гілка»). Якщо порожній — Rust-кроки повністю пропускаються.

### 0.3. Детекція Python/uv-проекту

```bash
test -f pyproject.toml && echo pyproject.toml
```

v1: лише кореневий `pyproject.toml` (uv-конвенція single-project, без обходу workspace-членів, на відміну від Cargo). Якщо файл існує — паралельно виконуються кроки 1–8 у Python-варіанті (позначені нижче як «Python-гілка»). Якщо відсутній — Python-кроки повністю пропускаються.

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

**Python-гілка** — якщо на кроці 0.3 знайдений `pyproject.toml`:

```bash
cp pyproject.toml pyproject.toml.taze-bak
cp uv.lock uv.lock.taze-bak   # якщо є
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

**Python-гілка:**

```bash
for pkg in $(<список прямих залежностей із [project].dependencies>); do
  uv remove "$pkg"
  uv add "$pkg" --bounds lower
done
```

`uv` **не має** єдиної команди "підняти все до latest, навіть через major" (на відміну від `bunx taze -w -r latest`/`cargo upgrade --incompatible allow`) — підтверджено емпірично: `uv add <pkg>` на вже присутній залежності НЕ переписує specifier без попереднього `uv remove`. `--bounds lower` записує нижню межу без верхньої (`>=<latest>`), коректно зберігає `[extras]`. Провал одного пакета (мережа/резолюція) не втрачає прогрес по інших — оркестратор best-effort відновлює оригінальний рядок, якщо `uv add` не вдався після `uv remove`.

### 3. Виявити major-оновлення

> **Не порівнюй `package.json` вручну.** Класифікацію semver несе CLI — детерміновано, по всіх воркспейсах.

```bash
n-rules taze diff
```

Друкує компактний JSON: `{ "major": [{workspace, pkg, from, to}], "minorPatch": <N>, "totalChanged": <N> }`. `major` — список залежностей, у яких змінилась найлівіша ненульова компонента semver (`1.x→2.x`, `0.4.x→0.5.x`, `0.0.3→0.0.4`); саме він іде в кроки 4–6. `minorPatch` — лічба сумісних (для звіту в кроці 8).

Покриває **прямі** залежності з `package.json` (root + воркспейси). Транзитивні major-стрибки (`bun.lock`) — за потреби переглянь окремо; основний ризик breaking-змін — у прямих.

**Rust-гілка (оркестровано)** — `collectCargoDiff` (`npm/skills/taze/js/cargo-diff.mjs`) робить те саме детерміновано: парсить кожен `Cargo.toml.taze-bak`/`Cargo.toml` через `smol-toml`, порівнює `dependencies`/`dev-dependencies`/`build-dependencies` (рядок чи `{ version = "...", features = [...] }`), класифікує за тим самим правилом caret-семантики — Cargo-скорочені версії (`"1"`, `"0.4"`) трактуються як відсутні компоненти = 0. Ручний прогін поза оркестратором — той самий принцип: `diff Cargo.toml.taze-bak Cargo.toml` по рядках `<name> = "<version>"`.

**Python-гілка (оркестровано)** — `collectUvDiff` (`npm/skills/taze/js/uv-diff.mjs`) робить те саме детерміновано: парсить `pyproject.toml.taze-bak`/`pyproject.toml` через `smol-toml`, порівнює `[project].dependencies` (масив PEP 508-рядків, матчинг за іменем пакета — не за позицією), дістає нижню межу PEP 440-специфікатора (`extractLowerBoundVersion`) і класифікує за тим самим правилом caret-семантики. Ручний прогін поза оркестратором — той самий принцип: `diff pyproject.toml.taze-bak pyproject.toml` по записах `[project].dependencies`.

### 4. Зібрати breaking changes по кожному major-оновленню

Для кожного модуля зі списку зібрати фактичні відмінності одним з джерел (у порядку пріоритету):

1. **CHANGELOG / Releases репозиторію модуля** — найшвидше і найточніше. Адресу репозиторію взяти з `package.json` модуля у `node_modules/<name>/package.json` (поле `repository`). Дістати релізи між старою і новою версією.
2. **Git-різниця в `node_modules/<name>`** — якщо CHANGELOG відсутній або неінформативний, порівняти попередню версію (з кешу bun: `~/.bun/install/cache/<name>@<old-version>/`) з новою (`node_modules/<name>/`) через `diff -r` по `dist/` / `*.d.ts` / публічних entry-points з `exports`.
3. **Якщо немає кешованої старої версії** — встановити її окремо в тимчасову теку (`mkdir -p /tmp/taze-old && cd /tmp/taze-old && bun add <name>@<old-version>`) і порівняти.

Цікавлять: видалені/перейменовані експорти, змінені сигнатури функцій, змінені типи, змінена поведінка за замовчуванням, видалені CLI-прапорці.

**Rust-гілка** — адресу репозиторію взяти з поля `repository`/`documentation` крейта на `crates.io` (`https://crates.io/crates/<name>`) або з `[package.metadata]`; CHANGELOG зазвичай у `CHANGELOG.md` репозиторію або в GitHub Releases. Якщо немає — `cargo doc` різниця по публічному API (`pub fn`/`pub struct`/`pub trait`) між закешованою старою версією (`~/.cargo/registry/src/*/<name>-<old-version>/`) і новою (`~/.cargo/registry/src/*/<name>-<new-version>/`) через `diff -r src/`.

**Python-гілка** — адресу репозиторію взяти зі сторінки `https://pypi.org/project/<name>/` (поле "Homepage"/"Source"); CHANGELOG зазвичай у `CHANGELOG.md`/`HISTORY.md` репозиторію або в GitHub Releases. Якщо немає — різниця по публічному API між закешованою старою версією (`~/.cache/uv/`) і новою (`.venv/lib/python*/site-packages/<name>/`).

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

**Python-гілка:**

```bash
rg -n "<імпорт|функція|клас>" --type py
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

**Python-гілка** — після правок (залежно від того, що реально налаштовано в проєкті):

```bash
ruff check .
mypy .
pytest
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

**Python-гілка:**

```bash
rm pyproject.toml.taze-bak uv.lock.taze-bak
```

### 8. Звіт користувачу

Коротко в одному повідомленні:

- **Оновлено (minor/patch):** кількість пакетів (`minorPatch` із кроку 3), без деталей.
- **Major-оновлення:** список `<name>: <old> → <new>` з посиланням на release notes.
- **Зрефакторено автоматично:** список файлів і коротко що саме змінено.
- **Потребує ручного втручання:** список TODO з причиною (нетривіальна міграція / неоднозначність / падіння тестів).
- **Стан перевірок:** `lint` / `typecheck` / `test` — pass/fail з номером рядка, де впало.

Якщо на кроці 0.2 знайдені Rust-крейти — додати окрему секцію **Rust-крейти** з тим самим переліком (оновлено / major / зрефакторено / потребує ручного втручання), і в **Стан перевірок** — окремо `cargo fmt` / `cargo clippy` / `cargo test`. Якщо на кроці 0.3 знайдений `pyproject.toml` — так само окрема секція **Python-пакети (uv)**, і в **Стан перевірок** — окремо `ruff` / `mypy` / `pytest`.

## Примітка

- Не запускати `npx @7n/rules lint` паралельно з іншими ESLint-задачами — діє правило з кореневого `CLAUDE.md`.
- Якщо проект — `npm/` пакет цього репо, після змін у `package.json` / коді треба підняти `version` і додати запис у `CHANGELOG.md` згідно з `npm/CLAUDE.md`.
- При великій кількості major-оновлень розбити PR по одному модулю на коміт — щоб `git bisect` залишався корисним. Це стосується і Rust-крейтів, і Python-пакетів окремо від npm-пакетів.
- `cargo upgrade --incompatible allow` редагує `Cargo.toml` навіть для залежностей без доступних breaking changes в змінах API — завжди звіряй крок 4 (CHANGELOG) перед тим, як вважати оновлення безпечним, а не лише факт успішної компіляції.
- `uv add <pkg>` на вже присутній залежності — no-op (specifier НЕ переписується); детерміновану гілку це не блокує (вона робить `uv remove` спершу), але при ручному прогоні кроків 2-8 легко про це забути.
