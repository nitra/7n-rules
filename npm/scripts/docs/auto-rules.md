# auto-rules.mjs

## Огляд

Модуль `npm/scripts/auto-rules.mjs` — це **движок автодетекту правил** для конфігурації
`.n-cursor.json`. Його задача — за метаданими з `npm/rules/<id>/meta.json` і за станом
проєкту-користувача (вміст файлів та структура дерева) вирахувати, які правила слід
автоматично активувати в конфізі CLI `n-cursor`.

Архітектура data-driven: список правил, порядок і граф залежностей **не зашиваються в код**
— вони виводяться з `meta.json` кожного правила в `npm/rules/<id>/`. Кожне правило в `meta.json`
має поле `auto` з однією зі специфікацій активації (`always`, `glob`, `predicate`, `rules`).

Основні відповідальності модуля:

- **Discovery**: сканування `npm/rules/<id>/meta.json` і побудова мапи `RULE_AUTO_ACTIVATION`
  з нормалізованими spec-ами автоактивації (`discoverRuleAutoActivation`).
- **Експорт стабільного порядку правил**: алфавітний `AUTO_RULE_ORDER` замість хардкод-масиву.
- **Експорт графа залежностей**: `AUTO_RULE_DEPENDENCIES` із spec-ів типу `rules`.
- **Збір content-фактів**: обхід дерева репо й збір ознак (`hasBunSqlImport`,
  `hasGqlTaggedTemplates`, `hasHasuraConfig`, `hasRegoFile`, `hasTempoDir`)
  через `collectAutoRuleFacts` — для зворотної сумісності з прямими читачами та для
  предикатів типу `gqlTaggedTemplate`/`hasuraConfigMarker`/`jsBunDbSignal`.
- **Збір relative-posix-шляхів**: `collectRepoPaths` (повертає і файли, і каталоги — для
  glob-матчингу, який може цілитися в порожні директорії типу `npm`, `k8s`, `.github/workflows`).
- **Обчислення активних правил**: `detectAutoRules` запускає `specMatches` для кожного
  правила (з пропуском типу `rules`), потім транзитивно розгортає залежності через
  `resolveRuleDependencies` і повертає id у стабільному порядку.
- **Злиття з конфігом**: `mergeConfigWithAutoDetected` лише **додає** в `rules`/`skills`
  виявлені id, поважаючи `disable-rules`/`disable-skills` й нормалізацію legacy-id
  через `migrateRuleIds`.

Автодетект **скілів** (не правил) — у сусідньому модулі `./auto-skills.mjs`; цей файл
лише приймає вже виявлені `detectedSkills` у `mergeConfigWithAutoDetected`.

## Експорти / API

Реекспорти з `./lib/rule-meta-helpers.mjs` (для одного публічного entry-point):

- `detectLegacyRuleIds`
- `getRepositoryUrl`
- `isMonorepoPackage`
- `migrateRuleIds`
- `normalizeIdList`
- `RULE_MIGRATIONS`

Власні експорти модуля:

| Експорт                       | Тип                              | Призначення                                                                 |
| ----------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `discoverRuleAutoActivation`  | `function`                       | Скан `npm/rules/<id>/meta.json` → мапа id → `RuleAutoSpec`.                 |
| `AUTO_RULE_ORDER`             | `readonly string[]` (frozen)     | Алфавітний порядок усіх правил із розпізнаним `auto`.                       |
| `AUTO_RULE_DEPENDENCIES`      | `readonly Record<string,string[]>` (frozen) | Граф залежностей із spec-ів типу `rules`.                       |
| `collectAutoRuleFacts`        | `async function`                 | Обхід дерева й збір content-фактів.                                         |
| `detectAutoRules`             | `async function`                 | Головна функція: повертає `{ rules: string[] }` за `meta.json` правил.      |
| `mergeConfigWithAutoDetected` | `function`                       | Зливає виявлені rules+skills у конфіг із поправкою на legacy-id.            |

Внутрішні (не експортовані):

