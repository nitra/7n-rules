---
description: Перевірка JavaScript коду
globs: "**/{.oxlintrc.json,eslint.config.js,.jscpd.json,knip.json,package.json},**/*.{js,mjs,cjs,jsx,ts,tsx}"
alwaysApply: false
version: '1.31'
---

**oxlint**, **ESLint**, **jscpd**, **knip**. Запуск — **`n-rules lint js`** (локально; у CI — `--no-fix`, без **`--fix`** для oxlint/eslint). Без **prettier** і **@nitra/prettier-config**.

`eslint.config.js` — flat config з `getConfig` (`@nitra/eslint-config`). Аргументи `node: [...]`/`vue: [...]` мають відповідати воркспейс-типам репо (`workspaces` root `package.json`; vue-воркспейс = Vue-залежність у deps або `.vue` файли) — інакше `.vue` файли не парсяться. Відсутній конфіг створюється (scaffold), наявний — зазнає хірургічного merge (fix не перезаписує файл цілком).

## Швидкий gate через conftest

Rego-пакети — запускаються `npx @7n/rules lint js` або `conftest`:

- `.jscpd.json`:

```json
{
  "gitignore": true,
  "exitCode": 1,
  "reporters": ["console"],
  "minLines": 25,
  "ignore": [".claude/worktrees/**", "**/dist/**", "**/CHANGELOG.md"]
}
```
- `extensions.json`:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "oxc.oxc-vscode"
  ]
}
```
- `package.json`:

```json
{
  "type": "module",
  "devDependencies": {
    "@nitra/eslint-config": "^3.10.0"
  }
}
```

## `for...in` заборонено — рефакторити на `for...of`

Конструкція `for (const k in obj)` обходить успадковані ключі прототипу, тому майже завжди тягне `Object.hasOwn(obj, k)`-guard. Заборонена у `@nitra/eslint-config` через `no-restricted-syntax` для `ForInStatement` (з версії **3.8.0**). У каноні oxlint (`guard-for-in: "deny"` у [oxlint-canonical.json](../tooling/data/tooling/oxlint-canonical.json)) лишається `guard-for-in` як часткова страховка (oxlint не підтримує `no-restricted-syntax`) — `checkOxlintRc` у `check/main.mjs` звіряє `.oxlintrc.json` проєкту з цим каноном.

Замість цього обходь масив напряму, а об'єкт — через `Object.entries` / `Object.keys` / `Object.values`. У такому коді guard за `Object.hasOwn` стає непотрібним і має зникнути разом із `for...in`.

```javascript title="❌ до"
for (const k in obj) {
  if (!Object.hasOwn(obj, k)) continue
  use(k, obj[k])
}

for (const i in arr) {
  use(arr[i])
}
```

```javascript title="✅ після"
for (const [k, v] of Object.entries(obj)) {
  use(k, v)
}

for (const item of arr) {
  use(item)
}
```

## Залежнісна політика (що не додавати)

`@e18e/eslint-plugin` окремо не додавай — він уже в залежностях `@nitra/eslint-config` (з **3.8.0**), oxlint підвантажує його з `node_modules`. Пакети `oxlint`/`eslint`/`jscpd`/`knip` теж не додавай у `devDependencies` без потреби монорепо — `bunx` тягне їх ad-hoc.

### Заборона `ua-parser-js`

Пакет **`ua-parser-js`** заборонений починаючи з версії **2.x**, де ліцензія змінилась з MIT на **AGPL-3.0** — несумісну з комерційним використанням у закритому SaaS. Замінити на **`bowser`** (MIT, ~6 KB gzip):

```javascript title="❌ до"
import { UAParser } from 'ua-parser-js'
const parser = new UAParser(userAgent)
const result = parser.getResult()
const browserName = result.browser.name
```

```javascript title="✅ після"
import Bowser from 'bowser'
const browser = Bowser.getParser(userAgent)
const browserName = browser.getBrowserName()
```

Bowser надає ті самі поля: `getBrowserName()`, `getOSName()`, `getPlatform().vendor`. Міграція займає кілька рядків; логіка не змінюється.

### Заборона `@nitra/as-integrations-fastify`

Пакет **`@nitra/as-integrations-fastify`** заборонений у **`dependencies`**, **`peerDependencies`** та в import-specifier-ах. Це чистий републіш upstream, застряглий на peer `@apollo/server: "^4.0.0"`, тож на Apollo 5 `bun install` дає `warn: incorrect peer dependency`. Заміна — upstream **`@as-integrations/fastify`** (**`^3.1.0`**): peer `@apollo/server: "^4.0.0 || ^5.0.0"` + `fastify: "^5.3.0"`.

Міграція — лише specifier у трьох місцях: залежність у `package.json`, `import`, та `vi.mock(...)` / `await import(...)` у тестах. **Код не міняється**, експорти ті самі: `default` → `fastifyApollo`, named → `fastifyApolloDrainPlugin`.

```javascript title="❌ до"
import fastifyApollo, { fastifyApolloDrainPlugin } from '@nitra/as-integrations-fastify'
```

```javascript title="✅ після"
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify'
```

## Розширення нових файлів — `.mjs` / `.cjs`, не `.js`

**Нові** JS-файли створюй з явним розширенням модуля:

- **`.mjs`** — для ESM (типовий випадок);
- **`.cjs`** — для CommonJS, де він справді потрібен.

Голий **`.js`** для нового файлу **заборонено**. Розширення `.js` інтерпретується як ESM чи CJS лише за полем `package.json#type`, тож той самий файл читається по-різному залежно від пакета. Явне `.mjs`/`.cjs` робить тип модуля однозначним **без читання `package.json`** — навіть якщо `type` зміниться або файл перемістять в інший пакет. Це доповнює вимогу `"type": "module"` у [package_json.mdc](../package_json/package_json.mdc): `type` лишається каноном для всього дерева, а розширення нового файлу прибирає залежність від нього.

