# Spec: розбиття bundled full-scope concerns на per-file (text/python/php/rego)

**Дата:** 2026-07-02
**Статус:** Draft
**Тип:** Breaking — без зворотної сумісності, міграція одним кроком

**Пов'язані документи:**

- `docs/specs/2026-06-28-concern-lint-scope-design.md` — concern-модель і `lint.scope`; ця спека виконує для `text/`, `python/`, `php/`, `rego/` те, що та спека вже зробила для `js/` (eslint per-file, jscpd/knip full), і явно змінює відповідні рядки таблиці §"Concern inventory після міграції" (docs/specs/2026-06-28-concern-lint-scope-design.md:288)

---

## Проблема

Аудит усіх `lint.scope: "full"` concerns (~58 у репо) показав: **жоден з них не обмежений лише `--full`** — усі мають непорожній `lint.glob`, тобто спрацьовують і в delta-режимі щойно змінений файл потрапляє під glob ([run-detectors.mjs:176](npm/scripts/lib/lint-surface/run-detectors.mjs:176): `full` + `glob ∩ changed ≠ ∅` → whole-repo run). Це не виняток для конкретного інструменту — це властивість дизайну: full-scope concern завжди або запускається whole-repo (якщо glob збігся), або не запускається зовсім (якщо glob не задано, concern узагалі мертвий у delta — таких серед full-scope concerns у репо не знайдено).

З цих ~58 виявлено **4 concerns**, що повторюють структурний антипатерн `text/check`: бандлять кілька незалежних CLI-інструментів в один `lint()`, що повністю ігнорує `ctx.files`, хоча частина бандлених інструментів **сама здатна** приймати список файлів:

| concern | що бандлить | glob (delta-тригер) | per-file-здатні тули |
| ------- | ------------ | -------------------- | ---------------------- |
| `text/check` | cspell, shellcheck, dotenv-linter, markdownlint-cli2, v8r ([main.mjs:19-56](npm/rules/text/check/main.mjs:19)) | md/mdc/txt/sh/env/json/yaml/toml | усі 5 |
| `python/check` | uv lock/sync, ruff check, ruff format, mypy, pip-licenses ([main.mjs:98-114](npm/rules/python/check/main.mjs:98)) | `**/*.py`, pyproject.toml, uv.lock | ruff (check+format), mypy |
| `php/check` | composer audit, php-cs-fixer, phpcs, phpstan, psalm ([main.mjs:60-120](npm/rules/php/check/main.mjs:60)) | `**/*.php`, composer.json/lock | php-cs-fixer, phpcs |
| `rego/check` | opa check, regal lint, conftest verify ([main.mjs:36-66](npm/rules/rego/check/main.mjs:36)) | `**/*.rego` | усі 3 (приймають explicit paths) |

Наслідки для кожного — той самий подвійний удар, що й у `text/check`:

1. **Delta вже дорогий.** Будь-яка зміна одного `.py`/`.php`/`.rego`-файлу тригерить **весь** ланцюжок (5, 5, 3 тули відповідно) по всьому репо/проєкту, не лише по змінених файлах.
2. **`--full` найгірший** — той самий whole-repo прогін, але свідомо (CI-режим).
3. Частина бандлених тулів (ruff, mypy, phpcs, php-cs-fixer, opa/regal/conftest) **приймають** file-list — bundle існує історично (один detector на "мову"), не з технічної необхідності.

`rust/check` (cargo fmt+clippy+deny) навмисно **виключений** з цієї спеки — див. §"Не в цій спеці".

## Рішення

### 1. Розбити на 5 concerns, по аналогії з `js/`

Наявні dirs уже мають `concern.json`-заглушки без surface — стають носіями `lint`:

| concern (dir)                                    | інструмент     | scope    | glob                                                      |
| ------------------------------------------------- | -------------- | -------- | ---------------------------------------------------------- |
| `text/cspell-fix/`                                 | cspell         | per-file | `**/*.{md,mdc,txt,js,mjs,ts,vue,...}` (поточний cspell-скоуп) |
| `text/run-shellcheck/`                              | shellcheck     | per-file | `**/*.sh`                                                  |
| `text/run-dotenv-linter/`                           | dotenv-linter  | per-file | `**/.env`, `**/.env.*`                                     |
| `text/markdownlint/` (multi-surface: `policy`+`lint`) | markdownlint-cli2 | per-file | `**/*.md`, `**/*.mdc`                                      |
| `text/run-v8r/`                                     | v8r            | per-file | `**/*.json`, `**/*.json5`, `**/*.yml`, `**/*.yaml`, `**/*.toml` |

