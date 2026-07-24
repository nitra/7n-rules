#!/usr/bin/env node
/**
 * Сортує масиви id у конфігу за алфавітом (`localeCompare`), щоб порядок у файлі був стабільним після синку.
 * @param {Record<string, unknown>} config об'єкт конфігу перед записом на диск
 * @returns {Record<string, unknown>} копія з відсортованими масивами для відомих ключів
 */
export function sortConfigIdArrays(config: Record<string, unknown>): Record<string, unknown>
/**
 * Імена правил з каталогу `rules/` поточної інсталяції пакету. Кожне правило — окремий
 * підкаталог `rules/<id>/`, у якому має бути `main.mdc`.
 * @param {string} [bundledRulesDir] каталог `rules/` у корені пакету
 * @returns {Promise<string[]>} відсортовані id правил (імена підкаталогів)
 */
export function discoverBundledRuleNames(bundledRulesDir?: string): Promise<string[]>
/**
 * Імена skills (id без префікса n-) з каталогу skills пакету — лише підкаталоги `<id>/` без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету
 * @returns {Promise<string[]>} відсортовані id
 */
export function discoverBundledSkillNames(bundledSkillsDir?: string): Promise<string[]>
/**
 * Перейменовує у каталозі правил файли `nitra-*.mdc` → `n-*.mdc`. Якщо `n-*.mdc` уже є, застарілий файл видаляється.
 * @param {string} rulesDir абсолютний шлях до `.cursor/rules`
 * @returns {Promise<void>}
 */
export function migrateLegacyManagedRuleFilenames(rulesDir: string): Promise<void>
/**
 * Міграція legacy: `nitra-*.mdc` → `n-*.mdc` у `.cursor/rules`; якщо немає `.n-rules.json`, конфіг
 * береться з legacy-імен (`.n-rules.json`, потім `nitra-cursor.json`) з переписуванням `$schema` на новий URL
 * @returns {Promise<void>}
 */
export function migrateLegacyConfigIfNeeded(): Promise<void>
/**
 * Повертає розпарсений package.json з кореня або null, якщо файл відсутній/некоректний.
 * @returns {Promise<unknown | null>} обʼєкт package.json або null
 */
export function readRootPackageJsonSafe(): Promise<unknown | null>
/**
 * Агрегує імена правил по rules-каталогах (ядро перше, перший власник виграє)
 * і будує мапу `ruleId → rulesDir` для копіювання mdc.
 * @param {string[]} rulesDirs упорядковані rules-каталоги (ядро + плагіни)
 * @returns {Promise<{ names: string[], sources: Map<string, string>, extras: Map<string, string[]> }>} імена правил, їх джерела і mixin-теки
 */
export function aggregateRuleSources(rulesDirs: string[]): Promise<{
  names: string[]
  sources: Map<string, string>
  extras: Map<string, string[]>
}>
/**
 * Імена правил (теки з `main.mdc`) кожного rules-каталогу. Для ядра (перший елемент)
 * відсутність каталогу — фатальна помилка; для плагінів — порожній список
 * (уже повідомлено у resolve-plugins).
 * @param {string[]} rulesDirs упорядковані rules-каталоги
 * @returns {Promise<string[][]>} імена правил per-dir у тому ж порядку
 */
export function listRuleNamesPerDir(rulesDirs: string[]): Promise<string[][]>
/**
 * Додає у `extras` mixin-теки плагіна: підкаталоги `rules/<id>/` БЕЗ `main.mdc`
 * (плагін доповнює правило іншого джерела концернами).
 * @param {string} dir rules-каталог плагіна
 * @param {string[]} ownNames імена повних правил цього каталогу (з main.mdc)
 * @param {Map<string, string[]>} extras акумулятор mixin-тек (мутується)
 * @returns {Promise<void>}
 */
export function collectMixinDirs(dir: string, ownNames: string[], extras: Map<string, string[]>): Promise<void>
/**
 * Зчитує конфіг .n-rules.json з поточної директорії
 * @param {{ bundledRulesDir?: string, bundledSkillsDir?: string }} [paths] каталоги з пакету-джерела (після `bun i` — зазвичай `node_modules/@7n/rules`)
 * @returns {Promise<{ $schema: string, rules: string[], skills: string[], version?: string } & Record<string, unknown>>} rules, skills (id без префікса n-); поле version у файлі за наявності ігнорується при синхронізації правил
 */
