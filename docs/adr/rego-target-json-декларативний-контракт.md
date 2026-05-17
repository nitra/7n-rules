# Декларативний контракт target.json для Rego-only правил

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

CLI `npx @nitra/cursor check` виявляє правила лише через `rules/<id>/js/check.mjs`, тому pure-Rego правило без JS-обгортки повністю ігнорується. Водночас таргети для `lint-conftest.mjs:TARGETS` і `runConftestBatch`-виклики в `check.mjs` дублюються вручну — додати нову полісі означає оновити обидва місця.

## Рішення/Процедура/Факт

Запроваджено схему `policy/<name>/target.json` — декларативний файл поряд із `.rego`:

```
npm/rules/<id>/policy/<name>/
├── <name>.rego
├── <name>_test.rego
└── target.json
```

**Поля `target.json`:**

- `namespace` — повна назва пакету (`<id>.<name>`), авторитетна відносно `package`-декларації у Rego-файлі. Відокремлення необхідне, бо Rego-namespace може містити підкреслення (`abie.clean_merged_ignore_branches`), а каталог — ні.
- `gates` — масив умов, що визначають чи запускати полісі (виконуються sequential, cheap-first):
  - `{ "type": "requireRule", "rule": "<id>" }` — перевіряє `.n-cursor.json → rules[]` (O(1)).
  - `{ "type": "requireFileExists", "path": "<rel>" }` — `existsSync` від `cwd` (O(1)).
  - `{ "type": "requireFileInTree", "glob": "**/*.rego", "minCount": 1 }` — обхід дерева через `walkDir` (O(n), завжди останній).
- `files` — спосіб знаходити файли для conftest:
  - `{ "type": "single", "path": ".vscode/extensions.json" }` — один файл відносно `cwd`; skip без помилки якщо відсутній.
  - `{ "type": "walk", "glob": "k8s/**/*.{yaml,yml}" }` — всі файли дерева, що матчать glob.

**Зміни в CLI:**

`discoverCheckScripts()` у `n-cursor.js:993` розширюється: правило потрапляє в `available`, якщо є хоча б один `policy/*/target.json`, навіть без `js/check.mjs`. При виконанні замість `import(check.mjs).check()` CLI сам проходить по `target.json`, виконує gates sequential і викликає `runConftestBatch`. `lint-conftest.mjs:TARGETS` замінюється читанням `target.json` замість жорсткого масиву — одне джерело правди.

Правила з динамічними батчами (наприклад `abie` з `collectDeploymentDirs`, cross-rule gating, kustomize-резолюція) лишають `check.mjs` і не мігрують на декларативний формат.

## Обґрунтування

Усуває дублювання між `lint-conftest.mjs:TARGETS` і `runConftestBatch`-викликами в `check.mjs`. Дозволяє pure-Rego правила без JS-обгортки. Порядок gates cheap-first (requireRule → requireFileExists → requireFileInTree) мінімізує непотрібні `walkDir`-обходи.

## Розглянуті альтернативи

- **Frontmatter у `<id>.mdc`** — відкинуто: `.mdc` копіюється в проєкт, метадані CLI не повинні жити там.
- **Авто-discover через `input.kind` у Rego** — відкинуто: feed усім YAML марнує CPU і не підходить для не-YAML цілей.
- **Залишити `check.mjs` обов'язковим** — не усуває дублювання між `lint-conftest.mjs` і `check.mjs`.
- **`check.json` на рівні правила з повним DSL** — складніший; виправданий лише якщо з'являться правила з cross-rule gating або нетривіальними динамічними умовами.

## Зачіпає

`npm/bin/n-cursor.js` (функція `discoverCheckScripts`), `npm/scripts/lint-conftest.mjs` (заміна `TARGETS`), `npm/scripts/utils/run-conftest-batch.mjs`, усі `npm/rules/*/policy/` (нові `target.json`)

## Update 2026-05-15

### Розширена архітектура: `rule.json` + `target.json` + гібридний режим JS

#### Чому `target.json`, а не `target.mdc`