Стосується **backend і frontend** — будь-який новий вихідний файл: `src/`, тести `*.test.*`, `scripts/`, `src/conn/` тощо.

**Існуючі `.js` лишаються як є** — масово перейменовувати не треба; це конвенція для нового коду. Автоматичної перевірки тут немає: stateless-скан не відрізнить новий файл від існуючого, тож `.js` нікого не фейлить.

## Rego-gate `.jscpd.json`

Rego-пакет: `js_lint.jscpd`

Цільовий файл: `.jscpd.json` у корені проєкту.

Що перевіряється:

- `gitignore` — точна відповідність (`true`)
- `exitCode` — точна відповідність (`1`)
- `reporters` — subset-of: масив має містити всі елементи з канону (`["console"]`)
- `minLines` — число, значення >= канонічного порогу (`25`); більше дозволено

Канон-snippet: [.jscpd.json.snippet.json](./template/.jscpd.json.snippet.json)

### Ігнорування `.claude/worktrees/`

Каталог `.claude/worktrees/` (робочі копії, які Claude Code створює через **superpowers:using-git-worktrees**) має ігноруватися:

- додай `.claude/worktrees/` у кореневий `.gitignore` (штатне місце для не-комітних робочих копій);
- у `.jscpd.json` додай `.claude/worktrees/**` у `ignore` як страховку на випадок запуску без `gitignore: true`.

Без цього jscpd сканує паралельну копію репо в worktree і фіксує самозбіги між дзеркальними файлами.

```text title=".gitignore (фрагмент)"
.claude/worktrees/
```

### Ігнорування `**/CHANGELOG.md`

`**/CHANGELOG.md` у каноні `ignore`: release-журнали різних пакетів структурно повторюються (заголовки `## [x.y.z] - YYYY-MM-DD`, секції `### Added / Changed / Fixed` за Keep a Changelog), і `jscpd` за `minLines: 25` фіксує їх як клон — це false positive. Без цього в монорепо легко зловити критичний `bun run lint` на парі CHANGELOG-ів довжиною від ~25 рядків.

### Рефакторинг vs конфіг

Коли **jscpd** знаходить клони, спочатку зменшуй дублювання кодом, а не конфігом.

- **Рефакторинг:** винеси спільні фрагменти в функції, модулі, утиліти, composables/hooks, спільні компоненти або базові типи — залежно від контексту.
- **Структура:** якщо одна й та сама логіка розмазана між файлами чи пакетами, запропонуй зміну структури (наприклад, спільний модуль, `shared/`, внутрішній пакет у monorepo), щоб була **одна канонічна реалізація** і повторні місця лише викликали її.

Розширення `ignore` чи завищення `minLines` лише щоб прибрати звіт — не заміна рефакторингу для справжніх клонів. Якщо збіг **семантично випадковий** (генерований код, формальні шаблони без спільної логіки), після оцінки допустимо точковий `ignore` або зміна порогу — з коротким обґрунтуванням.

Перед рефакторингом перевір чи є тести на блоки які підлягають зміні (Bun.test для js, playwright для vue). Якщо тестів немає або вони не покривають — спочатку створи їх, перевір що вони відпрацьовують коректно, потім роби рефакторинг і ще раз запускай тести.

## `knip.json` — аналіз невикористаних залежностей та експортів

Залежнісний аналіз (knip — невикористані залежності/експорти, `knip.json` канон) крос-файловий; запускається як частина `npx @7n/rules lint js`.

У корені проєкту має бути **`knip.json`**, який стартує з канонічного baseline з пакета `@7n/rules` — файл [`knip-canonical.json`](../tooling/data/tooling/knip-canonical.json). Канон покриває типові false-positives для наших правил:

- `entry` зі CLI-конфігами (eslint, stylelint, oxlint, jscpd, markdownlint-cli2, `commitlint`);
- `project` для `**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}`;
- `ignore` для `**/__fixtures__/**`;
- `ignoreDependencies` для пакетів, посилання на які є лише в не-JS-конфігах (`@nitra/cspell-dict`, `/@cspell\/dict-.+/`, `graphql`);
- `ignoreBinaries` для CLI, які канон вимагає викликати через `npx`/`bunx` і яких заборонено додавати в `devDependencies` (`actionlint`, `cspell`, `eslint`, `git-ai`, `jscpd`, `markdownlint-cli2`, `oxfmt`, `oxlint`, `shellcheck`, `uvx`, `v8r`, `zizmor`).

Якщо `knip.json` відсутній — `npx @7n/rules lint js` (концерн `js/check`) копіює канон у корінь проєкту як side effect детектора, ще до фази LLM-фіксів. Після створення модифікуй файл під свій проєкт як завгодно: перевіряємо лише наявність, зміст подальших змін не валідується.

Пакет `knip` окремо в `devDependencies` не додавай — `bunx knip` тягне його ad-hoc, як oxlint/eslint/jscpd.

## Rego-gate `package.json`

Rego-пакет: `js_lint.package_json`

Цільовий файл: `package.json` (корінь і workspace-пакети).

Що перевіряється:

- `"type"` — точна відповідність `"module"` (з канон-snippet)
- `scripts.lint-js` — нормалізована точна відповідність (collapse whitespace)
- `engines.node` — semver-парсинг: major >= 24 (inverse, без template)
- `engines.bun` — semver-парсинг: >= 1.3 (inverse, без template)
- `devDependencies["@nitra/eslint-config"]` — наявність ключа + semver >= порогу зі snippet (`^3.10.0`); `workspace:*` завжди проходить

Канон-snippet: [package.json.snippet.json](./template/package.json.snippet.json)

## Структура спільних модулів: `utils/` vs `lib/`

Коли спільні методи виносяться з кількох JS-файлів в окремий каталог — назву каталога обирай за призначенням модулів усередині.

- **`utils/`** — низькорівневі, чисті, generic helpers без бізнес-логіки і без залежностей від домену проєкту. Те, що могло б жити в окремому npm-пакеті. Приклади: `formatDate()`, `chunk(array, size)`, `retry(fn, opts)`, `deepMerge()`, `parseDuration('5m')`, `sleep(ms)`.

- **`lib/`** — внутрішні модулі / підсистеми проєкту, які знають про домен. Більші за `utils/`, часто з власним state, конфігом або side effects. Приклади: `lib/gmail-client.js`, `lib/circuit-breaker.js`, `lib/skill-loader.js`, `lib/safety/dry-run.js`.

Швидкий тест: якщо файл завтра можна опублікувати окремим npm-пакетом без переписування — це `utils/`; якщо він тримає domain-state, читає конфіг проєкту або викликає зовнішні сервіси/файли — це `lib/`. Не плутай із чужими каталогами на кшталт `shared/` чи `common/`: канонічні назви — лише `utils/` і `lib/`.

### Автоматична перевірка імпортів у `utils/`

`npx @7n/rules lint js` (концерн `utils_imports`) обходить кожен `utils/`-каталог у воркспейсах і падає, якщо знаходить relative-імпорт з `..` (вихід за межі каталогу) у будь-якому не-тестовому файлі. Це механічне втілення правила «utils не знає про домен»: тільки same-dir (`./X`), bare-пакети та `node:*` дозволені; cross-rule, конфіги проєкту чи sibling-utils — fail.

Якщо потрібна domain-залежність — перенеси файл у `lib/`.

## Rego-gate `.vscode/extensions.json`

Rego-пакет: `js_lint.vscode_extensions`

Цільовий файл: `.vscode/extensions.json`.

Що перевіряється:

- `recommendations` — subset-of: масив має містити всі три канонічні розширення (`dbaeumer.vscode-eslint`, `github.vscode-github-actions`, `oxc.oxc-vscode`)

Канон-snippet: [extensions.json.snippet.json](./template/extensions.json.snippet.json)

## Rego-gate `.github/workflows/lint-js.yml`

Rego-пакет: `js_lint.lint_js_yml`

Цільовий файл: `.github/workflows/lint-js.yml`.

Що перевіряється:

- Наявність усіх `uses:`-кроків з канону (subset-of по `jobs.eslint.steps`); SHA-пін того самого action (`owner/action@<40-hex SHA>`, з тег-коментарем `# vX` чи без) задовольняє канонічний тег — НЕ замінюй наявний SHA-пін тегом
- Наявність усіх рядків `run:` з канону (substring-match по всіх кроках)
- `actions/checkout` (будь-який ref) має мати `with.persist-credentials: false` (inverse-check)
- Заборона `--fix` у CI: `bunx oxlint ... --fix` або `eslint --fix` у будь-якому `run:` → deny

Канон-snippet: [lint-js.yml.snippet.yml](./template/lint-js.yml.snippet.yml)