export function readConfig(paths?: { bundledRulesDir?: string; bundledSkillsDir?: string }): Promise<
  {
    $schema: string
    rules: string[]
    skills: string[]
    version?: string
  } & Record<string, unknown>
>
/**
 * Витягує чистий id правила без шляху і без .mdc.
 * "npm/rules/text/text.mdc" → "text"
 * "text.mdc"                → "text"
 * "text"                    → "text"
 * @param {string} ruleName шлях або базове ім'я, з суфіксом .mdc або без
 * @returns {string} id правила (без .mdc, без шляху)
 */
export function normalizeRuleName(ruleName: string): string
/**
 * Читає вміст правила з каталогу `rules/<id>/main.mdc` установленого пакету
 * (наприклад `node_modules/@7n/rules/rules/<id>/main.mdc` або кеш npx).
 * Mixin-концерни: `extraRuleDirs` — каталоги `rules/<id>/` того самого правила з ІНШИХ
 * джерел (плагінів); їхні concern-mdc доінлайнюються після концернів власника, тож
 * `.cursor/rules/n-<id>.mdc` містить і провайдер-специфічні розділи (напр. lint_js_yml
 * з `@7n/rules-ci-github` чи lint_pipeline_js з `@7n/rules-ci-azure`).
 * @param {string} rule елемент масиву rules з `.n-rules.json`
 * @param {string} [bundledRulesDir] каталог `rules/` у корені пакету-джерела (власник main.mdc)
 * @param {string[]} [extraRuleDirs] каталоги `rules/<id>/` mixin-джерел (без main.mdc)
 * @returns {Promise<string>} текст правила для запису в `.cursor/rules/n-*.mdc`
 */
export function readBundledRuleContent(
  rule: string,
  bundledRulesDir?: string,
  extraRuleDirs?: string[]
): Promise<string>
/**
 * Нормалізує id skill з конфігу до форми без префікса n- (як «fix»)
 * @param {string} skillName елемент масиву skills або ім'я каталогу
 * @returns {string} id без префікса n-
 */
export function normalizeSkillId(skillName: string): string
/**
 * Ім'я керованого каталогу skill у .cursor/skills (префікс n-)
 * @param {string} skillId id без префікса (або з префіксом n- у конфігу — нормалізується)
 * @returns {string} наприклад n-fix
 */
export function managedSkillDirName(skillId: string): string
/**
 * Витягує текст description з YAML frontmatter SKILL.md (формат description: >-)
 * @param {string} text повний вміст SKILL.md
 * @returns {string | null} один рядок опису або null
 */
export function extractSkillDescription(text: string): string | null
/**
 * Підготовка опису skill для вставки в звичайний markdown (заголовок H1, bullet без code fence).
 * Послідовність `<id>` сприймається markdownlint (MD033) як inline HTML — замінюємо на `{id}`.
 * @param {string} desc один рядок з YAML frontmatter SKILL.md
 * @returns {string} той самий рядок після заміни літералу з кутовими дужками навколо id на плейсхолдер у фігурних дужках (MD033).
 */
export function skillDescriptionSafeForMarkdownInline(desc: string): string
/**
 * YAML frontmatter для `.claude/commands/*.md`: поле `description` потрібне розширенню VSCode,
 * щоб команди з’являлись у списку. Текст збігається з полем `description` у frontmatter `SKILL.md`.
 * @param {string} descriptionRaw значення з `extractSkillDescription` (може бути порожнім)
 * @returns {string} блок `---` … `---` і порожній рядок після
 */
export function formatClaudeCommandFrontmatter(descriptionRaw: string): string
/**
 * YAML frontmatter для `.pi/skills/<dir>/SKILL.md` згідно зі специфікацією pi.dev:
 * обов'язкові поля `name` (1-64, `[a-z0-9-]`) і `description` (≤ 1024). Текст description збігається
 * з полем `description` у frontmatter джерельного `SKILL.md`.
 * @param {string} skillName ім'я скілу (наприклад `n-fix`); має бути валідним pi-name
 * @param {string} descriptionRaw значення з `extractSkillDescription` (може бути порожнім)
 * @returns {string} блок `---` … `---` і порожній рядок після
 */
export function formatPiSkillFrontmatter(skillName: string, descriptionRaw: string): string
/**
 * Базові імена файлів .mdc, які очікуються згідно з .n-rules.json (префікс n-).
 * @param {string[]} configRules елементи масиву rules з конфігу
 * @returns {Set<string>} множина очікуваних імен файлів (наприклад n-bun.mdc)
 */
