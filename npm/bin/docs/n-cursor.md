# n-cursor.js

## Огляд

Файл `npm/bin/n-cursor.js` — це виконуваний скрипт (shebang `#!/usr/bin/env node`), що слугує єдиною точкою входу CLI пакета `@nitra/cursor`. Скрипт виконує дві ролі:

1. **Синхронізатор пакетних артефактів у проєкті-споживачі** — без аргументів копіює `.mdc`-правила, скіли, slash-команди, генерує `AGENTS.md`, `CLAUDE.md`, синхронізує `.claude/settings.json`, `.cursor/hooks.json`, composite GitHub Action `setup-bun-deps`, `.pi/skills`, а також `.gitignore` для `.worktrees/`.
2. **Маршрутизатор підкоманд** — диспатчить `rename-yaml-extensions`, `hook`, `lint`, `analyze-escalation`, `taze`, `release`, `skill`, `trace`, `adr-normalize-local`, `doc-aggregate` у відповідні внутрішні модулі пакета.

Скрипт — ES-модуль (`import` синтаксис). Виконує реальні файлові операції в `cwd()` і у каталогах пакету (`BUNDLED_PACKAGE_ROOT`). Усі шляхи відносно поточної робочої директорії проєкту-споживача.

### Підтримувані команди CLI

- `npx @nitra/cursor` — повна синхронізація (`runSync`).
- `npx @nitra/cursor fix` — прогнати `fix.mjs` для всіх правил з `.cursor/rules/*.mdc`, у яких пакет має програмну перевірку.
- `npx @nitra/cursor fix bun` — прогнати `fix` лише для вказаних id (ігнорує `.cursor/rules/`).
- `npx @nitra/cursor check` — deprecated alias для `fix` (виводить попередження).
- `npx @nitra/cursor rename-yaml-extensions` — перейменування `*.yml`/`*.yaml` у k8s/.github (підтримує `--dry-run`, `--root=…`).
- `npx @nitra/cursor post-tool-use-fix` — entry point PostToolUse hook Claude Code: читає JSON зі stdin, маршрутизує `tool_input.file_path` у релевантні правила.
- `npx @nitra/cursor lint` — data-driven оркестратор lint+конформності: `--full` (весь репо, включно з `full`-правилами), `--read-only` (CI, нуль мутацій); без прапорів — per-file дельта vs origin.
- `npx @nitra/cursor lint-ci` — те саме у CI-режимі.
- `npx @nitra/cursor coverage [--fix] [--changed]` — оркестратор покриття та мутаційного тестування.
- `npx @nitra/cursor release` — реліз-команда.
- `npx @nitra/cursor skill list|taze|cursor|claude …` — керування скілами (промпт на stdout, виклик Cursor/Claude CLI).
- `npx @nitra/cursor worktree …` — керування git-worktree.
- `npx @nitra/cursor trace` — наскрізна простежуваність ADR↔spec↔plan↔change.
- `npx @nitra/cursor docgen scan|modules` — детермінований JSON-лістинг для скілу docgen; `scan` друкує відносний `sourcePath`, ignore-glob snippet живе в `npm/skills/docgen/js/docgen-ignore.mjs`.

### Конвенції та ключові артефакти

- `.n-cursor.json` (`CONFIG_FILE`) — конфіг проєкту-споживача (rules, skills, disable-rules, disable-skills, ignore, claude-config, version).
- `CONFIG_SCHEMA_URL = 'https://unpkg.com/@nitra/cursor/schemas/n-cursor.json'` — публічний URL JSON Schema для поля `$schema`.
- `.cursor/rules` (`RULES_DIR`) — місце призначення `.mdc`-правил (керовані — з префіксом `n-`).
- `.cursor/skills` (`SKILLS_DIR`) — місце призначення скілів (керовані — з префіксом `n-`).
- `.claude/commands` (`COMMANDS_DIR`) — slash-команди Claude Code (`n-<id>.md`).
- `.pi/skills` (`PI_SKILLS_DIR`) — pi.dev-сумісні скіли (директорії з `SKILL.md`).
- `AGENTS.md` (`AGENTS_FILE`) і `AGENTS.template.md` (`AGENTS_TEMPLATE_FILE`) — генеруються із шаблону пакета.
- `RULE_PREFIX = 'n-'` — префікс керованих файлів/каталогів.

## Експорти / API

Файл — виконуваний CLI-модуль і **не має `export`-декларацій**. Усі його внутрішні функції приватні; зовнішнє API — це аргументи командного рядка (`process.argv.slice(2)`) і поведінка на боці файлової системи.

Зовнішні залежності, що делегуються:

- `buildAgentsCommandBulletItems` зі `scripts/build-agents-commands.mjs`
- `formatGeneratedMarkdownLines`, `renderAgentsTemplate` зі `scripts/lib/generated-markdown.mjs`
- `inlineTemplateLinks` зі `scripts/lib/inline-template-links.mjs`
- `detectAutoRules`, `detectLegacyRuleIds`, `mergeConfigWithAutoDetected`, `normalizeIdList`, `RULE_MIGRATIONS` зі `scripts/auto-rules.mjs`
- `detectAutoSkills` зі `scripts/auto-skills.mjs`
- `readSkillMetaRaw` зі `scripts/lib/skill-meta.mjs`
- `injectWorktreeNotice` зі `scripts/lib/worktree-notice.mjs`
- `runPostToolUseFixCli` зі `scripts/post-tool-use-fix.mjs`
- `discoverCheckRulesFromCursorRules` зі `scripts/lib/discover-check-rules-from-cursor.mjs`
- `listRuleIds` зі `scripts/lib/list-rule-ids.mjs`
- `ensureNitraCursorInRootDevDependencies` зі `scripts/ensure-nitra-cursor-dev-dependencies.mjs`
- `syncClaudeConfig` зі `scripts/sync-claude-config.mjs`
- `syncGitignoreWorktree` зі `scripts/lib/sync-gitignore-worktree.mjs`
- `upgradeNitraCursorToLatestAndBunInstall` зі `scripts/upgrade-nitra-cursor-and-install.mjs`
- `runRenameYamlExtensionsCli` з `./rename-yaml-extensions.mjs`
- `runSkillsCli` зі `scripts/skills-cli.mjs`
- `runWorktreeCli` зі `scripts/worktree-cli.mjs`
- `syncSetupBunDepsAction` зі `scripts/sync-setup-bun-deps-action.mjs`
- `runLint` зі `scripts/lint-cli.mjs`
- `formatTimingSummary` зі `scripts/lib/timing-summary.mjs`
- `ensureHkInstall`, `ensureTool` зі `scripts/lib/ensure-tool.mjs`
- Динамічно (`await import(...)`) у момент маршрутизації команд:
  - `runCoverageCli` з `../rules/test/coverage/coverage.mjs`
  - `runChangeCli` з `../rules/release/change.mjs`
  - `runReleaseCli` з `../rules/release/release.mjs`
  - `runTraceCli` зі `../scripts/dispatcher/trace.mjs`
  - `runDocgenScanCli`, `runDocgenModulesCli` зі `../skills/docgen/js/docgen-scan.mjs`