`discoverBundledRuleNames()` у `n-cursor.js:135` шукає `rules/<id>/<id>.mdc` і копіює ці файли в `.cursor/rules/n-<id>.mdc` цільових проєктів. Файл `target.mdc` поряд із `.rego` технічно не потрапляє під цей шаблон (не матчить `<id>.mdc`), але вносить семантичну плутанину для нових авторів правил. `target.json` переважає: JSON Schema → `bun run lint-text` ловить помилки на CI; простий `JSON.parse` без додаткових парсерів; відсутність конфлікту з `.mdc`-семантикою.

#### Три рівні декларації

1. **`js/check*.mjs`** — CLI автоматично запускає всі `.mjs` у `rules/<id>/js/`, крім `*.test.mjs`. Порядок виконання алфавітний. Розбивка великих файлів (`check-firebase.mjs`, `check-k8s-overlays.mjs`) стає природною конвенцією.
2. **`rules/<id>/rule.json`** — rule-level applies-гейт (AND-комбінація): `requireRule`, `requireFileExists`, `requireFilesByGlob`. Без файлу правило вважається завжди активним.
3. **`policy/<name>/target.json`** — per-policy таргет: `{ single, required, missingMessage }` або `{ walkGlob, required }`. CLI читає ці файли сам і викликає `runConftestBatch` без участі JS.

#### Поведінка гібридних правил (JS + policy)

CLI спершу виконує декларативні targets з `policy/*/target.json`, потім JS-файли. JS відповідає **лише за обчислювані і cross-file частини** (наприклад `health_check_policy` — `hc.yaml` поруч із `Deployment`). JS не повторює виклики `runConftestBatch` для статично задекларованих targets.

#### Міграційні кандидати

- `npm/rules/rego/` — перший кандидат: видалення `js/check.mjs`, додавання `rule.json` + `policy/*/target.json`.
- `npm/rules/abie/` — гібридна міграція: три статичні targets → `target.json`; `health_check_policy` і ua-patches лишаються у `js/check-*.mjs`.
- `npm/scripts/lint-conftest.mjs` — жорстко прописана таблиця `TARGETS` замінюється на динамічне читання `rule.json` + `target.json`.

**Нові артефакти:** `npm/schemas/rule.json`, `npm/schemas/target.json`, `npm/scripts/utils/evaluate-applies.mjs`.

**Зачіпає:** `npm/bin/n-cursor.js` (`discoverCheckableRules`, `runChecks`, `runDeclaredTargets`, `evaluateApplies`), `npm/scripts/lint-conftest.mjs`, `npm/rules/rego/`, `npm/rules/abie/`.

## Update 2026-05-15

### JS-discovery конвенція (check-*.mjs)

CLI імпортує та запускає всі `rules/<id>/js/check.mjs` і `rules/<id>/js/check-*.mjs`; файли `*.test.mjs` ігноруються, шейред-хелпери живуть у `rules/<id>/js/utils/` або `npm/scripts/utils/`. Порядок виконання — алфавітний. Монолітні `check.mjs` (наприклад `abie`, ~1153 рядки) розпилюються на `check-firebase.mjs`, `check-k8s-base.mjs` тощо. Спільний стан між файлами — module-level singleton-кеш у хелпері: перший виклик платить за `walkDir`, наступні — безкоштовно.

### applies-гейтинг (inline в JS)

Умовна логіка (наприклад, «правило abie увімкнено в `.n-cursor.json`» або «в репо є `.rego`-файли») лишається у відповідному `check-*.mjs`. Окремий `rule.json` з `applies`-блоком не вводиться: для pure-Rego правил без жодного `.mjs` це питання відкладається до появи таких правил.

### Glob-парсер

Обирається найшвидший за бенчмарком для шаблонів типу `**/*.{yaml,yml}` (кандидати: `picomatch`, вбудований `Bun.Glob`).

**Зачіпає (доповнення):** `npm/bin/n-cursor.js` (`discoverCheckScripts` → `discoverCheckableRules`, `runChecks`), `npm/rules/*/js/check.mjs` (розпиляти на `check-*.mjs` + `js/utils/`), `npm/scripts/utils/run-conftest-batch.mjs` (викликається CLI напряму, не лише з JS), `npm/scripts/lint-conftest.mjs:TARGETS` (поступово замінюється `target.json`-файлами).