- `sourceContentHasBunSqlImport`
- `shouldScanFileForGql`, `updateGqlFactFromFile`
- `shouldScanFileForBunSql`, `updateBunSqlFactFromFile`
- `updateHasuraFactFromFile`
- `processFileEntry`
- `collectRepoPaths`
- `resolveRuleDependencies`
- `specMatches`

Внутрішні константи:

- `PACKAGE_ROOT` — корінь пакету (`dirname(dirname(fileURLToPath(import.meta.url)))`).
- `RULES_DIR` — `${PACKAGE_ROOT}/rules`.
- `RULE_AUTO_ACTIVATION` — результат `discoverRuleAutoActivation()`, обчислюється на load-time.
- `HASURA_CONFIG_MARKER = 'metadata_directory: metadata'`.
- `REGO_RE = /\.rego$/iu`.
- `IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])`.
- `DEFAULT_DISABLED_LIST = Object.freeze([])`.

## Функції

### `discoverRuleAutoActivation(rulesDir = RULES_DIR)`

- **Сигнатура**: `(rulesDir?: string) => Record<string, RuleAutoSpec>`
- **Параметри**:
  - `rulesDir` — override кореня `rules/` (для тестів). За замовчуванням — `RULES_DIR`.
- **Повертає**: мапу `id → RuleAutoSpec` (лише правила, де `parseRuleAutoSpec(raw.auto)`
  повернув не-null).
- **Side effects**: синхронне читання `readdirSync` й читання `meta.json` кожного підкаталогу
  через `readRuleMetaRaw`. Не модифікує файли.
- **Обробка помилок**: якщо `rulesDir` недоступний — повертає порожній обʼєкт. Пропускає
  директорії з імʼям, що починається на `.`, і не-директорії.

### `AUTO_RULE_ORDER` / `AUTO_RULE_DEPENDENCIES`

Не функції — обчислюються одноразово на load-time:

- `AUTO_RULE_ORDER = Object.freeze(Object.keys(RULE_AUTO_ACTIVATION).toSorted(localeCompare))`
- `AUTO_RULE_DEPENDENCIES = Object.freeze(Object.fromEntries(...))` — будується з
  entries, де `'rules' in spec` (тобто spec типу C — звичайне посилання на залежні правила).
  Значення кожного ключа — заморожений масив id залежностей.

### `sourceContentHasBunSqlImport(content, relativePath)`

- **Сигнатура**: `(content: string, relativePath: string) => boolean`
- **Параметри**:
  - `content` — повний вміст файлу.
  - `relativePath` — шлях posix відносно кореня репо.
- **Повертає**: `true`, якщо в тексті є `import { sql }` або `import { SQL }` з `"bun"`.
- **Side effects**: жодних.
- **Логіка**: викликає `contentForVueImportScan(content, relativePath)` (витягує `<script>`
  для `.vue`) і передає в `textHasBunSqlImport`.

### `shouldScanFileForGql(relPath, facts)`

- **Сигнатура**: `(relPath: string, facts: { hasGqlTaggedTemplates: boolean }) => boolean`
- **Повертає**: `true`, лише якщо факт ще не встановлено і файл — підходяще джерело
  (`isGqlScanSourceFile`) та не входить у виключення (`shouldSkipFileForGqlScan`).
- **Side effects**: жодних.

### `updateGqlFactFromFile(absPath, relPath, facts)`

- **Сигнатура**: `async (absPath: string, relPath: string, facts: { hasGqlTaggedTemplates: boolean }) => Promise<void>`
- **Side effects**: читає файл (`readFile utf8`), мутує `facts.hasGqlTaggedTemplates = true`,
  якщо `sourceFileHasGqlTaggedTemplate` дав true.
- **Обробка помилок**: `try/catch` — пошкоджені/недоступні файли мовчки ігноруються.

### `shouldScanFileForBunSql(relPath, facts)`

- **Сигнатура**: `(relPath: string, facts: { hasBunSqlImport: boolean }) => boolean`
- **Повертає**: `true`, якщо факт ще не встановлено і файл-кандидат (ті самі правила,
  що для gql: `isGqlScanSourceFile` + `!shouldSkipFileForGqlScan`).
