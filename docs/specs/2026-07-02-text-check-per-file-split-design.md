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

### 5. Політика: усе, що не може коректно працювати лише на delta-підмножині → лише `--full`, без `lint.glob`

Рішення, прийняте після брейншторму (і посилене другим раундом — правило застосовується без винятків на основі severity): якщо механізм — зовнішній CLI-тул **або власна JS/rego-логіка** — **принципово не може дати коректний результат**, обмежившись підмножиною змінених файлів (потрібен весь проєкт/репо — lockfile-аудит, dependency-graph, secret-scan по дереву, конвенція пакета загалом, git/registry-стан тощо), його concern **не повинен мати `lint.glob` взагалі**. За правилом spec 2026-06-28 (`docs/specs/2026-06-28-concern-lint-scope-design.md:113`): "для `scope:"full"` без `lint.glob` concern не запускається у delta-режимі" — тобто такий concern спрацьовує **виключно** через `n-cursor lint --full` (CI), ніколи в задачному delta, незалежно від того, який файл змінили.

Це відрізняється від "просто full": full+glob (як було в `text/check`) — теж whole-repo прогін, але **щоразу** в delta на будь-яку дотичну зміну; full-без-glob — прогін лише в CI/`--full`, delta його взагалі не бачить.

Критерій — **не** "чи це зовнішній CLI", а "чи можна коректно проаналізувати підмножину файлів": якщо ні (bundle CLI без file-arg, чи власна JS-перевірка, що завжди обходить усе дерево/git-історію/registry незалежно від того, що змінилось) — **--full-only**. Якщо механізм **приймає** список файлів і дає коректний результат на підмножині — він **per-file**, не сюди (це вже §1-3 і "Рішення python/php/rego").

Правило застосовується свідомо **без винятку на підставі "ціна помилки висока"** чи "це PR-гейт, має спрацьовувати щоразу" — навіть якщо втрачається негайний delta-фідбек (наприклад, `changelog/consistency` перестає ловити відсутній changeset до `--full` в CI), послідовність важливіша за точковий compromise: якщо механізм не працює на delta-підмножині коректно — він **не** мусить вдавати, що працює.

**A. Нові `project`/`verify`-concerns з цієї спеки** — усі три вже full і per своїй природі не приймають file-list:

| concern | тули | було (glob) | стає |
| ------- | ---- | ----------- | ---- |
| `python/project/` | `uv lock --check`, `uv sync --frozen`, `pip-licenses` | `pyproject.toml`, `uv.lock` | **без glob** — лише `--full` |
| `php/project/` | composer audit, phpstan, psalm | `composer.json`, `composer.lock` | **без glob** — лише `--full` |
| `rego/conftest-verify/` | `conftest verify` | `**/*.rego` | **без glob** — лише `--full` |

Наслідок: редагування `pyproject.toml`/`composer.json`/будь-якого `.rego`-файлу більше **не** тригерить lockfile-audit/phpstan/psalm/conftest-verify в задачному прогоні — ці перевірки живуть тільки в CI `--full`. `ruff`/`mypy`/`php-cs-fixer`/`phpcs`/`opa check`/`regal lint` (per-file, §1-3) продовжують спрацьовувати в delta як і раніше — safety-net не втрачається для того, що реально per-file-перевіряється.

**B. Уже існуючі GENUINELY-FULL concerns поза цією спекою** (зовнішній CLI без file-arg) — та сама механічна зміна (прибрати `lint.glob`), без зміни `main.mjs`:

| concern | тул | було (glob) | чому не можна обмежити файлами |
| ------- | --- | ----------- | -------------------------------- |
| `js/knip` | knip | `package.json`, `knip.json`, `knip.ts`, `src/**` | dependency/export-граф усього проєкту; часткові файли дають хибні "unused" |
| `js/jscpd_duplicates` | jscpd | `**/*.{js,mjs,cjs,jsx,ts,tsx,vue}` | дублікати шукаються між файлами — без повного корпусу не порівняти |
| `bun/licensee` | licensee | `package.json`, `bun.lock`, `.licensee.json` | ліцензійний аудит усього dependency-дерева, не файлова перевірка |
| `security/scan`, `security/trufflehog` | trufflehog | `**/*`, `package.json`, `.trufflehog-exclude` | secret-scan по всьому дереву (і git-історії) за задумом тулу |