## Константи модуля

- `PACKAGE_NAME = '@nitra/cursor'`
- `CONFIG_FILE = '.n-cursor.json'`
- `CONFIG_SCHEMA_URL = 'https://unpkg.com/@nitra/cursor/schemas/n-cursor.json'`
- `AGENTS_FILE = 'AGENTS.md'`
- `AGENTS_TEMPLATE_FILE = 'AGENTS.template.md'`
- `RULES_DIR = '.cursor/rules'`
- `SKILLS_DIR = '.cursor/skills'`
- `COMMANDS_DIR = '.claude/commands'`
- `PI_SKILLS_DIR = '.pi/skills'`
- `RULE_PREFIX = 'n-'`
- `binDir` — `dirname(fileURLToPath(import.meta.url))`, тобто фізичний шлях до каталогу `bin/` встановленого пакета.
- `BUNDLED_RULES_DIR = join(binDir, '..', 'rules')` — `rules/` у пакеті.
- `BUNDLED_SKILLS_DIR = join(binDir, '..', 'skills')` — `skills/` у пакеті.
- `BUNDLED_AGENTS_TEMPLATE_PATH = join(binDir, '..', AGENTS_TEMPLATE_FILE)` — шаблон `AGENTS.md`.
- `BUNDLED_PACKAGE_ROOT = join(binDir, '..')` — корінь установленого пакета.
- `YAML_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/` — регекс для YAML frontmatter.
- `NEWLINE_RE = /\r?\n/` — поділ на рядки.
- `LEADING_SPACES_RE = /^\s+/` — провідні пробіли.
- `CONFIG_SORTED_ARRAY_KEYS = ['rules', 'skills', 'disable-rules', 'disable-skills']` — ключі, чиї масиви сортуються перед записом у `.n-cursor.json`.

## Класи

### ReexecHandoff (extends Error)

Сентинельна помилка, яку кидає `reexecIfPackageVersionChanged` після успішного re-exec нової версії бінаря. Top-level `catch` розпізнає її й виставляє `process.exitCode = code` без друку stack-trace.

- `constructor(code)` — `code: number`, exit-код, який повернув child re-exec.
- Полем `this.name` встановлюється `'ReexecHandoff'`, полем `this.code` — переданий exit-код.
- Виклик `super('reexec-handoff')` — фіктивне повідомлення, не для логування.

## Функції

### sortConfigIdArrays(config)

- **Сигнатура:** `function sortConfigIdArrays(config: Record<string, unknown>): Record<string, unknown>`
- **Призначення:** повертає копію `config`, у якій масиви під ключами з `CONFIG_SORTED_ARRAY_KEYS` (`rules`, `skills`, `disable-rules`, `disable-skills`) відсортовано за `localeCompare`. Значення приводяться до рядка через `String`.
- **Параметри:** `config` — сирий обʼєкт конфігу перед записом на диск.
- **Повертає:** новий обʼєкт із відсортованими масивами; решта полів залишаються без змін.
- **Side effects:** жодних — pure-функція.

### discoverBundledRuleNames(bundledRulesDir = BUNDLED_RULES_DIR)

- **Сигнатура:** `async function discoverBundledRuleNames(bundledRulesDir?: string): Promise<string[]>`
- **Призначення:** повертає відсортовані id правил із каталогу `rules/` пакета. Правило — це підкаталог `rules/<id>/`, що містить файл `<id>.mdc`.
- **Параметри:** `bundledRulesDir` — каталог `rules/` у корені пакета.
- **Повертає:** масив id (імена підкаталогів без `.`).
- **Side effects:** читає файлову систему (`readdir`, `existsSync`). Кидає `Error`, якщо каталог відсутній або в ньому немає валідних правил.

### discoverBundledSkillNames(bundledSkillsDir = BUNDLED_SKILLS_DIR)

- **Сигнатура:** `async function discoverBundledSkillNames(bundledSkillsDir?: string): Promise<string[]>`
- **Призначення:** повертає відсортовані id скілів (без префікса `n-`) із каталогу `skills/` пакета. Підкаталоги, чиї імена починаються на `.` або вже мають `n-`-префікс, відкидаються.
- **Параметри:** `bundledSkillsDir` — каталог `skills/` у корені пакета.
- **Повертає:** масив id (порожній, якщо каталог відсутній).
- **Side effects:** `existsSync`, `readdir`. Не кидає помилку при відсутньому каталозі.

### migrateLegacyManagedRuleFilenames(rulesDir)

- **Сигнатура:** `async function migrateLegacyManagedRuleFilenames(rulesDir: string): Promise<void>`
- **Призначення:** у каталозі `.cursor/rules` перейменовує `nitra-*.mdc` → `n-*.mdc`. Якщо `n-*.mdc` уже є — `nitra-*.mdc` видаляється.
- **Параметри:** `rulesDir` — абсолютний шлях до `.cursor/rules`.
- **Повертає:** нічого (`void`).
- **Side effects:** `unlink`/`rename`, лог у stdout про кожне перейменування/видалення.

### migrateLegacyConfigIfNeeded()

- **Сигнатура:** `async function migrateLegacyConfigIfNeeded(): Promise<void>`
- **Призначення:** виконує дві міграції: викликає `migrateLegacyManagedRuleFilenames` у `.cursor/rules` і, якщо немає `.n-cursor.json`, але є `nitra-cursor.json`, перейменовує його у `.n-cursor.json`.
- **Параметри:** немає.
- **Side effects:** `existsSync`, `rename`, лог у stdout.

### readRootPackageJsonSafe()

- **Сигнатура:** `async function readRootPackageJsonSafe(): Promise<unknown | null>`
- **Призначення:** читає `cwd()/package.json` і повертає розпарсений JSON. Якщо файлу немає чи парсинг падає — повертає `null` (помилка не пропагується).
- **Параметри:** немає.
- **Повертає:** розпарсений обʼєкт або `null`.
- **Side effects:** I/O читання файлу. Не кидає винятків.