- **Side effects**: жодних.

### `updateBunSqlFactFromFile(absPath, relPath, facts)`

- **Сигнатура**: `async (absPath: string, relPath: string, facts: { hasBunSqlImport: boolean }) => Promise<void>`
- **Side effects**: читає файл, мутує `facts.hasBunSqlImport = true` за позитивної відповіді
  `sourceContentHasBunSqlImport`.
- **Обробка помилок**: `try/catch` — мовчки ігнорує помилки I/O.

### `updateHasuraFactFromFile(absPath, fileName, facts)`

- **Сигнатура**: `async (absPath: string, fileName: string, facts: { hasHasuraConfig: boolean }) => Promise<void>`
- **Логіка**: якщо факт уже встановлений або `fileName !== 'config.yaml'` — ранній вихід.
  Інакше читає файл і мутує `facts.hasHasuraConfig = true`, якщо вміст містить
  підрядок `'metadata_directory: metadata'` (`HASURA_CONFIG_MARKER`).
- **Side effects**: один `readFile`, мутація `facts`.
- **Обробка помилок**: `try/catch` — мовчки ігнорує.

### `processFileEntry(absPath, root, facts)`

- **Сигнатура**: `async (absPath: string, root: string, facts: AutoRuleFacts) => Promise<void>`
- **Параметри**:
  - `absPath` — абсолютний шлях файлу.
  - `root` — абсолютний корінь репо.
  - `facts` — обʼєкт `{ hasBunSqlImport, hasGqlTaggedTemplates, hasHasuraConfig, hasRegoFile }`.
- **Логіка** для одного файлу:
  1. Обчислює `rel = relative(root, absPath)` з нормалізацією `\\` → `/`.
  2. Якщо шлях матчить `\.rego$` — встановлює `facts.hasRegoFile = true`.
  3. Якщо `shouldScanFileForGql` — викликає `updateGqlFactFromFile`.
  4. Якщо `shouldScanFileForBunSql` — викликає `updateBunSqlFactFromFile`.
  5. Завжди викликає `updateHasuraFactFromFile` (вона сама перевірить `fileName`).
- **Side effects**: до 3 потенційних `readFile` + мутації `facts`.

### `collectAutoRuleFacts(root)` — **експортована**

- **Сигнатура**: `async (root: string) => Promise<{ hasBunSqlImport: boolean, hasGqlTaggedTemplates: boolean, hasHasuraConfig: boolean, hasRegoFile: boolean, hasTempoDir: boolean }>`
- **Параметри**: `root` — абсолютний шлях кореня репо.
- **Повертає**: Promise з обʼєктом content-фактів.
- **Логіка**:
  1. Ініціалізує `facts` усіма `false`.
  2. Внутрішня рекурсія `walk(dir)` через `readdir({ withFileTypes: true })`:
     - якщо `entry.isDirectory()` і імʼя не в `IGNORED_DIR_NAMES`:
       - якщо `entry.name === 'tempo'` — встановлює `facts.hasTempoDir = true`;
       - рекурсивний `await walk(absPath)`;
     - якщо `entry.isFile()` — `await processFileEntry(absPath, root, facts)`.
  3. Помилки `readdir` мовчки призводять до `return` (пропускаємо каталог).
- **Side effects**: рекурсивний обхід FS, читання вмісту файлів-кандидатів.
- **Зворотна сумісність**: `hasRegoFile`/`hasTempoDir` лишаються для прямих читачів
  (тести, зовнішній код), хоча активація відповідних правил уже data-driven.

### `collectRepoPaths(root)` — внутрішня

- **Сигнатура**: `async (root: string) => Promise<string[]>`
- **Повертає**: масив relative-posix-шляхів **і файлів, і каталогів**.
- **Чому й каталоги**: частина glob-спеків указує на самі директорії (`npm`, `k8s`,
  `.github/workflows`), які можуть бути порожніми — без цього правила `npm-module`, `k8s`,
  `ga` не активовувалися б на дереві без файлів усередині.