export function expectedManagedRuleBasenames(configRules: string[]): Set<string>
/**
 * Видаляє з каталогу правил файли *.mdc з префіксом n-, яких немає у конфігурації.
 * Файли без префікса n- не змінює.
 * @param {string} rulesDir абсолютний шлях до .cursor/rules
 * @param {string[]} configRules елементи масиву rules з .n-rules.json
 * @returns {Promise<string[]>} відсортовані імена видалених файлів
 */
export function removeOrphanManagedRuleFiles(rulesDir: string, configRules: string[]): Promise<string[]>
/**
 * Повертає відсортований список директорій skills у `.cursor/skills`.
 * Директорія вважається skill-каталогом, якщо це підкаталог (без префікса `.`).
 * @returns {Promise<string[]>} імена директорій (наприклад `n-fix`, `custom-skill`)
 */
export function listProjectSkillDirNames(): Promise<string[]>
/**
 * Формує markdown-рядки для секції Skills у AGENTS.md з усіх skill-директорій на диску.
 * @returns {Promise<{ name: string }[]>} елементи з полем name для Mustache-секції skills
 */
export function buildSkillBulletItems(): Promise<
  {
    name: string
  }[]
>
/**
 * Видаляє каталоги n-* у .cursor/skills, яких немає у конфігурації skills
 * @param {string} skillsRoot абсолютний шлях до .cursor/skills
 * @param {string[]} configSkills елементи масиву skills з .n-rules.json
 * @returns {Promise<string[]>} імена видалених каталогів
 */
export function removeOrphanManagedSkillDirs(skillsRoot: string, configSkills: string[]): Promise<string[]>
/**
 * Рендерить секцію Skills для CLAUDE.md з урахуванням наявних slash-команд.
 * @returns {Promise<string[]>} готові рядки секції (або порожній масив)
 */
export function buildClaudeSkillsSectionLines(): Promise<string[]>
/**
 * Генерує CLAUDE.md у корені cwd з at-імпортами всіх .mdc-правил та посиланнями на skills.
 * Завдяки цьому Claude Code автоматично завантажує вміст кожного правила при старті.
 * @returns {Promise<void>}
 */
/**
 * @param {string[]} [ignore] директорії заборонені для редагування
 */
export function syncClaudeMd(ignore?: string[]): Promise<void>
/**
 * Повністю перезаписує AGENTS.md у корені cwd з npm/AGENTS.template.md
 * @param {string} [agentsTemplatePath] шлях до AGENTS.template.md у корені пакету-джерела
 * @returns {Promise<void>} завершення запису файлу
 */
export function syncAgentsMd(agentsTemplatePath?: string): Promise<void>
/**
 * Копіює лише skills зі списку configSkills (джерело: skills/<id>/ у пакеті)
 * @param {string[]} configSkills id без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету-джерела
 * @param {{ plugins?: unknown } | null} [config] конфіг `.n-rules.json` — активні плагіни для SKILL-фрагментів
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих копіювань
 */
export function syncSkills(
  configSkills: string[],
  bundledSkillsDir?: string,
  config?: {
    plugins?: unknown
  } | null
): Promise<{
  success: number
  fail: number
}>
/**
 * Синхронізує .claude/commands/n-<id>.md зі skills пакету.
 * У кожному файлі обов’язково YAML frontmatter з `description` (як у `SKILL.md`), інакше команди
 * не з’являються у розширенні VSCode; далі — заголовок H1 лише з імені команди (без повтору опису) і посилання на `.cursor/skills/…/SKILL.md`.
 * @param {string[]} configSkills id без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету-джерела
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
export function syncCommands(
  configSkills: string[],
  bundledSkillsDir?: string
): Promise<{
  success: number
  fail: number
}>
/**
 * Видаляє файли n-*.md у .claude/commands, яких немає у конфігурації skills
 * @param {string} commandsDir абсолютний шлях до .claude/commands
 * @param {string[]} configSkills id без префікса n-
 * @returns {Promise<string[]>} імена видалених файлів
 */
export function removeOrphanManagedCommandFiles(commandsDir: string, configSkills: string[]): Promise<string[]>
/**
 * Синхронізує .claude/commands/{dirName}.md для всіх локальних скілів з .cursor/skills/
 * що не керуються пакетом (відсутні в configSkills). Frontmatter `description` — як у відповідному SKILL.md.
 * @param {string[]} configSkills id керованих skills (вже оброблені syncCommands)
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
export function syncLocalOnlySkillCommands(configSkills: string[]): Promise<{
  success: number
  fail: number
}>
/**
 * Видаляє .claude/commands/{dirName}.md файли локальних скілів, яких більше немає в .cursor/skills/
 * @param {string} commandsDir абсолютний шлях до .claude/commands
 * @param {string[]} configSkills id керованих skills
 * @returns {Promise<string[]>} імена видалених файлів
 */
