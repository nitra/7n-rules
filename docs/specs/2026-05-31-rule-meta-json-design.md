# Spec B: міграція `rules/*/auto.md` → data-driven `meta.json`

**Date:** 2026-05-31
**Status:** Узгоджено (brainstorming)
**Scope:** `npm/rules/` (33 правила) + `npm/scripts/auto-rules.mjs` + валідація. Skills (Spec A) уже на `meta.json` — не торкаємось.

## Контекст і проблема

Skills уже мігровані на `meta.json` (Spec A). Правила лишилися на гібриді:

- `npm/rules/<id>/auto.md` — **мертва проза-документація** (29 файлів). `auto-rules.mjs` їх **не читає**.
- Уся логіка автодетекту **захардкоджена** в `auto-rules.mjs`: `AUTO_RULE_ORDER` (28 правил), `collectAutoRuleFacts`, `autoRuleChecks[]`, спецлогіка (URL repo, nested package, content-скани). Прийменник «що вмикає правило» розкиданий між `auto.md` (текст для людини) і кодом (фактична умова) — два джерела істини, що роз'їжджаються.

Мета (рішення **G1** з brainstorming): перенести **декларацію** умови активації в `meta.json` (дані), лишити в коді лише **реалізацію** незводимих предикатів. `auto.md` видалити.

## Формат `npm/rules/<id>/meta.json`

Поле `auto` (опційне; відсутнє = opt-in) має **один із чотирьох видів**:

```jsonc
// Type B — always-on
{ "auto": "завжди" }

// Type C — залежність від інших правил (активується, коли ВСІ вже виявлені)
{ "auto": ["bun"] }
{ "auto": ["vue", "image-compress"] }

// Type A — наявність файлів/каталогів за glob (рядок або масив = OR)
{ "auto": { "glob": "**/*.vue" } }
{ "auto": { "glob": ["**/Dockerfile", "**/Dockerfile.*"] } }

// Type D — незводимий іменований предикат (реалізація в коді-реєстрі)
{ "auto": { "predicate": "repoUrlMarker", "arg": "https://github.com/abinbevefes/" } }
{ "auto": { "predicate": "depInAnyPackageJson", "arg": ["mssql"] } }
{ "auto": { "predicate": "jsBunDbSignal" } }
```

> rules `meta.json` **не має** поля `worktree` (це суто скілова вісь — окрема схема, рішення E2).

### Семантика glob (Type A)

- Рядок або масив рядків; кілька = OR (правило активне, якщо матчиться **хоч один**).
- **Корінь vs будь-де** кодується самим патерном: `package.json` (тільки корінь) vs `**/package.json` (будь-де).
- **Каталоги** — патерн `<dir>/**` (матчить, якщо в каталозі є хоч один файл). ⚠️ Свідома зміна семантики: поточний код тригерить і на **порожній** каталог (`existsSync(dir)`), новий — лише на непорожній. На практиці `k8s/`, `.github/workflows/`, `npm/` завжди непорожні; порожній каталог перевіряти сенсу нема. Зафіксовано як прийнятну зміну.

### Мапінг 13 Type-A правил на glob

| rule | glob |
|---|---|
| bun | `package.json` |
| php | `composer.json` |
| npm-module | `npm/**` |
| capacitor | `**/capacitor.config.json` |
| rust | `**/Cargo.toml` |
| rego | `**/*.rego` |
| vue | `**/*.vue` |
| js-lint | `**/*.{mjs,cjs,js,jsx,ts,tsx}` |
| style-lint | `**/*.{css,vue}` |
| docker | `["**/Dockerfile", "**/Dockerfile.*"]` |
| nginx-default-tpl | `**/{default.conf.template,default.conf,nginx.conf}` |
| ga | `.github/workflows/**` |
| k8s | `**/k8s/**` |

### Реєстр предикатів (Type D — 8 правил, +tauri)

Реалізація лишається в коді — реєстр `name → fn(cwd, facts, arg) → boolean`. У `meta.json` лише декларація `{ predicate, arg? }`.