- **Логіка**: внутрішня `walk(dir)` через `readdir({ withFileTypes: true })`. На директорії
  (не в `IGNORED_DIR_NAMES`) — пушить шлях і рекурсує. На файл — пушить шлях. Помилки
  `readdir` мовчки повертають з гілки.

### `resolveRuleDependencies(detectedRules, addRule)`

- **Сигнатура**: `(detectedRules: string[], addRule: (ruleId: string) => void) => void`
- **Параметри**:
  - `detectedRules` — мутабельний список вже зібраних id (мутується через `addRule`).
  - `addRule` — callback з фабрики, що поважає `disable-rules` й дублі.
- **Логіка**: fixed-point loop — повторно проходить усіма парами `[ruleId, deps]` з
  `AUTO_RULE_DEPENDENCIES`. На кожному проході: якщо правило ще не в детекті й **усі**
  залежності вже в детекті — викликає `addRule(ruleId)` і, якщо довжина зросла,
  встановлює `changed = true` для наступної ітерації.
- **Гарантія**: дозволяє транзитивні ланцюги `a → b → c` незалежно від порядку оголошення
  в meta-файлах.
- **Side effects**: викликає переданий `addRule` (який мутує `detectedRules`).

### `specMatches(spec, ctx)`

- **Сигнатура**: `async (spec: RuleAutoSpec, ctx: { root: string, facts: object, paths: string[], packageJsonParsed: unknown }) => Promise<boolean>`
- **Логіка** — диспетчинг за дискримінантним ключем spec:
  - `'always' in spec` → `true` безумовно.
  - `'glob' in spec` → конвертує кожен glob у regex через `globToRegex`; повертає `true`,
    якщо **будь-який** шлях у `ctx.paths` матчить **будь-який** regex.
  - `'predicate' in spec` → шукає функцію `RULE_PREDICATES[spec.predicate]`. Якщо не знайдено
    — `false`. Інакше викликає за іменем предиката з різними сигнатурами:
    - `repoUrlMarker` → `fn(ctx.packageJsonParsed, spec.arg)` — читає корений `package.json`
      + arg-маркер.
    - `gqlTaggedTemplate` або `hasuraConfigMarker` → `fn(ctx.facts)` — content-факти.
    - `jsBunDbSignal` → `fn(ctx.root, ctx.facts)` — комбінований сигнал.
    - інші (`depInAnyPackageJson`, `nestedPackageWithoutVite`) → `fn(ctx.root, spec.arg)`.
  - Якщо жодна гілка не спрацювала — `false`.
- **Side effects**: залежать від конкретного предиката (можуть читати FS).

### `detectAutoRules({ root, availableRules, packageJsonParsed, disableRules })` — **експортована**

- **Сигнатура**: `async (params: { root: string, availableRules: string[], packageJsonParsed: unknown, disableRules?: string[] }) => Promise<{ rules: string[] }>`
- **Параметри**:
  - `root` — абсолютний корінь репо-аналізованого проєкту.
  - `availableRules` — перелік доступних правил із пакету `n-cursor`.
  - `packageJsonParsed` — розпарсений кореневий `package.json` користувача (або `null`).
  - `disableRules` — список з конфігу (за замовчуванням `DEFAULT_DISABLED_LIST = []`).
- **Повертає**: `{ rules: string[] }` — id у стабільному порядку `AUTO_RULE_ORDER`.
- **Логіка**:
  1. `facts = await collectAutoRuleFacts(root)` — content-факти.
  2. `paths = await collectRepoPaths(root)` — relative-posix-шляхи для glob.
  3. `normalizedRules` — `Set` доступних id (lower-case, trim) — для перевірки доступності.
  4. `disableRulesSet` — `Set` з `disableRules`.
  5. `detectedRules: string[] = []` + локальна функція `addRule(ruleId)`:
     - пропускає id, якщо його **немає в `normalizedRules`**, або є в `disableRulesSet`,
       або вже в `detectedRules`;
     - інакше пушить.
  6. Перший прохід — над `Object.entries(RULE_AUTO_ACTIVATION)`:
     - пропускає spec-и типу `rules` (вони обробляються в наступному кроці);
     - для решти — `await specMatches(spec, { root, facts, paths, packageJsonParsed })`;
     - якщо true — `addRule(ruleId)`.
  7. `resolveRuleDependencies(detectedRules, addRule)` — транзитивне розгортання.
  8. Фінальне `rules = AUTO_RULE_ORDER.filter(r => detectedRules.includes(r))` — стабільний порядок.