`text/check/` видаляється — його `lint()` розпадається на 5 export'ів `lint(ctx)` у відповідних dirs, кожен читає `ctx.files` замість ігнорування.

`markdownlint/` — приклад multi-surface: `policy` (перевірка, що `.markdownlint-cli2.jsonc` існує) + `lint` (сам прогін markdownlint-cli2) в одному каталозі, той самий домен — дозволено спекою 2026-06-28 (§1, аналог `jscpd_config`/`jscpd_duplicates`, тільки тут одна директорія замість двох).

### 2. Кожен detector приймає `files`

Контракт як у `oxfmt/main.mjs:29`:

```js
const targets = files === undefined ? [FULL_GLOB] : files.filter(f => MATCH_RE.test(f))
if (targets.length === 0) return reporter.result()
```

- cspell: `spawnSync(bin, ['cspell', ...targets])` замість `cspell .`.
- markdownlint-cli2: `argv: targets` замість `['**/*.md', '**/*.mdc']`.
- shellcheck / dotenv-linter: аналогічно, лише змінені файли своїх розширень.
- v8r: **редизайн виклику** (не просто підміна glob на файли) — див. §3.

### 3. v8r: file-list замість glob-циклу + локальний catalog

В межах цієї ж спеки (рішення після брейншторму — не виносити окремо):

- `runV8rWithGlobs` → `runV8rWithFiles(files)`: один прогін на **фактичний список файлів** (не 5 послідовних `bun x v8r <glob>`), або мінімум `Promise.all` замість послідовного `for` ([run-v8r/main.mjs:134](npm/rules/text/run-v8r/main.mjs:134)), якщо API v8r вимагає groupBy-розширення для коду 98 (порожній glob).
- Додати до `npm/schemas/v8r-catalog.json` запис для `concern.json` (`customCatalog`, навіть заглушка-схема `{}` або мінімальна) — прибирає ~166 файлів з мережевого fallback-шляху.
- `full`-режим (`--full`) лишається whole-repo (`files: undefined` → дефолтні глоби, як зараз) — це свідомо CI-безпечний прогін, оптимізація стосується лише кількості процесів і catalog-lookup, не скоупу.

### 4. Прийнята втрата: delta більше не whole-repo safety-net

Delta-режим ловитиме порушення (typo, markdownlint, невалідний json) **лише** у змінених файлах. Раніше будь-яка зміна тексту тригерила прогін по всьому репо (і теоретично могла зловити чужі старі порушення) — це прибирається свідомо (підтверджено брейнштормом): whole-repo перевірка — відповідальність `--full`/CI, не задачного delta.

## Implementation impact

| зона              | що змінити                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `text/check/`       | видалити каталог повністю (concern.json + main.mjs)                                                            |
| `text/cspell-fix/`  | `concern.json` → додати `lint.scope: per-file` + glob; `main.mjs` — export `lint(ctx)`, `runCspellText` бере `ctx.files` |
| `text/run-shellcheck/` | те саме — `lint(ctx)` з `ctx.files`, glob `**/*.sh`                                                         |
| `text/run-dotenv-linter/` | те саме — glob `**/.env`, `**/.env.*`                                                                     |
| `text/markdownlint/`  | додати `lint` surface поряд з наявним `policy`; `main.mjs` — новий export `lint(ctx)` з `markdownlintCli2({ argv: files ?? ['**/*.md','**/*.mdc'] })` |
| `text/run-v8r/`     | `concern.json` → `lint.scope: per-file` + json/json5/yml/yaml/toml glob; `runV8rWithGlobs` → `runV8rWithFiles`, паралелізація, catalog-запис для `concern.json` |
| `npm/schemas/v8r-catalog.json` | додати `customCatalog`-запис для `concern.json`                                                    |
| Тести             | `run-fix.test.mjs` / `run-detectors.test.mjs` — прибрати fixtures на `text/check`, додати per-concern snapshot-и |
| Docs              | `docs/specs/2026-06-28-concern-lint-scope-design.md:288` — оновити рядок `text` на 5 нових рядків (як `js`-приклад) |