| predicate | rules | що перевіряє |
|---|---|---|
| `repoUrlMarker` (arg: string) | abie, efes | підрядок у `repository.url` кореневого package.json |
| `gqlTaggedTemplate` | graphql | `gql\`…\`` у JS/TS/Vue source |
| `hasuraConfigMarker` | hasura | `config.yaml` містить `metadata_directory: metadata` |
| `depInAnyPackageJson` (arg: string[]) | js-mssql, js-bun-redis, tauri | будь-який пакет з arg у `dependencies` будь-якого package.json |
| `jsBunDbSignal` | js-bun-db | deps `pg`/`pg-format`/`mysql2` АБО import `sql`/`SQL` з `bun` |
| `nestedPackageWithoutVite` | js-run | вкладений (не кореневий) package.json без `vite` у devDependencies |

> `js-bun-db` лишається власним предикатом (deps OR content-scan) — не зводиться до `depInAnyPackageJson`.

## Порядок і opt-in

- **`AUTO_RULE_ORDER`** — прибрати хардкод-масив; виводити алфавітно зі сканування `npm/rules/*/meta.json` (як `AUTO_SKILL_ORDER` у скілах). Стабільний порядок = `localeCompare`.
- **`AUTO_RULE_DEPENDENCIES`** — більше не окрема константа: залежності живуть у `meta.json.auto` (Type C). Транзитивне розгортання (`resolveRuleDependencies`) лишається в коді як алгоритм, але читає залежності з meta-мапи.
- **Opt-in правила (без `auto`):** `ci4`, `feedback`, `release`, `worktree` — `meta.json` без поля `auto`.

## Зміни «мертвих» деталей (бонус міграції)

- **`tauri`**: мав `auto.md` (`@tauri-apps/api`), але **не був** у `AUTO_RULE_ORDER` → автодетект не працював. Мігруємо на `{ "predicate": "depInAnyPackageJson", "arg": ["@tauri-apps/api"] }` — **автодетект tauri запрацює вперше** (узгоджено з користувачем). Додати в тести.
- **`tempo` fact** — збирається в `collectAutoRuleFacts`, ніде не вживається. Прибрати при рефакторі.
- **`RULE_MIGRATIONS`** (`image` → `[image-compress, image-avif]`) і `migrateRuleIds`/`detectLegacyRuleIds` — **не чіпаємо** (legacy-міграція id, ортогональна до автодетекту).

## Архітектура коду

### `npm/scripts/lib/rule-meta.mjs` (новий)

Дзеркало `skill-meta.mjs`:

- `readRuleMetaRaw(ruleDir) → object|null` — читання/JSON-парс `meta.json` (як `readSkillMetaRaw`).
- `parseRuleAutoSpec(value) → RuleAutoSpec|null` — нормалізує `auto` у дискриміновану форму: `{always}` | `{rules}` | `{glob}` | `{predicate, arg}` | `null`.
- `@typedef RuleAutoSpec`.

### `npm/scripts/lib/rule-predicates.mjs` (новий)

Реєстр незводимих предикатів: `export const RULE_PREDICATES = { repoUrlMarker, gqlTaggedTemplate, hasuraConfigMarker, depInAnyPackageJson, jsBunDbSignal, nestedPackageWithoutVite }`. Кожен — чиста (наскільки можливо) функція над зібраними фактами/деревом. Реалізації **переносяться** з наявного `auto-rules.mjs` (логіка не змінюється, лише виноситься за іменем).

### `npm/scripts/auto-rules.mjs` (переписати ядро)

- `discoverRuleAutoActivation(rulesDir)` — скан `meta.json`, повертає `Record<ruleId, RuleAutoSpec>` + похідний алфавітний порядок (як `discoverSkillAutoActivation`).
- `collectAutoRuleFacts` лишається (одноразовий прохід дерева збирає шляхи + content-факти для предикатів).
- `detectAutoRules` — замість хардкод-`autoRuleChecks[]`: для кожного правила обчислити `auto`-spec:
  - `glob` → тест проти зібраного набору шляхів;
  - `predicate` → виклик `RULE_PREDICATES[name](cwd, facts, arg)`;
  - `rules` → відкласти в граф залежностей;
  - `always` → одразу;
  - відсутнє → opt-in.
  Потім `resolveRuleDependencies` транзитивно. Вивід — у похідному алфавітному порядку.