### readConfig(paths = {})

- **Сигнатура:** `async function readConfig(paths?: { bundledRulesDir?: string, bundledSkillsDir?: string }): Promise<{ $schema: string, rules: string[], skills: string[], version?: string } & Record<string, unknown>>`
- **Призначення:** головний акцесор `.n-cursor.json`. Послідовність:
  1. Викликає `migrateLegacyConfigIfNeeded`.
  2. Якщо `.n-cursor.json` немає — створює дефолтний з `auto-detected rules` (`detectAutoRules`) та `skills` (`detectAutoSkills`), сортує і записує.
  3. Якщо файл є — парсить, валідує, логує legacy rule-id (`logRuleMigrationsIfAny`), нормалізує через вкладену `normalizeConfigWithAutoRules` і, якщо результат відрізняється від диска — перезаписує.
- **Параметри:** `paths.bundledRulesDir` і `paths.bundledSkillsDir` — каталоги пакета-джерела (за замовчуванням `BUNDLED_*` константи).
- **Повертає:** нормалізований конфіг із обовʼязковими полями `$schema`, `rules`, `skills`; опційно `disable-rules`, `disable-skills`, `ignore`, `claude-config`, `version`.
- **Side effects:** читає/пише `.n-cursor.json`, лог у stdout про створення/оновлення. Кидає `Error`/`TypeError` для невалідного JSON або неправильних типів полів `rules`/`skills`/`ignore`.

#### Вкладена normalizeConfigWithAutoRules(parsedConfig)

- **Сигнатура:** `async function normalizeConfigWithAutoRules(parsedConfig: Record<string, unknown>): Promise<Record<string, unknown>>`
- **Призначення:** перевіряє типи полів, обчислює `auto-detected rules` (`detectAutoRules`), будує ефективний список правил (поточні + auto, мінус `disable-rules`), за яким `detectAutoSkills` визначає скіли. Далі `mergeConfigWithAutoDetected` зливає дані (передаючи `availableRules`/`availableSkills` із каталогів пакета, щоб відсіяти з `rules`/`skills` неактуальні id, яких уже немає у пакеті — прибрані логуються через `🧹`), після чого `$schema` вирівнюється до `CONFIG_SCHEMA_URL`, додаються `disable-rules`/`disable-skills` (якщо непорожні), результат проходить через `sortConfigIdArrays`.

### logRuleMigrationsIfAny(parsedConfig)

- **Сигнатура:** `function logRuleMigrationsIfAny(parsedConfig: Record<string, unknown>): void`
- **Призначення:** якщо у `parsedConfig.rules` чи `parsedConfig['disable-rules']` є застарілі id з `RULE_MIGRATIONS`, виводить блок логу про авто-міграцію (саму заміну виконує `migrateRuleIds` всередині `mergeConfigWithAutoDetected`).
- **Параметри:** `parsedConfig` — сирий обʼєкт після `JSON.parse`.
- **Повертає:** нічого.
- **Side effects:** друк у stdout.

### normalizeRuleName(ruleName)

- **Сигнатура:** `function normalizeRuleName(ruleName: string): string`
- **Призначення:** витягує чистий id правила з рядка-шляху або базового імені. Виконує `basename`, тримить, відрізає суфікс `.mdc`. Приклади: `"npm/rules/text/text.mdc" → "text"`, `"text.mdc" → "text"`, `"text" → "text"`.
- **Параметри:** `ruleName` — будь-яке з трьох форм.
- **Повертає:** id без `.mdc` і без шляху.
- **Side effects:** немає.

### readBundledRuleContent(rule, bundledRulesDir = BUNDLED_RULES_DIR)

- **Сигнатура:** `async function readBundledRuleContent(rule: string, bundledRulesDir?: string): Promise<string>`
- **Призначення:** читає файл `rules/<id>/<id>.mdc` із пакета і прогонить через `inlineTemplateLinks`, щоб inline-посилання шаблонів розкрилися.
- **Параметри:** `rule` — елемент масиву `rules` з `.n-cursor.json`; `bundledRulesDir` — каталог `rules/`.
- **Повертає:** готовий до запису текст `.mdc`.
- **Side effects:** `existsSync`/`readFile`. Кидає `Error`, якщо файлу немає.

### normalizeSkillId(skillName)

- **Сигнатура:** `function normalizeSkillId(skillName: string): string`
- **Призначення:** приводить id скілу до форми без префікса `n-` (наприклад `n-fix` → `fix`, `fix` → `fix`).
- **Параметри:** `skillName` — елемент масиву `skills` або імʼя каталогу.
- **Повертає:** id без префікса.

### managedSkillDirName(skillId)

- **Сигнатура:** `function managedSkillDirName(skillId: string): string`
- **Призначення:** повертає імʼя керованого каталогу скілу в `.cursor/skills` (з префіксом `n-`).
- **Параметри:** id з префіксом або без — нормалізується через `normalizeSkillId`.
- **Повертає:** наприклад `'n-fix'`.

### extractSkillDescription(text)

- **Сигнатура:** `function extractSkillDescription(text: string): string | null`
- **Призначення:** з YAML frontmatter `SKILL.md` витягує мультирядковий блок `description: >-`. Шукає рядок `description: >-`, далі бере рядки, що починаються з пробілів, доки не зустрінеться рядок без провідних пробілів. Зрізає провідні пробіли, склеює одним пробілом.
- **Параметри:** `text` — повний вміст `SKILL.md`.
- **Повертає:** очищений однорядковий опис або `null` (немає frontmatter / немає `description: >-` / блок порожній).

### skillDescriptionSafeForMarkdownInline(desc)

- **Сигнатура:** `function skillDescriptionSafeForMarkdownInline(desc: string): string`
- **Призначення:** замінює всі входження літералу `<id>` на `{id}`, щоб markdownlint (MD033) не сприймав їх як inline HTML у звичайному markdown.
- **Параметри:** `desc` — рядок з frontmatter.
- **Повертає:** оброблений рядок.

### formatClaudeCommandFrontmatter(descriptionRaw)

- **Сигнатура:** `function formatClaudeCommandFrontmatter(descriptionRaw: string): string`
- **Призначення:** формує YAML frontmatter для `.claude/commands/*.md`. Обовʼязкове поле `description` — щоб VSCode-розширення Claude Code побачило команду. Якщо текст порожній — використовує fallback "Див. SKILL.md у каталозі скілу в .cursor/skills.".
- **Параметри:** `descriptionRaw` — значення з `extractSkillDescription` (може бути `''`/`null`).
- **Повертає:** блок `---\ndescription: >-\n  …\n---\n\n`.