## Рішення (python/php/rego)

Той самий підхід §1-2, застосований до трьох інших мовних `check`-concerns. У кожному випадку розділяємо **per-file-здатний лінтер/форматер** від **project-wide аналізатора/аудиту**, замість одного `lint()` з fail-fast short-circuit по 3-5 тулах.

### python/check → 3 concerns

| concern (dir)              | інструмент(и)                          | scope    | glob |
| --------------------------- | --------------------------------------- | -------- | ---- |
| `python/ruff/` (новий)       | `ruff check` + `ruff format --check`     | per-file | `**/*.py` |
| `python/mypy/` (новий)       | `mypy`                                  | per-file | `**/*.py` |
| `python/project/` (перейменований `check/`) | `uv lock --check`, `uv sync --frozen`, `pip-licenses` | full | `pyproject.toml`, `uv.lock` (без `**/*.py`) |

`ruff` і `mypy` приймають список файлів аргументом (`ruff check <files...>`, `mypy <files...>`) — розділяються на 2 окремих per-file concerns, бо це логічно різні інструменти (лінт/формат vs типізація), а не штучний одна-директорія-два-тули хак. `uv lock/sync` і `pip-licenses` лишаються full — вони по природі project-wide (lockfile, залежності), і не мають `**/*.py` у glob після спліту, тож не тригеряться на кожен файловий edit.

### php/check → 3 concerns

| concern (dir)              | інструмент(и)                          | scope    | glob |
| --------------------------- | --------------------------------------- | -------- | ---- |
| `php/cs-fixer/` (новий)      | php-cs-fixer (`--dry-run --diff`)        | per-file | `**/*.php` |
| `php/phpcs/` (новий)         | phpcs (`--standard=Security`)            | per-file | `**/*.php` |
| `php/project/` (перейменований `check/`) | composer audit, phpstan, psalm     | full     | `composer.json`, `composer.lock` (без `**/*.php`) |

phpstan/psalm лишаються full — обидва статичні аналізатори типів потребують повного project-graph (autoload, class hierarchy), запуск на одному файлі дає неповний/хибний результат.

### rego/check → 3 concerns

| concern (dir)              | інструмент      | scope    | glob |
| --------------------------- | ---------------- | -------- | ---- |
| `rego/opa-check/` (новий)    | `opa check --strict` | per-file | `**/*.rego` |
| `rego/regal/` (новий)        | `regal lint`      | per-file | `**/*.rego` |
| `rego/conftest-verify/` (новий) | `conftest verify` | full  | `**/*.rego` (лишається full — verify виконує rego-тести, які часто крос-package (`import data.<pkg>`), безпечніше ганяти на весь `npm/rules`) |

`opa check` і `regal lint` per-file-безпечні (синтаксис/стиль одного файлу), `conftest verify` — обережніше: тести можуть імпортувати сусідні package, тому лишається full, але вже без bundling з двома іншими тулами (кожен окремо швидший і трасується окремо в звіті).

## Не в цій спеці

- **`rust/check`** — свідомо виключений. `cargo fmt --check` per-file-безпечний, але `cargo clippy` і `cargo deny check licenses` реально потребують всього crate compilation graph (borrow-checker/type-inference через модулі) — розділяти лінт/формат від clippy дає малий виграш (clippy й так домінує за часом), а сам bundling тут менш штучний, ніж у python/php/rego. Можна переглянути окремо, якщо профілювання покаже інше.
- Зміна `full`-семантики (`--full` лишається whole-repo для всіх concerns) — тільки delta-скоуп і v8r internals.
- LLM-fix (opportunistic tier) логіка cspell-класифікації — лишається як є, тільки джерело файлів змінюється.
- Нові v8r-схеми для інших типів файлів без local catalog (окрім `concern.json`) — окремий backlog, якщо знайдуться інші гарячі точки.
- Namespace/package rename для `rego/check` (`package rego.check` → 3 нових) — рефакторинг Rego test-namespaces за конвенцією з `docs/specs/2026-06-28-concern-lint-scope-design.md` §"Policy surface", виконати разом зі split, не окремим кроком.