**C. Власна JS/rego-логіка без CLI (перевірена детально й додана після повторного розгляду)** — той самий критерій, лише механізм не "зовнішній тул", а inline-обхід дерева/git/registry:

| concern | механізм | було (glob) | стає | чому не можна обмежити файлами |
| ------- | -------- | ----------- | ---- | -------------------------------- |
| `vue/packages` ([main.mjs:552](npm/rules/vue/packages/main.mjs:552)) | fs/regex над `getMonorepoPackageRootDirs()` | `**/package.json`, `**/vite.config.*`, `**/jsconfig.json`, `**/src/vite-env.d.ts`, `**/*.vue`, `.vscode/extensions.json` | **без glob** — лише `--full` | перевіряє конвенцію Vue-пакета **загалом** (forbidden imports, volar-рекомендація, vitest devDeps), не окремий файл — `ctx.files` вже й так ігнорується |
| `k8s/manifests/` (залишок після §6-спліту) | kubescape (kustomize-build) + ~15 крос-файлових JS/rego валідаторів | `k8s/**/*.yaml`, `k8s/**/*.yml` | **без glob** — лише `--full` | svc↔svc_hl pairing, kustomization path-refs, hpa/pdb↔deployment matching — реально крос-файлові, кожен окремий yaml без сусідів не перевірити коректно |
| `changelog/consistency` ([main.mjs:741](npm/rules/changelog/consistency/main.mjs:741)) | git (`isMergeCommit`) + registry (`npm view`/PyPI) стан на workspace | `**/*` | **без glob** — лише `--full` | не аналізує вміст файлів узагалі — перевіряє git/registry-стан per workspace незалежно від `ctx.files`; **свідомо прийнята втрата**: changeset-гейт більше не спрацьовує в задачному delta, лише в CI `--full` — рішення підтверджене явно, не default |

Якщо профілювання пізніше виявить інші full-concerns з такою ж природою (CLI без file-arg чи власна логіка, що завжди обходить усе дерево/git/registry незалежно від `ctx.files`), додавати до цієї таблиці — механізм той самий (прибрати `lint.glob`).

### 6. k8s/manifests: розщепити лише `kubeconform`-крок на per-file

`kubeconform` — schema-валідація одного YAML-документа проти Kubernetes-схем ([`runKubeconform`](npm/rules/k8s/manifests/main.mjs:6662)) — не має крос-файлового стану: кожен маніфест валідується незалежно. Зараз викликається з `...dirs` (знайдені `k8s/`-корені через `findK8sRoots`, [main.mjs:6605](npm/rules/k8s/manifests/main.mjs:6605)), тобто завжди сканує **весь** k8s-корінь, навіть якщо змінився один файл.

| concern (dir)                | тул         | scope    | glob |
| ------------------------------ | ----------- | -------- | ---- |
| `k8s/kubeconform/` (новий)      | kubeconform | per-file | `k8s/**/*.{yaml,yml}` |
| `k8s/manifests/` (залишок)    | kubescape + ~15 крос-файлових JS/rego валідаторів | full | **без glob** — лише `--full` (див. §5-C) |

`kubeconform` приймає список конкретних файлів аргументом (замість директорій) — контракт як у `oxfmt`: `files === undefined ? [...dirs] : files.filter(f => YAML_RE.test(f))`. `kubescape` лишається в `k8s/manifests`, бо сканує **зібраний** маніфест через `kubectl kustomize <dir>` ([`runKustomizeBuild`](npm/rules/k8s/manifests/main.mjs:6726)) — це вихід kustomize-графу, не окремий файл, тому per-file тут неможливий за природою тулу; а крос-файлові валідатори (svc↔svc_hl, kustomization refs, hpa/pdb) за §5-C втрачають `lint.glob` і переходять у `--full`-only — delta ловить лише schema-порушення через новий `k8s/kubeconform/`, решта — тільки в CI.