### formatPiSkillFrontmatter(skillName, descriptionRaw)

- **Сигнатура:** `function formatPiSkillFrontmatter(skillName: string, descriptionRaw: string): string`
- **Призначення:** YAML frontmatter для `.pi/skills/<dir>/SKILL.md` за специфікацією pi.dev: обовʼязкові поля `name` (1-64, `[a-z0-9-]`) і `description` (≤ 1024). Якщо `descriptionRaw` порожній — fallback як у `formatClaudeCommandFrontmatter`.
- **Параметри:** `skillName` — імʼя скілу (наприклад `n-fix`); `descriptionRaw` — текст опису.
- **Повертає:** блок `---\nname: …\ndescription: >-\n  …\n---\n\n`.

### listProjectRulesMdcFiles()

- **Сигнатура:** `async function listProjectRulesMdcFiles(): Promise<string[]>`
- **Призначення:** повертає відсортовані базові імена `*.mdc`-файлів у `.cursor/rules` поточного проєкту.
- **Параметри:** немає.
- **Повертає:** масив імен (без шляху), порожній якщо каталогу немає.

### expectedManagedRuleBasenames(configRules)

- **Сигнатура:** `function expectedManagedRuleBasenames(configRules: string[]): Set<string>`
- **Призначення:** будує `Set<string>` базових імен очікуваних керованих файлів (`n-<id>.mdc`) із масиву `rules` конфігу.
- **Параметри:** `configRules`.
- **Повертає:** множина імен.

### removeOrphanManagedRuleFiles(rulesDir, configRules)

- **Сигнатура:** `async function removeOrphanManagedRuleFiles(rulesDir: string, configRules: string[]): Promise<string[]>`
- **Призначення:** видаляє з `rulesDir` файли `n-*.mdc`, яких немає в конфізі. Файли без префікса `n-` не чіпає.
- **Параметри:** `rulesDir` — `.cursor/rules`; `configRules` — масив `rules` із `.n-cursor.json`.
- **Повертає:** відсортований масив імен видалених файлів.
- **Side effects:** `unlink`.

### listProjectSkillDirNames()

- **Сигнатура:** `async function listProjectSkillDirNames(): Promise<string[]>`
- **Призначення:** повертає відсортовані імена підкаталогів `.cursor/skills`, що не починаються з `.`.
- **Side effects:** `readdir` (з `withFileTypes`).

### buildSkillBulletItems()

- **Сигнатура:** `async function buildSkillBulletItems(): Promise<{ name: string }[]>`
- **Призначення:** будує елементи для Mustache-секції `skills` шаблону `AGENTS.md`. Для кожного підкаталогу `.cursor/skills/<dir>` зчитує `SKILL.md`, дістає `description`, формує рядок `- \`.cursor/skills/<dir>/SKILL.md\` — <desc>`. Без опису — лише шлях.
- **Повертає:** масив обʼєктів `{ name: string }`.

### removeOrphanManagedSkillDirs(skillsRoot, configSkills)

- **Сигнатура:** `async function removeOrphanManagedSkillDirs(skillsRoot: string, configSkills: string[]): Promise<string[]>`
- **Призначення:** видаляє з `.cursor/skills` каталоги з префіксом `n-`, яких немає в конфізі (порівняння через `managedSkillDirName`).
- **Side effects:** `rm` рекурсивно.

### buildClaudeLintParallelismSectionLines()

- **Сигнатура:** `function buildClaudeLintParallelismSectionLines(): string[]`
- **Призначення:** повертає готові рядки для секції `## Лінт і ESLint (без паралельних запусків)` у `CLAUDE.md`. Дублює fail-fast правило: один прогон `lint`/ESLint на сесію.

### buildClaudeWorktreeEnforcementSectionLines()

- **Сигнатура:** `function buildClaudeWorktreeEnforcementSectionLines(): string[]`
- **Призначення:** повертає рядки для секції `## Worktree-only skills (\`meta.json\` → \`worktree: true\`)`у`CLAUDE.md`(preflight-вимога запуску таких скілів виключно в`.worktrees/`).

### buildClaudeSkillsSectionLines()

- **Сигнатура:** `async function buildClaudeSkillsSectionLines(): Promise<string[]>`
- **Призначення:** будує секцію `## Skills` для `CLAUDE.md`. Для кожного `.cursor/skills/<dir>`: читає `SKILL.md` → `description`; якщо є `.claude/commands/<dir>.md` — додає рядок `Команда: /<dir>`.
- **Повертає:** масив рядків (порожній, якщо скілів немає).

### syncClaudeMd(ignore)

- **Сигнатура:** `async function syncClaudeMd(ignore?: string[]): Promise<void>`
- **Призначення:** генерує `CLAUDE.md` у `cwd()`. Структура:
  1. Заголовок-коментар про авто-генерацію.
  2. Опційно секція `## Захищені директорії` (зі `ignore`), якщо передано непорожній масив.
  3. `@.cursor/rules/<file>.mdc`-імпорти всіх `*.mdc` із `.cursor/rules`.
  4. Секції з `buildClaudeLintParallelismSectionLines` + `buildClaudeWorktreeEnforcementSectionLines`.
  5. Секція `## Skills` (`buildClaudeSkillsSectionLines`).
- **Параметри:** `ignore` — масив директорій (рядків), кожна виводиться через `- \`<dir>/\``. Трейлінгові `/` зрізаються.
- **Side effects:** `writeFile` `CLAUDE.md`, лог про створення/оновлення.

### syncAgentsMd(agentsTemplatePath = BUNDLED_AGENTS_TEMPLATE_PATH)

- **Сигнатура:** `async function syncAgentsMd(agentsTemplatePath?: string): Promise<void>`
- **Призначення:** повністю перезаписує `AGENTS.md` у корені проєкту. Зчитує шаблон, листи `*.mdc`-правил, `skillItems` (`buildSkillBulletItems`), `commandItems` (`buildAgentsCommandBulletItems`); рендерить через `renderAgentsTemplate`. Гарантує trailing newline.
- **Side effects:** кидає `Error`, якщо шаблону немає; лог про створення/оновлення.

### syncSkills(configSkills, bundledSkillsDir = BUNDLED_SKILLS_DIR)