export function removeOrphanLocalSkillCommandFiles(commandsDir: string, configSkills: string[]): Promise<string[]>
/**
 * Синхронізує .pi/skills/n-<id>/SKILL.md зі skills пакету для pi.dev-сумісності.
 * Pi-skill — це директорія з SKILL.md (frontmatter `name`+`description`), тіло-делегат на джерельний
 * `.cursor/skills/<dir>/SKILL.md`. Симетрично до `syncCommands`, але дир замість `.md`-файлу.
 * @param {string[]} configSkills id без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету-джерела
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
export function syncPiSkills(
  configSkills: string[],
  bundledSkillsDir?: string
): Promise<{
  success: number
  fail: number
}>
/**
 * Синхронізує .pi/skills/{dirName}/SKILL.md для всіх локальних скілів з .cursor/skills/
 * що не керуються пакетом. Симетрично до `syncLocalOnlySkillCommands`.
 * @param {string[]} configSkills id керованих skills (уже оброблені syncPiSkills)
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
export function syncLocalOnlyPiSkills(configSkills: string[]): Promise<{
  success: number
  fail: number
}>
/**
 * Видаляє n-* директорії у .pi/skills, яких немає у конфігурації skills.
 * @param {string} piSkillsDir абсолютний шлях до .pi/skills
 * @param {string[]} configSkills id без префікса n-
 * @returns {Promise<string[]>} імена видалених директорій
 */
export function removeOrphanManagedPiSkillDirs(piSkillsDir: string, configSkills: string[]): Promise<string[]>
/**
 * Видаляє .pi/skills/{dirName} директорії локальних скілів, яких більше немає в .cursor/skills/.
 * @param {string} piSkillsDir абсолютний шлях до .pi/skills
 * @param {string[]} configSkills id керованих skills
 * @returns {Promise<string[]>} імена видалених директорій
 */
export function removeOrphanLocalPiSkillDirs(piSkillsDir: string, configSkills: string[]): Promise<string[]>
/**
 * Людинозрозумілий текст винятку для логів.
 * @param {unknown} error виняток із catch
 * @returns {string} текст повідомлення
 */
export function errorMessage(error: unknown): string
/**
 * Виконує крок синхронізації з уніфікованим логуванням помилки.
 * @template T
 * @param {string} prefix префікс повідомлення про помилку
 * @param {() => Promise<T>} action операція
 * @returns {Promise<T>} результат операції
 */
export function runSyncStep<T>(prefix: string, action: () => Promise<T>): Promise<T>
/**
 * Виконує `action`, буферизуючи весь його stdout/console-вивід.
 *
 * Мотивація: за успішного прогону sync-блоку рядки `⬇ … ✅` і підсумок
 * (`🧩 Skills: N скопійовано, 0 з помилками`) не несуть користі й лише
 * захаращують термінал. Тому буфер скидається в реальний stdout **лише**
 * коли крок повернув `fail > 0` (або кинув виняток); за `fail === 0` —
 * відкидається мовчки.
 * @template T
 * @param {() => Promise<T>} action крок синку, що повертає обʼєкт із лічильником помилок `fail`
 * @returns {Promise<T>} результат `action` без змін
 */
export function captureOutput<T>(action: () => Promise<T>): Promise<T>
/**
 * Копіює керовані `.mdc` файли з пакету до `.cursor/rules`.
 * @param {string[]} rules список rules з конфігу
 * @param {string} bundledRulesDir каталог `rules` пакету-джерела (fallback для правил без явного джерела)
 * @param {string} rulesDir абсолютний шлях до `.cursor/rules`
 * @param {Map<string, string>} [ruleSources] мапа `ruleId → rulesDir` власника правила (ядро/плагін)
 * @param {Map<string, string[]>} [ruleExtras] мапа `ruleId → rules/<id>-теки` mixin-джерел (concern-mdc доінлайнюються)
 * @returns {Promise<{ successCount: number, failCount: number }>} статистика копіювання
 */