### 7. changelog/consistency: паралелізація registry-викликів (не scope, а performance)

[main.mjs:789-791](npm/rules/changelog/consistency/main.mjs:789) — послідовний `for...of` з `await` усередині циклу:

```js
for (const manifest of published) {
  await checkPublishedWorkspace(manifest, subWorkspaces, getPublishedVersion, autofix, pass, fail, cwd)
}
```

Кожен виклик — мережевий: `npm view <name> version` ([main.mjs:294](npm/rules/changelog/consistency/main.mjs:294)) або PyPI `fetch` ([main.mjs:308](npm/rules/changelog/consistency/main.mjs:308)), обидва з `REGISTRY_TIMEOUT_MS = 10_000`. Зараз у репо лише **один** publishable workspace (`npm/`; `demo/` — local-only) — тобто послідовність зараз коштує щонайбільше один мережевий виклик, реального ефекту від паралелізації сьогодні нема. Але дизайн масштабується лінійно: кожен новий published workspace додає до 10с у найгіршому (timeout) сценарії послідовно, а мережева залежність у delta-шляху — та сама категорія ризику, що й v8r у `text/check` (§2 проблеми).

**Рішення:** замінити послідовний `for` на `Promise.all` (як у v8r §3) — `published.map(manifest => checkPublishedWorkspace(...))`, без зміни семантики (кожен виклик незалежний, `pass`/`fail` — накопичувальні колбеки, порядок репортів не критичний). Autofix/hook-режим (`AUTOFIX_ENV_VAR`) і так пропускає мережу ([main.mjs:626](npm/rules/changelog/consistency/main.mjs:626)) — паралелізація стосується лише звичайного (non-autofix) lint-прогону.

Ця оптимізація незалежна від §5-C: `changelog/consistency` втрачає `lint.glob` (стає `--full`-only), але коли `--full` таки запускається (CI), паралелізація реєстрових викликів так само зменшує його тривалість — обидві зміни сумісні й виконуються разом.

### 8. Merge detect+fix (T0) — де окремий "спочатку перевір" зайвий

Окремий аудит поточного T0-пайплайна (`detect → T0 patterns → LLM-ladder`, `.cursor/skills/n-lint/SKILL.md`) з ~167 concern'ів у `npm/rules/` знайшов **6** правил, де `T0Pattern.apply()` — це наскрізний виклик зовнішнього CLI, що **сам** проводить повний повторний аналіз при `--fix`/`--write`/`--all`, а `test()`/`apply()` не використовує жодних per-violation полів (`line`/`offset`/`kind`) з детекту — лише сам факт "цей `reason` траплявся" (щоб вирішити, чи взагалі викликати fix) і список файлів-кандидатів (який до того ж T0 будує **заново** через `git ls-files`/`readdirSync`, а не бере зі списку violations). Тобто детект дає T0-кроку рівно одну біту інформації ("чи запускати fix"), а сам fix — незалежний, ідемпотентний, самоаналізуючий виклик.

**Критерій:** (а) `apply()` re-invoke'ить CLI, що сам re-scan'ить вміст (без diff/patch на основі рядка/колонки з детекту); (б) жодне поле з `violation.data` (крім `v.file`/`v.reason`) не читається в `apply()`.

Мапінг на **пост-спліт** concern-и цієї спеки (не rule-level, як у первинному аудиті):