- **Сигнатура:** `async function syncSkills(configSkills: string[], bundledSkillsDir?: string): Promise<{ success: number, fail: number }>`
- **Призначення:** копіює топ-level файли скілів (без `meta.json` і без підкаталогів) із `skills/<id>/` пакета до `.cursor/skills/n-<id>/`. Для `SKILL.md` додатково викликає `injectWorktreeNotice(content, worktree)`, де `worktree` походить із `meta.json` (`readSkillMetaRaw(srcDir)?.worktree === true`).
- **Параметри:** `configSkills` — id без префікса; `bundledSkillsDir`.
- **Повертає:** обʼєкт-лічильник `{ success, fail }`.
- **Side effects:** `mkdir -p`, `writeFile`. Логи прогресу/помилок у stdout/stderr.

### syncCommands(configSkills, bundledSkillsDir = BUNDLED_SKILLS_DIR)

- **Сигнатура:** `async function syncCommands(configSkills: string[], bundledSkillsDir?: string): Promise<{ success: number, fail: number }>`
- **Призначення:** генерує файли `.claude/commands/n-<id>.md` для всіх скілів із конфігу. Кожен файл: YAML frontmatter (`formatClaudeCommandFrontmatter` з `description` зі `SKILL.md` пакета) + `# n-<id>` + посилання `Виконай інструкції зі скілу \`.cursor/skills/n-<id>/SKILL.md\``.

### removeOrphanManagedCommandFiles(commandsDir, configSkills)

- **Сигнатура:** `async function removeOrphanManagedCommandFiles(commandsDir: string, configSkills: string[]): Promise<string[]>`
- **Призначення:** видаляє з `.claude/commands` файли `n-*.md`, яких немає в конфізі (порівняння `n-<id>.md`).
- **Side effects:** `unlink`.

### syncLocalOnlySkillCommands(configSkills)

- **Сигнатура:** `async function syncLocalOnlySkillCommands(configSkills: string[]): Promise<{ success: number, fail: number }>`
- **Призначення:** створює `.claude/commands/<dirName>.md` для скілів із `.cursor/skills/`, що **не** керуються пакетом (їх каталоги відсутні у списку `configSkills` через `managedSkillDirName`). `description` беруть із локального `SKILL.md`.

### removeOrphanLocalSkillCommandFiles(commandsDir, configSkills)

- **Сигнатура:** `async function removeOrphanLocalSkillCommandFiles(commandsDir: string, configSkills: string[]): Promise<string[]>`
- **Призначення:** видаляє з `.claude/commands` файли локальних скілів (без префікса `n-`), яких більше немає в `.cursor/skills/` і яких немає серед керованих.
- **Side effects:** `unlink`.

### syncPiSkills(configSkills, bundledSkillsDir = BUNDLED_SKILLS_DIR)

- **Сигнатура:** `async function syncPiSkills(configSkills: string[], bundledSkillsDir?: string): Promise<{ success: number, fail: number }>`
- **Призначення:** аналог `syncCommands`, але створює директорії `.pi/skills/n-<id>/SKILL.md` із pi.dev-frontmatter (`formatPiSkillFrontmatter`) і тілом-делегатом на джерельний `.cursor/skills/n-<id>/SKILL.md`.
- **Side effects:** `mkdir`, `writeFile`.

### syncLocalOnlyPiSkills(configSkills)

- **Сигнатура:** `async function syncLocalOnlyPiSkills(configSkills: string[]): Promise<{ success: number, fail: number }>`
- **Призначення:** аналог `syncLocalOnlySkillCommands` для `.pi/skills`. Для кожного локального скілу з `.cursor/skills/<dir>` будує `.pi/skills/<dir>/SKILL.md` з frontmatter і делегатом.

### removeOrphanManagedPiSkillDirs(piSkillsDir, configSkills)

- **Сигнатура:** `async function removeOrphanManagedPiSkillDirs(piSkillsDir: string, configSkills: string[]): Promise<string[]>`
- **Призначення:** видаляє з `.pi/skills` директорії з префіксом `n-`, яких немає в конфізі.
- **Side effects:** `rm` рекурсивно.

### removeOrphanLocalPiSkillDirs(piSkillsDir, configSkills)

- **Сигнатура:** `async function removeOrphanLocalPiSkillDirs(piSkillsDir: string, configSkills: string[]): Promise<string[]>`
- **Призначення:** видаляє з `.pi/skills` директорії без префікса `n-`, відповідні скіли яких відсутні і в `.cursor/skills/`, і серед керованих.
- **Side effects:** `rm` рекурсивно.

### errorMessage(error)

- **Сигнатура:** `function errorMessage(error: unknown): string`
- **Призначення:** людинозрозумілий текст винятку: якщо `error instanceof Error` — `error.message`; інакше `String(error)`.

### runSyncStep(prefix, action)

- **Сигнатура:** `async function runSyncStep<T>(prefix: string, action: () => Promise<T>): Promise<T>`
- **Призначення:** виконує `action()`, при помилці друкує `prefix + errorMessage(error)` у `stderr` і пере-кидає виняток. Уніфікований wrapper для кроків `runSync`.

### syncManagedRuleFiles(rules, bundledRulesDir, rulesDir)

- **Сигнатура:** `async function syncManagedRuleFiles(rules: string[], bundledRulesDir: string, rulesDir: string): Promise<{ successCount: number, failCount: number }>`
- **Призначення:** для кожного `rule` із `rules` копіює `n-<id>.mdc` із пакета в `.cursor/rules`. Прогрес виводить у stdout (`⬇`, `✅`/`❌`). Помилки рахуються у `failCount`, не зупиняючи цикл.
- **Side effects:** `writeFile`.

### logRemovedManagedItems(title, basePath, names)

- **Сигнатура:** `function logRemovedManagedItems(title: string, basePath: string, names: string[]): void`
- **Призначення:** друкує у stdout блок `🧹 Видалено <title> поза списком .n-cursor.json (N): …`. Якщо `names` порожній — нічого не друкує.

### runFixCommand(requestedRules)