- `disable-rules`, `mergeConfigWithAutoDetected`, `migrateRuleIds` — без змін.

## Валідація

### `npm/schemas/rule-meta.json` (новий)

JSON-схема: `auto` опційне, `oneOf`:
- `{ const: "завжди" }`
- `{ type: array, items: string, minItems: 1 }` (rule deps)
- `{ type: object, required: [glob], properties: { glob: stringOrStringArray }, additionalProperties: false }`
- `{ type: object, required: [predicate], properties: { predicate: string, arg: <any> }, additionalProperties: false }`

`additionalProperties: false` на верхньому рівні. **Без** `worktree`. Зареєструвати в `npm/schemas/v8r-catalog.json` для `npm/rules/*/meta.json`.

### Check-концерн `npm/rules/npm-module/js/rule_meta.mjs` (новий, дзеркало `skill_meta.mjs`)

- кожен `npm/rules/<id>/` має валідний `meta.json` (або відсутній `auto` = opt-in, теж валідно);
- `auto.md` **не існує** (fail, якщо лишився — міграція завершена);
- якщо `auto` присутнє — `parseRuleAutoSpec` повертає не-null; для `predicate` — імʼя є в `RULE_PREDICATES`.

## Тести

- `npm/scripts/lib/tests/rule-meta.test.mjs` (новий) — `parseRuleAutoSpec` для всіх 4 форм + невалідні; `readRuleMetaRaw`.
- `npm/scripts/lib/tests/rule-predicates.test.mjs` (новий) — кожен предикат на tmp-репо (`withTmpDir`): repoUrlMarker, depInAnyPackageJson, jsBunDbSignal, nestedPackageWithoutVite, gqlTaggedTemplate, hasuraConfigMarker.
- `npm/scripts/tests/auto-rules.test.mjs` — **зберегти всі ~50 кейсів** (вони перевіряють *поведінку* `detectAutoRules`, не внутрішню реалізацію). Оновити лише фікстури, якщо тест створював `auto.md`. Додати кейс для **tauri** (тепер автодетектиться). Усі наявні assertions щодо порядку/детекту мають лишитись зеленими — це головний регресійний контракт.
- check/rego тести `rule_meta` концерну.
- Регресія: повний `npm` сюїт зелений.

## Міграція 33 правил

- Створити `meta.json` у кожному з **29** правил з `auto.md` (за таблицями вище: 13 glob, 4 always, 3 deps, 8+1 predicate — включно з tauri).
- 4 opt-in правила (`ci4`, `feedback`, `release`, `worktree`) — або без `meta.json`, або `meta.json` без `auto`. **Рішення:** створити `meta.json` без `auto` для одноманітності (check-концерн вимагатиме `meta.json` у кожного правила — як у скілів). `worktree` уже має `meta.json`? Ні — у нього лише `worktree.mdc` (pure-doc rule). Додати `meta.json` без `auto`.
- Видалити всі 29 `auto.md`.

> ⚠️ `worktree` правило — pure-doc (Spec worktree-CLI), opt-in. Дати йому `meta.json` без `auto`.

## Документація і реліз

- `.cursor/rules/scripts.mdc` — оновити опис структури правила: `auto.md` → `meta.json` (4 форми `auto`); згадати реєстр предикатів.
- `npm/README.md` — структура правила: `auto.md` → `meta.json`.
- Change-файл (`bump: minor`, `section: Changed`).

## Out of scope

- Зміна самих умов активації (крім увімкнення tauri) — поведінка детекту зберігається 1:1.
- `RULE_MIGRATIONS` / legacy id — не чіпаємо.
- `worktree`-поле для правил — не вводимо (скілова вісь).
- Об'єднання rules+skills meta-парсерів у один модуль — лишаємо два дзеркальні (`skill-meta.mjs`, `rule-meta.mjs`); спільне витягувати лише якщо з'явиться третій споживач (YAGNI).