- **Side effects**: повний обхід дерева репо (двічі — у `collectAutoRuleFacts` і
  `collectRepoPaths`) + читання вмісту файлів-кандидатів + потенційні читання з боку
  предикатів.

### `mergeConfigWithAutoDetected({ config, detectedRules, detectedSkills })` — **експортована**

- **Сигнатура**: `(params: { config: { rules: unknown, skills?: unknown, ['disable-rules']?: unknown, ['disable-skills']?: unknown }, detectedRules: string[], detectedSkills: string[] }) => { rules: string[], skills: string[] } & Record<string, unknown>`
- **Логіка**:
  1. `existingRules = migrateRuleIds(normalizeIdList(config.rules))` — нормалізує і
     мігрує legacy-id.
  2. `existingSkills = normalizeIdList(config.skills)`.
  3. `disableRules = migrateRuleIds(normalizeIdList(config['disable-rules']))`.
  4. `disableSkills = normalizeIdList(config['disable-skills'])`.
  5. Будує `rules = [...existingRules]`, додає кожен `detectedRules[i]`, якщо його ще
     немає в `rules` **і** він не в `disableRules`.
  6. Аналогічно для `skills` (з `disableSkills`).
  7. `normalized = { rules, skills }`. Додає `'disable-rules'`/`'disable-skills'` лише
     якщо вони не порожні.
- **Семантика**: **не прибирає** елементи, що були в конфізі вручну (idempotent додавання).
- **Side effects**: жодних — pure-функція над переданим конфігом.

## Залежності

### Сторонні / Node.js (stdlib)

- `node:fs` → `readdirSync` (для синхронного скану `rules/` на load-time).
- `node:fs/promises` → `readdir`, `readFile` (асинхронний обхід проєкту й читання вмісту).
- `node:path` → `basename`, `dirname`, `join`, `relative` (нормалізація шляхів).
- `node:url` → `fileURLToPath` (резолв `PACKAGE_ROOT` з `import.meta.url`).

### Внутрішні модулі пакету

- `../rules/npm-module/js/package_structure.mjs` → `globToRegex` — конвертація glob у regex
  для spec типу `glob`.
- `../rules/js-bun-db/lib/bun-sql-scan.mjs` → `textHasBunSqlImport` — детекція `import { sql }`
  з `"bun"` у текстовому вмісті.
- `../rules/graphql/lib/graphql-gql-scan.mjs` → `isGqlScanSourceFile`,
  `shouldSkipFileForGqlScan`, `sourceFileHasGqlTaggedTemplate` — політика сканування для gql.
- `../rules/vue/lib/vue-forbidden-imports.mjs` → `contentForVueImportScan` — витягування
  `<script>` для `.vue` перед сканом імпортів.
- `./lib/rule-meta.mjs` → `parseRuleAutoSpec`, `readRuleMetaRaw` — парсинг `meta.json` правил.
- `./lib/rule-meta-helpers.mjs` → `migrateRuleIds`, `normalizeIdList` (використання) +
  реекспорти `detectLegacyRuleIds`, `getRepositoryUrl`, `isMonorepoPackage`, `RULE_MIGRATIONS`.
- `./lib/rule-predicates.mjs` → `RULE_PREDICATES` — реєстр незводимих предикатів за іменами.

### Дотичні (не імпортуються прямо, але семантично повʼязані)

- `./auto-skills.mjs` — автодетект скілів; результати приймає `mergeConfigWithAutoDetected`
  через `detectedSkills`.
- `npm/rules/<id>/meta.json` — джерело даних для `discoverRuleAutoActivation`.

## Потік виконання / Використання

### Сценарій 1: автогенерація `.n-cursor.json`