- **Сигнатура:** `async function runFixCommand(requestedRules: string[]): Promise<void>`
- **Призначення:** spawn-wrapper для `npx @nitra/cursor fix [<rule>...]`. Алгоритм:
  1. `ensureTool('hk')` → `ensureHkInstall(hkBin)` → `ensureTool('conftest')`.
  2. `listRuleIds(BUNDLED_RULES_DIR)` — повний перелік доступних правил. Якщо порожньо — кидає `Error('No rules found')`.
  3. Якщо `requestedRules` непорожній — перевіряє, що всі id є серед доступних; інакше виводить список доступних і кидає `Unknown rules: …`.
  4. Якщо `requestedRules` порожній — discovery з `.cursor/rules/*.mdc` (через `listProjectRulesMdcFiles` + `discoverCheckRulesFromCursorRules`). Якщо `.mdc`-файлів немає — кидає `Error` із підказкою синхронізувати; якщо є, але немає правил із програмною перевіркою — друкує повідомлення і `return`.
  5. Для кожного `id` зі списку: `spawnSync('bun', [BUNDLED_RULES_DIR/<id>/fix.mjs], { stdio: 'inherit' })`. Час кроку записує у масив `timings` як `{ id: \`fix-<id>\`, ms, ok }`.
  6. Після циклу — `formatTimingSummary('Fix timing', timings)` у stdout.
  7. Якщо `totalFailed > 0` — кидає `Error(\`<n> з <total> правил мають проблеми\`)`.
- **Side effects:** запуск дочірніх процесів `bun`, реальне виконання fix-правил, лог таймінгу. Серіалізація паралельних запусків — на рівні `runStandardRule` (`withLock('fix-<id>')`), на рівні `runFixCommand` локу немає.

### readBundledVersionAt(packageRoot)

- **Сигнатура:** `async function readBundledVersionAt(packageRoot: string): Promise<string | null>`
- **Призначення:** читає `<packageRoot>/package.json` і повертає поле `version` (рядок). При відсутньому файлі, некоректному JSON чи відсутності поля повертає `null`.

### reexecIfPackageVersionChanged(effectivePackageRoot)

- **Сигнатура:** `async function reexecIfPackageVersionChanged(effectivePackageRoot: string): Promise<void>`
- **Призначення:** якщо `upgradeNitraCursorToLatestAndBunInstall` встановив версію в `node_modules/@nitra/cursor`, відмінну від поточної (з npx-кешу), процес перезапускається через `spawnSync(process.execPath, [newBinPath, ...process.argv.slice(2)], { stdio: 'inherit', env: { …, NITRA_CURSOR_REEXEC: '1' } })`. Захист від циклу — env `NITRA_CURSOR_REEXEC=1`. Якщо ‘re-exec’ відбувся — кидає `ReexecHandoff(result.status ?? 1)`, який ловить top-level catch і виставляє `process.exitCode`.
- **Сценарії пропуску:**
  - `env.NITRA_CURSOR_REEXEC === '1'` (всередині re-exec) — повертає.
  - `effectivePackageRoot === BUNDLED_PACKAGE_ROOT` — пакет той самий, нічого не змінилося.
  - Не вдалося прочитати версії (`currentVersion`/`installedVersion` = null) або вони рівні.
  - Файлу `effectivePackageRoot/bin/n-cursor.js` немає.
- **Side effects:** spawn нового процесу, друк `🔁` повідомлення, кидання `ReexecHandoff`, або `throw result.error` при spawn-error.

### runSync()

- **Сигнатура:** `async function runSync(): Promise<void>`
- **Призначення:** головний оркестратор синхронізації. Порядок кроків:
  1. Print банер `🔧 @nitra/cursor — завантаження cursor-правил`.
  2. `upgradeNitraCursorToLatestAndBunInstall(cwd(), BUNDLED_PACKAGE_ROOT)` (через `runSyncStep`) — оновлює пакет до останнього з npm і робить `bun i`. Повертає `effectivePackageRoot`.
  3. `reexecIfPackageVersionChanged(effectivePackageRoot)` — за потреби перезапускає процес.
  4. Резолвить `bundledRulesDir`, `bundledSkillsDir`, `bundledAgentsTemplatePath` від `effectivePackageRoot`.
  5. `readConfig({ bundledRulesDir, bundledSkillsDir })` — отримує нормалізований конфіг. Деструктуризує `rules`, `skills`, `version`, `ignore`; `claudeConfigEnabled = config['claude-config'] !== false`.
  6. Друкує `📦 Джерело правил: @nitra/cursor@<ver>` (з шляхом, якщо `effectivePackageRoot !== BUNDLED_PACKAGE_ROOT`).
  7. Якщо у конфізі є `version` — попередження, що поле ігнорується.
  8. Друкує лічильники правил/скілів.
  9. `syncSetupBunDepsAction(cwd(), effectivePackageRoot)` — composite `.github/actions/setup-bun-deps/action.yml`.
  10. `mkdir -p .cursor/rules`; `syncManagedRuleFiles(rules, bundledRulesDir, rulesDir)`.
  11. `removeOrphanManagedRuleFiles` → `logRemovedManagedItems('правила', RULES_DIR, …)`.
  12. `syncSkills(skills, bundledSkillsDir)` + `removeOrphanManagedSkillDirs`. При помилках копіювання — кидає `Error`.
  13. `syncCommands(skills, bundledSkillsDir)` + `syncLocalOnlySkillCommands(skills)` + видалення осиротілих (`removeOrphanManagedCommandFiles`, `removeOrphanLocalSkillCommandFiles`).
  14. `syncPiSkills(skills, bundledSkillsDir)` + `syncLocalOnlyPiSkills(skills)` + видалення осиротілих (`removeOrphanManagedPiSkillDirs`, `removeOrphanLocalPiSkillDirs`).
  15. `syncAgentsMd(bundledAgentsTemplatePath)`.
  16. `syncClaudeMd(ignore)`.
  17. `syncClaudeConfig({ projectRoot: cwd(), bundledPackageRoot: effectivePackageRoot, enabled: claudeConfigEnabled, rules })`. Якщо `claudeConfigEnabled === false` — друкує "пропущено". Інакше формує перелік оновлених артефактів: `.claude/settings.json`, `.cursor/hooks.json`, slash-команди, ADR-хуки (`capture-decisions.sh`, `normalize-decisions.sh`), бібліотеки хуків, `.gitignore` (adr fragment), `.pi/extensions/n-cursor-adr/`.
  18. `syncGitignoreWorktree(cwd())` — додає `.worktrees/` до `.gitignore`.
  19. Друкує `✨ Готово: <successCount> завантажено, <failCount> з помилками`. Якщо `failCount > 0` — кидає `Error`.
- **Side effects:** масові операції з файловою системою у `cwd()`, дочірні процеси `bun i` через `upgradeNitraCursorToLatestAndBunInstall`, мережа (npm) для self-upgrade.