| було (rule-level, аудит) | стає (concern після §1-6 цієї спеки) | тул, що самоаналізує | `fix-*.mjs` | чому підходить |
| ------------------------- | -------------------------------------- | ----------------------- | ----------- | ---------------- |
| `js/eslint` | `js/eslint/` (без змін цією спекою) | `oxlint --fix` + `eslint --fix` | [fix-eslint.mjs:65-76](npm/rules/js/eslint/fix-eslint.mjs) | `apply()` бере лише `v.file`, не координати |
| `text/oxfmt` | `text/oxfmt/` (без змін цією спекою) | `oxfmt --write` | [fix-oxfmt.mjs:32-51](npm/rules/text/oxfmt/fix-oxfmt.mjs) | фільтрує список файлів, не координати |
| `style/lint` | `style/lint/` (без змін цією спекою) | `stylelint --fix` | [fix-lint.mjs:45-65](npm/rules/style/lint/fix-lint.mjs) | самоаналізуючий, без per-violation даних |
| `text/check` → | **`text/markdownlint/`**, **`text/run-shellcheck/`**, **`text/run-dotenv-linter/`** (3 з 5 нових concerns §1) | `markdownlint --fix`, `shellcheck`-fix, `dotenv-linter fix` | [fix-check.mjs:104-146](npm/rules/text/check/fix-check.mjs:104) (3 `toolFixPattern`, кожен keyed на свій `reason`) | кожен `apply()` перелічує файли **заново** (`listMarkdownFiles`/`listShellScriptPaths`/`listEnvFiles`) — вже й зараз ігнорує список конкретних violations, лише `reason`-гейт. **`text/cspell-fix/` і `text/run-v8r/` — НЕ мерджаться**: cspell без нативного `--fix` (LLM-класифікація слів, окремий процес), v8r взагалі без fix-режиму |
| `python/check` → | **`python/ruff/`** (1 з 3 нових concerns §"Рішення python/php/rego") | `ruff check --fix` + `ruff format` | [fix-check.mjs:40-64](npm/rules/python/check/fix-check.mjs:40) | keyed на `ruff-check-violation`/`ruff-format-violation`, `apply()` re-lists `**/*.py` через git, не бере файли з violations. **`python/mypy/` і `python/project/` — НЕ мерджаться**: mypy detect-only (немає autofix), `uv lock/sync`+`pip-licenses` не мають "self-fix" семантики (lockfile-операції, не codemod) |
| `rust/check` | `rust/check/` (лишається bundled — див. "Не в цій спеці") | лише **`cargo fmt --all`**-крок | [fix-check.mjs:39-58](npm/rules/rust/check/fix-check.mjs:39) | keyed на `cargo-fmt-violation` тільки; `clippy`/`cargo deny` **НЕ мерджаться** — clippy `--fix` свідомо не автоматизований (коментар у коді: "потенційно небезпечний"), deny.toml-генерація — окремий T0-патерн поза цим списком. Тобто merge стосується лише fmt-підмножини вже bundled `rust/check`, не всього concern-а |

**Що технічно означає "merge":** прибрати залежність T0 `apply()` від попереднього read-only `detect()`-проходу для цих 6 — замість "detect (читає) → якщо reason знайдено → T0 apply (пише, сам re-scan'ить)" робити один виклик: одразу `apply()`-еквівалент (`--fix`/`--write`) над кандидат-файлами, ідемпотентно (чистий файл — no-op, без потреби знати заздалегідь, що там є порушення). Читаний до/після diff (уже наявний патерн: `fixOverFiles`/`readOrNull`-порівняння в усіх 6 `fix-*.mjs`) сам дає список `touchedFiles` — це і є фактичний "detect"-результат, отриманий безкоштовно як побічний продукт fix-виклику, без окремого першого проходу тим самим тулом.

**Не стосується read-only/CI `--no-fix` шляху:** у чисто detect-only режимі (`lint --no-fix`, CI-гейт без мутацій) окремий read-only виклик (`oxlint`/`eslint` без `--fix`, `cargo fmt --check`, `ruff check` без `--fix` тощо) лишається обов'язковим — merge стосується виключно T0-фікс-пайплайна локальних/задачних прогонів, де мутація дозволена і так відбудеться.

Ці 6 (post-спліт: 8 concern-рівневих цілей — `js/eslint`, `text/oxfmt`, `style/lint`, `text/markdownlint`, `text/run-shellcheck`, `text/run-dotenv-linter`, `python/ruff`, `rust/check`(fmt-підмножина)) — мінімальний перелік станом на аудит `~167` concern'ів; решта T0-патернів або відсутні (concern без fix), або залежать від `violation.data` (line/offset — наприклад LLM-fix ladder tiers для нетривіальних правил), або мають нетривіальну apply-логіку (генерація конфігів, класифікація слів) — не підпадають під критерій.

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