Очікувана послідовність викликача (наприклад, CLI `n-cursor init`):

1. Зчитати поточний `.n-cursor.json` користувача (або порожній обʼєкт).
2. Зчитати кореневий `package.json` користувача (parse → `packageJsonParsed`).
3. Отримати список доступних правил із пакету (наприклад, із `npm/rules/*/`).
4. Викликати `const { rules } = await detectAutoRules({ root, availableRules, packageJsonParsed, disableRules })`.
5. Викликати `detectAutoSkills(...)` з `./auto-skills.mjs` (поза цим файлом) → `detectedSkills`.
6. `const normalized = mergeConfigWithAutoDetected({ config, detectedRules: rules, detectedSkills })`.
7. Записати `normalized` назад у `.n-cursor.json`.

### Сценарій 2: програмне читання фактів

Якщо потрібно лише сирі content-факти (наприклад, для іншого скрипта):

```
import { collectAutoRuleFacts } from 'n-cursor/scripts/auto-rules.mjs'
const facts = await collectAutoRuleFacts(process.cwd())
// facts.hasBunSqlImport, facts.hasGqlTaggedTemplates, facts.hasHasuraConfig,
// facts.hasRegoFile, facts.hasTempoDir
```

### Сценарій 3: інспекція реєстру правил

```
import { discoverRuleAutoActivation, AUTO_RULE_ORDER, AUTO_RULE_DEPENDENCIES } from 'n-cursor/scripts/auto-rules.mjs'
const reg = discoverRuleAutoActivation()      // мапа id → spec
const order = AUTO_RULE_ORDER                  // алфавітний список усіх правил із auto
const deps = AUTO_RULE_DEPENDENCIES            // граф залежностей (frozen)
```

### Послідовність всередині `detectAutoRules`

```
collectAutoRuleFacts(root) ──┐
                             ├─→ ctx = { root, facts, paths, packageJsonParsed }
collectRepoPaths(root) ──────┘
                                  │
                                  ▼
для кожного [ruleId, spec] у RULE_AUTO_ACTIVATION (крім spec типу 'rules'):
    specMatches(spec, ctx) → addRule(ruleId)
                                  │
                                  ▼
resolveRuleDependencies(detectedRules, addRule)    // fixed-point loop
                                  │
                                  ▼
rules = AUTO_RULE_ORDER.filter(r => detectedRules.includes(r))
                                  │
                                  ▼
return { rules }
```

### Інваріанти

- **Стабільний порядок**: фінальний `rules` завжди впорядкований за `AUTO_RULE_ORDER`
  (алфавіт). Це гарантує детермінованість для diff-ів конфігу.
- **Поважання `disable-rules`**: правило, явно вимкнене користувачем, не зʼявиться навіть
  якщо його spec матчить — фільтр у `addRule`.
- **Тільки додавання**: `mergeConfigWithAutoDetected` ніколи не видаляє вручну задані
  елементи (idempotent).
- **Зворотна сумісність**: `hasRegoFile`/`hasTempoDir` лишаються в експортуваному
  обʼєкті `collectAutoRuleFacts` навіть якщо вже не використовуються у власному
  диспетчингу — для прямих читачів.
- **Тиха толерантність до помилок FS**: `try/catch` навколо `readFile`/`readdir` —
  пошкоджені/недоступні файли не валять детект.

### Архітектурні нотатки

- **Load-time скан**: `RULE_AUTO_ACTIVATION = discoverRuleAutoActivation()` виконується
  **при імпорті модуля** (синхронно через `readdirSync`). Це означає, що зміни в
  `npm/rules/<id>/meta.json` після старту процесу не підхопляться без перезавантаження.
- **Подвійний обхід дерева**: `collectAutoRuleFacts` і `collectRepoPaths` йдуть по дереву
  окремо — це навмисно: різні задачі (content-факти vs glob-paths) і різні фільтри.
- **Type C spec (`rules`)** обробляється виключно в `resolveRuleDependencies` — у першому
  проході над `RULE_AUTO_ACTIVATION` ці spec-и пропускаються (`if ('rules' in spec) continue`).