## Top-level потік виконання

Виконуваний код у кінці файлу:

```text
const [command, ...args] = process.argv.slice(2)
try {
  await ensureNitraCursorInRootDevDependencies(cwd())
  env.ADR_HOOKS_SKIP = '1'
  switch (command) { … }
} catch (error) {
  if (error instanceof ReexecHandoff) process.exitCode = error.code
  else if (error instanceof Error && error.message) { console.error(error.message); process.exitCode = 1 }
  else { console.error(error); process.exitCode = 1 }
}
```

`env.ADR_HOOKS_SKIP = '1'` виставляється **до** `switch (command)` — покриває всі підкоманди-оркестратори (`hook`, `lint`, `skill`, `adr-normalize-local`, `taze`, `release` тощо) одним викликом без пер-case дублювання. ADR Stop-хуки (`capture-decisions.sh`, `normalize-decisions.sh`) і `pi`-extension (`n-cursor-adr`) перевіряють цей прапор і мовчки виходять, щоб технічна LLM-сесія оркестратора не потрапляла в ADR-захоплення рішень (spec `2026-06-30`).

### Алгоритм маршрутизації команд (switch)

- `'fix'` → `runFixCommand(args)`.
- `'check'` → друкує deprecated-попередження й виконує `runFixCommand(args)`.
- `'rename-yaml-extensions'` → `runRenameYamlExtensionsCli(args)`; якщо повернений код `!== 0`, `process.exitCode = 1`.
- `'post-tool-use-fix'` → `runPostToolUseFixCli()` (PostToolUse hook Claude Code, читає stdin); `process.exitCode` = повернений код.
- `'lint'` → `runLint({ full, readOnly, rules })` (прапори `--full`, `--read-only`; позиційні аргументи — фільтр правил конформності).
- `'lint-ci'` → `runLint({ ci: true })`.
- `'coverage'` → динамічний import `../rules/test/coverage/coverage.mjs`, виклик `runCoverageCli({ fix: args.includes('--fix'), changed: args.includes('--changed') })`.
- `'release'` → динамічний import `../rules/release/release.mjs` → `runReleaseCli(args)`.
- `'skill'` → `runSkillsCli(args)` (синхронний).
- `'worktree'` → `runWorktreeCli(args)`.
- `'trace'` → динамічний import `../scripts/dispatcher/trace.mjs` → `runTraceCli(args)`.
- `'docgen'` → динамічний import `../skills/docgen/js/docgen-scan.mjs`. Якщо `args[0] === 'scan'` → `runDocgenScanCli(args.slice(1))`; якщо `'modules'` → `runDocgenModulesCli(args.slice(1))`; інакше друкує `Usage: …` і `process.exitCode = 1`.
- `undefined` або `''` (нема команди) → `runSync()`.
- `default` — невідома команда: stderr, перелік очікуваних, `process.exitCode = 1`.

### Обробка винятків верхнього рівня

1. `ReexecHandoff` → `process.exitCode = error.code` (мовчазно, без stack-trace).
2. `Error` із непорожнім `message` → `console.error(error.message)` + `process.exitCode = 1`.
3. Будь-що інше → `console.error(error)` + `process.exitCode = 1`.

### Передумова перед switch

`await ensureNitraCursorInRootDevDependencies(cwd())` — у корені проєкту (`package.json` із `workspaces`): якщо `@nitra/cursor` відсутній у `devDependencies`/`dependencies`, додається `^<currentVersion>`; якщо вже присутній у `devDependencies` зі старішим числовим піном — **self-upgrade** до `^<currentVersion>` (ніколи не понижує; нечислові піни `workspace:*`/`latest`/git і записи в `dependencies` не чіпаються). Зручно після `npx` і прибирає дрейф версії self-lint. Виконується для **всіх** команд, не лише для `runSync`.

## Залежності

### Node.js core

- `node:child_process` — `spawnSync`.
- `node:fs` — `existsSync`.
- `node:fs/promises` — `mkdir`, `readdir`, `readFile`, `rename`, `rm`, `unlink`, `writeFile`.
- `node:path` — `basename`, `dirname`, `join`.
- `node:process` — `cwd`, `env`. Опосередковано — глобальні `process.argv`, `process.execPath`, `process.exitCode`, `process.stdout`, `process.stderr`.
- `node:url` — `fileURLToPath`.

### Внутрішні модулі пакета

- `../scripts/build-agents-commands.mjs` — `buildAgentsCommandBulletItems`.
- `../scripts/lib/generated-markdown.mjs` — `formatGeneratedMarkdownLines`, `renderAgentsTemplate`.
- `../scripts/lib/inline-template-links.mjs` — `inlineTemplateLinks`.
- `../scripts/auto-rules.mjs` — `detectAutoRules`, `detectLegacyRuleIds`, `mergeConfigWithAutoDetected`, `normalizeIdList`, `RULE_MIGRATIONS`.
- `../scripts/auto-skills.mjs` — `detectAutoSkills`.
- `../scripts/lib/skill-meta.mjs` — `readSkillMetaRaw`.
- `../scripts/lib/worktree-notice.mjs` — `injectWorktreeNotice`.
- `../scripts/post-tool-use-fix.mjs` — `runPostToolUseFixCli`.
- `../scripts/lib/discover-check-rules-from-cursor.mjs` — `discoverCheckRulesFromCursorRules`.
- `../scripts/lib/list-rule-ids.mjs` — `listRuleIds`.
- `../scripts/ensure-nitra-cursor-dev-dependencies.mjs` — `ensureNitraCursorInRootDevDependencies`.
- `../scripts/sync-claude-config.mjs` — `syncClaudeConfig`.
- `../scripts/lib/sync-gitignore-worktree.mjs` — `syncGitignoreWorktree`.
- `../scripts/upgrade-nitra-cursor-and-install.mjs` — `upgradeNitraCursorToLatestAndBunInstall`.
- `./rename-yaml-extensions.mjs` — `runRenameYamlExtensionsCli` (сусід у `bin/`).
- `../scripts/skills-cli.mjs` — `runSkillsCli`.
- `../scripts/worktree-cli.mjs` — `runWorktreeCli`.
- `../scripts/sync-setup-bun-deps-action.mjs` — `syncSetupBunDepsAction`.
- `../scripts/lint-cli.mjs` — `runLint`.
- `../scripts/lib/timing-summary.mjs` — `formatTimingSummary`.
- `../scripts/lib/ensure-tool.mjs` — `ensureHkInstall`, `ensureTool`.