export function syncManagedRuleFiles(
  rules: string[],
  bundledRulesDir: string,
  rulesDir: string,
  ruleSources?: Map<string, string>,
  ruleExtras?: Map<string, string[]>
): Promise<{
  successCount: number
  failCount: number
}>
/**
 * Логує видалені керовані правила/skills/commands у єдиному форматі.
 * @param {string} title назва сутностей
 * @param {string} basePath базовий шлях для виводу
 * @param {string[]} names перелік елементів
 * @returns {void}
 */
export function logRemovedManagedItems(title: string, basePath: string, names: string[]): void
/**
 * Читає поле `version` з `package.json` пакету за абсолютним шляхом до його кореня.
 * @param {string} packageRoot корінь пакету (тека з `package.json`)
 * @returns {Promise<string | null>} semver рядком або null, якщо файлу/поля немає або JSON некоректний
 */
export function readBundledVersionAt(packageRoot: string): Promise<string | null>
/**
 * Якщо `upgradeNRulesToLatestAndBunInstall` встановив у `node_modules/@7n/rules` версію,
 * відмінну від тієї, з якої стартував поточний процес (наприклад, з npx-кешу), запускає бінар нової
 * версії через `spawnSync` і завершує поточний процес із успадкованим exit-кодом. Re-exec потрібен,
 * бо ES-модулі вже завантажені у V8 (RULE_MIGRATIONS, detectAutoRules тощо) і нова логіка
 * без повної заміни процесу не підхопиться. Захист від нескінченного циклу — env `NITRA_CURSOR_REEXEC=1`.
 *
 * Порівнює версії, **не** шляхи: коли `npx` резолвиться в локальний
 * `<projectRoot>/node_modules/@7n/rules` (проєкт уже має пакет у devDependencies),
 * `effectivePackageRoot` до і після `upgradeNRulesToLatestAndBunInstall` — той самий шлях,
 * `bun i` лише перезаписує файли за ним in-place. Читати "поточну" версію з цього шляху
 * ПІСЛЯ апгрейду означало б читати вже НОВУ версію — порівняння завжди збігалося б і
 * re-exec ніколи не спрацьовував би, попри те що в памʼяті процесу лишається старий код.
 * Тому `startVersion` фіксується викликачем ДО апгрейду.
 * @param {string} effectivePackageRoot шлях, повернутий `upgradeNRulesToLatestAndBunInstall`
 * @param {string | null} startVersion версія `@7n/rules`, з якою стартував процес (прочитана
 *   з `BUNDLED_PACKAGE_ROOT` до виклику `upgradeNRulesToLatestAndBunInstall`)
 * @returns {Promise<void>} повертається лише якщо re-exec не потрібен; інакше кидає `ReexecHandoff`,
 *   який ловить top-level catch і прокидає exit-код у `process.exitCode`
 */
export function reexecIfPackageVersionChanged(effectivePackageRoot: string, startVersion: string | null): Promise<void>
/**
 * Копіює правила з каталогу `mdc/` установленого пакету та синхронізує `.cursor/rules`
 * @returns {Promise<void>}
 */
export function runSync(): Promise<void>
/**
 * Короткий опис дії для тексту root-guard помилки за іменем команди.
 * @param {string | undefined} cmd підкоманда CLI (або undefined для дефолтного sync)
 * @returns {string} фраза «що саме мутує CWD»
 */
export function describeRootGuardedAction(cmd: string | undefined): string
/**
 * Довідка для `n-rules lint --help`: прапори unified lint surface
 * (spec 2026-06-29 fix-by-default, spec 2026-07-03 глобальна черга --full).
 */
export function printLintHelp(): void
/**
 * CLI: маршрутизація команд. Виконує повний дельта/full lint, sync, release тощо
 * залежно від `argv` (типово `process.argv.slice(2)`), включно з фінальним
 * встановленням exit-коду (`process.exitCode`/`process.emit('exit', …)`/`process.reallyExit`).
 * @param {string[]} argv аргументи CLI без `node`/шляху скрипта (типово `process.argv.slice(2)`)
 * @returns {Promise<void>}
 */
export function runCli(argv: string[]): Promise<void>
/**
 * Сентинельна помилка, яку кидає `reexecIfPackageVersionChanged` після успішного re-exec.
 * Top-level catch розпізнає її й виставляє `process.exitCode = code` без stack-trace —
 * процес тоді коректно завершується з тим самим кодом, що й child re-exec-у.
 */
export class ReexecHandoff extends Error {
  /**
   * @param {number} code exit-код, який повернув child-процес
   */
  constructor(code: number)
  code: number
}