### Динамічні (lazy) залежності

- `../rules/test/coverage/coverage.mjs` — `runCoverageCli`.
- `../rules/release/release.mjs` — `runReleaseCli`.
- `../scripts/dispatcher/trace.mjs` — `runTraceCli`.
- `../skills/docgen/js/docgen-scan.mjs` — `runDocgenScanCli`, `runDocgenModulesCli`.

### Зовнішні інструменти (виконуються через `spawnSync` / в `fix.mjs`)

- `bun` — для `spawnSync('bun', [fixPath], …)` у `runFixCommand` і для `bun i` всередині `upgradeNitraCursorToLatestAndBunInstall`.
- `hk`, `conftest` — забезпечуються `ensureTool`/`ensureHkInstall` перед `runFixCommand`.
- `shellcheck`, `bunx github-actionlint`, `uvx zizmor`, `opa`, `regal`, `kubeconform`, `kubescape`, `hadolint`, `cspell`, `markdownlint-cli2`, `v8r` — викликаються відповідними `lint-*` під-CLI.

## Потік виконання / Використання

### Приклад 1: повна синхронізація проєкту-споживача

```bash
cd <my-project>
npx @nitra/cursor
```

Це викликає `runSync()`. Якщо `.n-cursor.json` немає — створюється з авто-визначеними правилами/скілами. Усі керовані артефакти переписуються; зайві `n-*` файли/каталоги в `.cursor/rules`, `.cursor/skills`, `.claude/commands`, `.pi/skills` видаляються; `AGENTS.md`, `CLAUDE.md`, composite action, `.claude/settings.json`, `.cursor/hooks.json`, `.gitignore` синхронізуються. По завершенні друкується підсумок `✨ Готово: …`.

### Приклад 2: виконати fix лише для заданих правил

```bash
npx @nitra/cursor fix bun ga
```

`runFixCommand(['bun', 'ga'])` перевіряє, що `bun`, `ga` є серед доступних, і запускає `bun rules/bun/fix.mjs`, потім `bun rules/ga/fix.mjs`. По кожному кроку — таймінг. При невдачах кидається `Error`.

### Приклад 3: fix-discovery з `.cursor/rules`

```bash
npx @nitra/cursor fix
```

`runFixCommand([])` дивиться у `.cursor/rules/*.mdc` поточного проєкту і запускає `fix.mjs` тільки для тих правил, у яких пакет має програмну перевірку.

### Приклад 4: docgen

```bash
npx @nitra/cursor docgen scan --root <dir>
npx @nitra/cursor docgen modules
```

Динамічно вантажить `../skills/docgen/js/docgen-scan.mjs` і виконує відповідний sub-CLI. Аргумент `args[0]` мусить бути `scan` або `modules`, інакше — друк `Usage: …` і exit code 1.

### Приклад 5: PostToolUse hook у Claude Code

`.claude/settings.json` зі секцією, де `command = 'npx @nitra/cursor post-tool-use-fix'` (синхронізується автоматично через `syncClaudeConfig`). Hook читає JSON зі stdin, з `tool_input.file_path` маршрутизує файл у потрібні правила і викликає `fix` лише з ними.

### Потокова діаграма `runSync`

```text
runSync()
  ├─ banner
  ├─ upgradeNitraCursorToLatestAndBunInstall  → effectivePackageRoot
  ├─ reexecIfPackageVersionChanged            → ReexecHandoff?
  ├─ readConfig({ bundledRulesDir, bundledSkillsDir })
  │     ├─ migrateLegacyConfigIfNeeded
  │     ├─ discoverBundledRuleNames / discoverBundledSkillNames
  │     ├─ (create defaults) | parse+normalize+save
  │     └─ logRuleMigrationsIfAny
  ├─ syncSetupBunDepsAction
  ├─ syncManagedRuleFiles  → removeOrphanManagedRuleFiles
  ├─ syncSkills            → removeOrphanManagedSkillDirs
  ├─ syncCommands + syncLocalOnlySkillCommands
  │     └─ removeOrphan…CommandFiles
  ├─ syncPiSkills + syncLocalOnlyPiSkills
  │     └─ removeOrphan…PiSkillDirs
  ├─ syncAgentsMd
  ├─ syncClaudeMd(ignore)
  ├─ syncClaudeConfig({ enabled, rules, … })
  ├─ syncGitignoreWorktree
  └─ final summary (or throw)
```

### Інваріанти, важливі для відтворення (Rebuild Test)

- Усі масиви id у `.n-cursor.json` (`rules`, `skills`, `disable-rules`, `disable-skills`) сортуються алфавітно за `localeCompare` перед записом.
- `$schema` у `.n-cursor.json` завжди дорівнює `CONFIG_SCHEMA_URL`; при невідповідності диск перезаписується.
- `version` у `.n-cursor.json` ігнорується при синхронізації правил; правила беруться з установленого пакета (`effectivePackageRoot`).
- Префікс `n-` означає "керований пакетом" — застосовується до `.mdc`, каталогів `.cursor/skills/n-<id>`, `.claude/commands/n-<id>.md`, `.pi/skills/n-<id>/SKILL.md`.
- `meta.json` у джерельному `skills/<id>/` ніколи не копіюється у проєкт; підкаталоги `skills/<id>/<підкаталог>/` (наприклад `js/`) теж не копіюються — їх запускає `npx`.
- `SKILL.md` під час копіювання проходить `injectWorktreeNotice(content, worktree === true)`, де `worktree` — поле з `meta.json`.
- `claude-config: false` у `.n-cursor.json` повністю вимикає крок `syncClaudeConfig` (виводиться повідомлення про пропуск).
- `ignore` у `.n-cursor.json` — масив рядків; у `CLAUDE.md` додається секція `## Захищені директорії` із цими шляхами.
- `runFixCommand` спочатку гарантує наявність `hk` і `conftest`. При запуску без аргументів і за наявності `.mdc` без жодних із програмними перевірками — функція друкує повідомлення і завершується успішно (`return`), не кидаючи помилки.
- `reexecIfPackageVersionChanged` ніколи не респавнить себе більше одного разу через env `NITRA_CURSOR_REEXEC=1`.
- Top-level catch розрізняє `ReexecHandoff` від звичайних помилок — у першому випадку stack-trace **не** друкується.
- `ensureNitraCursorInRootDevDependencies(cwd())` виконується **до** свічу команд — а отже, навіть для команд на кшталт `lint` або `worktree`.
