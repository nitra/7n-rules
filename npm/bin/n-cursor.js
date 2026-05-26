#!/usr/bin/env node

/**
 * n-cursor — CLI завантаження правил та перевірки проєкту
 *
 * Використання:
 *   `npx \@nitra/cursor`             — завантажити cursor-правила
 *   `npx \@nitra/cursor fix`         — перевірити правила з `.cursor/rules/*.mdc`, для яких у пакеті є `fix.mjs`/policy;
 *                                     якщо в корені вже є `.n-cursor.json`, спочатку зчитується конфіг і за потреби дописується `$schema`
 *   `npx \@nitra/cursor fix bun`     — перевірити лише вказані правила (ігнорує `.cursor/rules/`)
 *   `npx \@nitra/cursor rename-yaml-extensions` — k8s `*.yml` → `*.yaml`, `.github` `*.yaml` → `*.yml` (опції: `--dry-run`, `--root=…`; див. bin/rename-yaml-extensions.mjs)
 *   `npx \@nitra/cursor post-tool-use-fix` — точка входу PostToolUse hook Claude Code: читає stdin JSON,
 *                                     дістає `tool_input.file_path`, маршрутизує його у відповідні правила
 *                                     (`*.mjs` → `js-lint`, `*.vue` → `js-lint style-lint vue` тощо) і викликає
 *                                     `fix` лише з ними. Прописується автоматично в `.claude/settings.json`.
 *   `npx \@nitra/cursor lint`        — оркестратор lint-ланцюжка з кореневого `package.json` з тайменгом
 *                                     кожного `lint-*` / `oxfmt` скрипта (fail-fast); канонічна заміна
 *                                     раніше ручного `lint-ga && lint-js && …` агрегатора.
 *   `npx \@nitra/cursor lint-ga`     — канонічний lint-ga (ga.mdc): preflight на `shellcheck` →
 *                                     `bunx github-actionlint` → `uvx zizmor --offline --collect=workflows .`
 *   `npx \@nitra/cursor lint-rego`   — канонічний lint-rego (conftest.mdc + rego.mdc):
 *                                     preflight на `opa`/`regal` → `opa check --strict` → `regal lint` → опц. `conftest verify`
 *   `npx \@nitra/cursor lint-k8s`    — канонічний lint-k8s (k8s.mdc): `kubeconform` + `kubescape` по `…/k8s/*.yaml`
 *   `npx \@nitra/cursor lint-docker` — канонічний lint-docker (docker.mdc): `hadolint` по `Dockerfile`/`*.Dockerfile`
 *   `npx \@nitra/cursor lint-text`   — канонічний lint-text (text.mdc): `cspell` → `shellcheck` (з auto-fix) →
 *                                     `markdownlint-cli2 --fix` → `v8r` (json/json5/yaml/yml/toml)
 *   `npx \@nitra/cursor skill list`     — скіли пакета без синку в проєкт
 *   `npx \@nitra/cursor skill taze`     — промпт на stdout
 *   `npx \@nitra/cursor skill cursor taze ["task"]` — Cursor CLI (`cursor-agent -p`)
 *   `npx \@nitra/cursor skill claude taze ["task"]` — Claude Code CLI (`claude -p`)
 *
 * Agent інтеграція: під час синку, окрім `.cursor/rules` і `.claude/commands` (з skills), CLI ще раз
 * синхронізує `.claude/settings.json` (hooks + permissions; merge — користувацькі поля зберігаються)
 * і `.cursor/hooks.json` (Cursor Agent hooks; merge — користувацькі hooks зберігаються).
 * Опт-аут — поле `claude-config: false` у `.n-cursor.json`.
 * Pi.dev інтеграція: для кожного skill у `.cursor/skills/<dir>/` CLI генерує
 * `.pi/skills/<dir>/SKILL.md` із frontmatter `name`+`description` (формат pi.dev). Тіло — делегат
 * на джерельний `.cursor/skills/<dir>/SKILL.md`. Always-on, симетрично до `.claude/commands/`.
 *
 * Якщо у корені репозиторію немає .n-cursor.json, спочатку перейменовується за наявності nitra-cursor.json;
 * у `.cursor/rules` файли `nitra-*.mdc` перейменовуються на `n-*.mdc`; інакше конфіг створюється автоматично
 * з усіма правилами з каталогу rules/ пакету (їх можна відредагувати після створення). У файлі завжди має бути
 * поле `$schema` з посиланням на JSON Schema пакету (публічний URL для IDE); при зчитуванні конфігу воно додається або виправляється на диску, якщо відсутнє або некоректне.
 * Масиви `rules`, `skills`, `disable-rules` і `disable-skills` при записі сортуються за алфавітом.
 *
 * Файл AGENTS.md у корені: щоразу повністю перезаписується змістом з AGENTS.template.md
 * пакету; список правил у шаблоні будується з файлів *.mdc у .cursor/rules поточного проєкту.
 * Секція команд — з кореневого package.json (scripts) та фіксовані рядки про CLI синхрону/перевірок.
 *
 * Після завантаження: у .cursor/rules видаляються файли *.mdc з префіксом «n-» (керовані
 * пакетом), яких немає у списку rules у .n-cursor.json. Інші .mdc у цій директорії залишаються.
 *
 * Composite GitHub Action `.github/actions/setup-bun-deps/action.yml` копіюється з каталогу
 * `github-actions/` пакету при кожному успішному синку (workflows з правил ga / js-lint / text).
 *
 * Skills копіюються з npm/skills пакету лише для id з масиву «skills» у .n-cursor.json
 * (у JSON — без префікса, як імена каталогів у rules/ без n-). У пакеті джерело — каталоги
 * skills/<id>/ (без префікса); у проєкті — .cursor/skills/n-<id>/ (префікс n-, як n-*.mdc).
 * Якщо ключа skills немає, за замовчуванням підтягуються всі підкаталоги skills/ (лише імена без префікса n-).
 * Зайві каталоги n-* у .cursor/skills, яких немає у списку, видаляються.
 * Файл `auto.md` у скілі — джерело правди для auto-skills у CLI (`scripts/auto-skills.mjs`)
 * і у проєкт не копіюється; раніше синхронізовані `auto.md` у `.cursor/skills/n-<id>/` CLI
 * не чіпає — їх потрібно прибрати вручну.
 *
 * Якщо в корені є package.json і в ньому ще немає \@nitra/cursor у devDependencies (і не оголошено
 * в dependencies), CLI дописує devDependencies з діапазоном ^<version> поточного пакету — зручно після npx.
 *
 * Перед копіюванням правил (режим без підкоманди): оновлення \@nitra/cursor у package.json до
 * останньої версії з npm (крім workspace:/file:/link: тощо), `bun i`, далі файли беруться з
 * `node_modules/@nitra/cursor`, якщо пакет з’явився після встановлення.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { cwd, env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { buildAgentsCommandBulletItems } from '../scripts/build-agents-commands.mjs'
import { formatGeneratedMarkdownLines, renderAgentsTemplate } from '../scripts/lib/generated-markdown.mjs'
import { inlineTemplateLinks } from '../scripts/lib/inline-template-links.mjs'
import {
  detectAutoRules,
  detectLegacyRuleIds,
  mergeConfigWithAutoDetected,
  normalizeIdList,
  RULE_MIGRATIONS
} from '../scripts/auto-rules.mjs'
import { detectAutoSkills } from '../scripts/auto-skills.mjs'
import { runPostToolUseFixCli } from '../scripts/post-tool-use-fix.mjs'
import { discoverCheckRulesFromCursorRules } from '../scripts/lib/discover-check-rules-from-cursor.mjs'
import { listRuleIds } from '../scripts/lib/list-rule-ids.mjs'
import { ensureNitraCursorInRootDevDependencies } from '../scripts/ensure-nitra-cursor-dev-dependencies.mjs'
import { runLintDocker } from '../rules/docker/lint/lint.mjs'
import { runLintGaCli } from '../rules/ga/lint/lint.mjs'
import { runLintK8s } from '../rules/k8s/lint/lint.mjs'
import { runLintRego } from '../rules/rego/lint/lint.mjs'
import { runLintTextCli } from '../rules/text/lint/lint.mjs'
import { syncClaudeConfig } from '../scripts/sync-claude-config.mjs'
import { upgradeNitraCursorToLatestAndBunInstall } from '../scripts/upgrade-nitra-cursor-and-install.mjs'
import { runRenameYamlExtensionsCli } from './rename-yaml-extensions.mjs'
import { runSkillsCli } from '../scripts/skills-cli.mjs'
import { syncSetupBunDepsAction } from '../scripts/sync-setup-bun-deps-action.mjs'
import { runLintCli } from '../scripts/lib/run-lint-cli.mjs'
import { formatTimingSummary } from '../scripts/lib/timing-summary.mjs'

const PACKAGE_NAME = '@nitra/cursor'
const CONFIG_FILE = '.n-cursor.json'
/** Публічний URL JSON Schema для поля `$schema` у `.n-cursor.json` (IDE); вміст правил CLI читає лише з диска пакету */
const CONFIG_SCHEMA_URL = 'https://unpkg.com/@nitra/cursor/schemas/n-cursor.json'
const AGENTS_FILE = 'AGENTS.md'
const AGENTS_TEMPLATE_FILE = 'AGENTS.template.md'
const RULES_DIR = '.cursor/rules'
const SKILLS_DIR = '.cursor/skills'
const COMMANDS_DIR = '.claude/commands'
const PI_SKILLS_DIR = '.pi/skills'
const RULE_PREFIX = 'n-'

const binDir = dirname(fileURLToPath(import.meta.url))
const BUNDLED_RULES_DIR = join(binDir, '..', 'rules')
const BUNDLED_SKILLS_DIR = join(binDir, '..', 'skills')
const BUNDLED_AGENTS_TEMPLATE_PATH = join(binDir, '..', AGENTS_TEMPLATE_FILE)
/** Корінь установленого пакету (каталог з `rules/`, `github-actions/`, …) */
const BUNDLED_PACKAGE_ROOT = join(binDir, '..')

const YAML_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/
const NEWLINE_RE = /\r?\n/
const LEADING_SPACES_RE = /^\s+/

/** Ключі `.n-cursor.json`, де значення — масиви id; після запуску CLI сортуються за алфавітом */
const CONFIG_SORTED_ARRAY_KEYS = /** @type {const} */ (['rules', 'skills', 'disable-rules', 'disable-skills'])

/**
 * Сортує масиви id у конфігу за алфавітом (`localeCompare`), щоб порядок у файлі був стабільним після синку.
 * @param {Record<string, unknown>} config об'єкт конфігу перед записом на диск
 * @returns {Record<string, unknown>} копія з відсортованими масивами для відомих ключів
 */
function sortConfigIdArrays(config) {
  const out = { ...config }
  for (const key of CONFIG_SORTED_ARRAY_KEYS) {
    const v = out[key]
    if (key in out && Array.isArray(v)) {
      out[key] = v.map(String).toSorted((a, b) => a.localeCompare(b))
    }
  }
  return out
}

/**
 * Імена правил з каталогу `rules/` поточної інсталяції пакету. Кожне правило — окремий
 * підкаталог `rules/<id>/`, у якому має бути `<id>.mdc`.
 * @param {string} [bundledRulesDir] каталог `rules/` у корені пакету
 * @returns {Promise<string[]>} відсортовані id правил (імена підкаталогів)
 */
async function discoverBundledRuleNames(bundledRulesDir = BUNDLED_RULES_DIR) {
  if (!existsSync(bundledRulesDir)) {
    throw new Error(
      `Не знайдено каталог правил пакету.\n` +
        `Очікуваний шлях: ${bundledRulesDir}\n` +
        `Перевстановіть ${PACKAGE_NAME} або створіть ${CONFIG_FILE} вручну.`
    )
  }
  const entries = await readdir(bundledRulesDir, { withFileTypes: true })
  const rules = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .filter(e => existsSync(join(bundledRulesDir, e.name, `${e.name}.mdc`)))
    .map(e => e.name)
    .toSorted((a, b) => a.localeCompare(b))
  if (rules.length === 0) {
    throw new Error(`У каталозі rules/ пакету немає підкаталогів з <id>.mdc. Створіть ${CONFIG_FILE} вручну.`)
  }
  return rules
}

/**
 * Імена skills (id без префікса n-) з каталогу skills пакету — лише підкаталоги `<id>/` без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету
 * @returns {Promise<string[]>} відсортовані id
 */
async function discoverBundledSkillNames(bundledSkillsDir = BUNDLED_SKILLS_DIR) {
  if (!existsSync(bundledSkillsDir)) {
    return []
  }
  const entries = await readdir(bundledSkillsDir, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith(RULE_PREFIX))
    .map(e => e.name)
    .toSorted((a, b) => a.localeCompare(b))
}

/**
 * Перейменовує у каталозі правил файли `nitra-*.mdc` → `n-*.mdc`. Якщо `n-*.mdc` уже є, застарілий файл видаляється.
 * @param {string} rulesDir абсолютний шлях до `.cursor/rules`
 * @returns {Promise<void>}
 */
async function migrateLegacyManagedRuleFilenames(rulesDir) {
  if (!existsSync(rulesDir)) {
    return
  }
  const names = await readdir(rulesDir)
  for (const name of names) {
    if (name.endsWith('.mdc') && name.startsWith('nitra-')) {
      const rest = name.slice('nitra-'.length)
      const newName = `${RULE_PREFIX}${rest}`
      const from = join(rulesDir, name)
      const to = join(rulesDir, newName)
      if (existsSync(to)) {
        await unlink(from)
        console.log(`📝 Видалено застарілий ${RULES_DIR}/${name} (вже є ${newName})\n`)
      } else {
        await rename(from, to)
        console.log(`📝 Перейменовано ${RULES_DIR}/${name} → ${RULES_DIR}/${newName}\n`)
      }
    }
  }
}

/**
 * Міграція legacy: `nitra-*.mdc` → `n-*.mdc` у `.cursor/rules`; якщо немає `.n-cursor.json`, але є `nitra-cursor.json` — перейменовує його в `.n-cursor.json`
 * @returns {Promise<void>}
 */
async function migrateLegacyConfigIfNeeded() {
  const root = cwd()
  await migrateLegacyManagedRuleFilenames(join(root, RULES_DIR))

  const target = join(root, CONFIG_FILE)
  if (existsSync(target)) {
    return
  }
  const legacyPath = join(root, 'nitra-cursor.json')
  if (existsSync(legacyPath)) {
    await rename(legacyPath, target)
    console.log(`📝 Перейменовано nitra-cursor.json → ${CONFIG_FILE}\n`)
  }
}

/**
 * Повертає розпарсений package.json з кореня або null, якщо файл відсутній/некоректний.
 * @returns {Promise<unknown | null>} обʼєкт package.json або null
 */
async function readRootPackageJsonSafe() {
  const packageJsonPath = join(cwd(), 'package.json')
  if (!existsSync(packageJsonPath)) {
    return null
  }
  try {
    return JSON.parse(await readFile(packageJsonPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Зчитує конфіг .n-cursor.json з поточної директорії
 * @param {{ bundledRulesDir?: string, bundledSkillsDir?: string }} [paths] каталоги з пакету-джерела (після `bun i` — зазвичай `node_modules/@nitra/cursor`)
 * @returns {Promise<{ $schema: string, rules: string[], skills: string[], version?: string } & Record<string, unknown>>} rules, skills (id без префікса n-); поле version у файлі за наявності ігнорується при синхронізації правил
 */
async function readConfig(paths = {}) {
  const bundledRulesDir = paths.bundledRulesDir ?? BUNDLED_RULES_DIR
  const bundledSkillsDir = paths.bundledSkillsDir ?? BUNDLED_SKILLS_DIR
  await migrateLegacyConfigIfNeeded()
  const configPath = join(cwd(), CONFIG_FILE)
  const availableRules = await discoverBundledRuleNames(bundledRulesDir)
  const availableSkills = await discoverBundledSkillNames(bundledSkillsDir)

  /**
   * Автодописує правила/skills за `rules/<rule>/auto.md` і синхронізує `$schema`.
   * @param {Record<string, unknown>} parsedConfig сирий обʼєкт конфігу
   * @returns {Promise<Record<string, unknown>>} нормалізований конфіг
   */
  async function normalizeConfigWithAutoRules(parsedConfig) {
    const currentRules = parsedConfig.rules
    if (!Array.isArray(currentRules)) {
      throw new TypeError(`У ${CONFIG_FILE} поле "rules" має бути масивом рядків`)
    }
    if ('skills' in parsedConfig && !Array.isArray(parsedConfig.skills)) {
      throw new Error(`У ${CONFIG_FILE} поле "skills" має бути масивом рядків`)
    }
    const { ignore } = parsedConfig
    if (ignore !== undefined && (!Array.isArray(ignore) || ignore.some(p => typeof p !== 'string'))) {
      throw new Error(`У ${CONFIG_FILE} поле "ignore" має бути масивом рядків (шляхів до директорій)`)
    }

    const rootPkg = await readRootPackageJsonSafe()
    const disableRules = normalizeIdList(parsedConfig['disable-rules'])
    const disableSkills = normalizeIdList(parsedConfig['disable-skills'])
    const autoDetectedRules = await detectAutoRules({
      root: cwd(),
      availableRules,
      packageJsonParsed: rootPkg,
      disableRules
    })
    // Skills залежать від ефективного списку правил, який буде у конфізі після merge:
    // вже існуючі (опт-ін вручну) + auto-detected, мінус `disable-rules`. Без цього
    // правило, додане вручну (напр. `adr` без auto.md-умови), не активувало б залежні
    // скіли (`adr-normalize`).
    const disableRulesSet = new Set(disableRules)
    const effectiveRulesForSkills = [
      ...new Set([...normalizeIdList(parsedConfig.rules), ...autoDetectedRules.rules])
    ].filter(id => !disableRulesSet.has(id))
    const autoDetectedSkills = detectAutoSkills({
      availableSkills,
      detectedRules: effectiveRulesForSkills,
      disableSkills
    })

    const merged = mergeConfigWithAutoDetected({
      config: parsedConfig,
      detectedRules: autoDetectedRules.rules,
      detectedSkills: autoDetectedSkills.skills
    })

    const rest = Object.fromEntries(Object.entries(parsedConfig).filter(([k]) => k !== '$schema'))
    const normalized = {
      $schema: CONFIG_SCHEMA_URL,
      ...rest,
      rules: merged.rules,
      skills: merged.skills
    }
    if (merged['disable-rules']?.length) {
      normalized['disable-rules'] = merged['disable-rules']
    }
    if (merged['disable-skills']?.length) {
      normalized['disable-skills'] = merged['disable-skills']
    }
    return sortConfigIdArrays(normalized)
  }

  if (!existsSync(configPath)) {
    const rootPkg = await readRootPackageJsonSafe()
    const autoDetectedRules = await detectAutoRules({
      root: cwd(),
      availableRules,
      packageJsonParsed: rootPkg
    })
    const autoDetectedSkills = detectAutoSkills({
      availableSkills,
      detectedRules: autoDetectedRules.rules
    })
    const defaultConfig = sortConfigIdArrays({
      $schema: CONFIG_SCHEMA_URL,
      rules: autoDetectedRules.rules,
      skills: autoDetectedSkills.skills
    })
    await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8')
    console.log(
      `📝 Створено ${CONFIG_FILE} з автоаналізом правил (${defaultConfig.rules.length}) і skills (${defaultConfig.skills.length}).\n`
    )
    return defaultConfig
  }
  const raw = await readFile(configPath, 'utf8')
  /** @type {Record<string, unknown>} */
  let config
  try {
    config = JSON.parse(raw)
  } catch {
    throw new Error(`Невірний JSON у файлі ${CONFIG_FILE}`)
  }
  logRuleMigrationsIfAny(config)
  const normalized = await normalizeConfigWithAutoRules(config)
  if (JSON.stringify(normalized) !== JSON.stringify(config)) {
    await writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    console.log(`📝 Оновлено ${CONFIG_FILE}: синхронізовано $schema та авто-додані rules/skills\n`)
  }
  return normalized
}

/**
 * Якщо у `rules` чи `disable-rules` є застарілі rule-id з `RULE_MIGRATIONS`,
 * виводить пояснювальний лог про автоматичну заміну (саму заміну виконує
 * `migrateRuleIds` у `mergeConfigWithAutoDetected` — тут лише користувацька комунікація).
 * @param {Record<string, unknown>} parsedConfig сирий обʼєкт `.n-cursor.json` після `JSON.parse`
 * @returns {void}
 */
function logRuleMigrationsIfAny(parsedConfig) {
  /** @type {Set<string>} */
  const seen = new Set()
  for (const key of /** @type {const} */ (['rules', 'disable-rules'])) {
    const list = parsedConfig[key]
    if (!Array.isArray(list)) continue
    const legacy = detectLegacyRuleIds(normalizeIdList(list))
    for (const id of legacy) seen.add(id)
  }
  if (seen.size === 0) return
  console.log(`📦 Авто-міграція ${CONFIG_FILE}:`)
  for (const id of seen) {
    const replacement = RULE_MIGRATIONS[id].join(', ')
    console.log(`   • ${id} → ${replacement}`)
  }
  console.log('')
}

/**
 * Витягує чистий id правила без шляху і без .mdc.
 * "npm/rules/text/text.mdc" → "text"
 * "text.mdc"                → "text"
 * "text"                    → "text"
 * @param {string} ruleName шлях або базове ім'я, з суфіксом .mdc або без
 * @returns {string} id правила (без .mdc, без шляху)
 */
function normalizeRuleName(ruleName) {
  const name = basename(String(ruleName).trim())
  return name.endsWith('.mdc') ? name.slice(0, -'.mdc'.length) : name
}

/**
 * Читає вміст правила з каталогу `rules/<id>/<id>.mdc` установленого пакету
 * (наприклад `node_modules/@nitra/cursor/rules/<id>/<id>.mdc` або кеш npx).
 * @param {string} rule елемент масиву rules з `.n-cursor.json`
 * @param {string} [bundledRulesDir] каталог `rules/` у корені пакету-джерела
 * @returns {Promise<string>} текст правила для запису в `.cursor/rules/n-*.mdc`
 */
async function readBundledRuleContent(rule, bundledRulesDir = BUNDLED_RULES_DIR) {
  const id = normalizeRuleName(rule)
  const bundledPath = join(bundledRulesDir, id, `${id}.mdc`)
  if (!existsSync(bundledPath)) {
    throw new Error(
      `Немає файлу ${id}/${id}.mdc у ${bundledRulesDir}. Оновіть ${PACKAGE_NAME} або приберіть "${rule}" з rules у ${CONFIG_FILE}.`
    )
  }
  const text = await readFile(bundledPath, 'utf8')
  return inlineTemplateLinks(text, dirname(bundledPath))
}

/**
 * Нормалізує id skill з конфігу до форми без префікса n- (як «fix»)
 * @param {string} skillName елемент масиву skills або ім'я каталогу
 * @returns {string} id без префікса n-
 */
function normalizeSkillId(skillName) {
  let s = basename(String(skillName).trim())
  if (s.startsWith(RULE_PREFIX)) {
    s = s.slice(RULE_PREFIX.length)
  }
  return s
}

/**
 * Ім'я керованого каталогу skill у .cursor/skills (префікс n-)
 * @param {string} skillId id без префікса (або з префіксом n- у конфігу — нормалізується)
 * @returns {string} наприклад n-fix
 */
function managedSkillDirName(skillId) {
  return `${RULE_PREFIX}${normalizeSkillId(skillId)}`
}

/**
 * Витягує текст description з YAML frontmatter SKILL.md (формат description: >-)
 * @param {string} text повний вміст SKILL.md
 * @returns {string | null} один рядок опису або null
 */
function extractSkillDescription(text) {
  const fm = text.match(YAML_FRONTMATTER_RE)
  if (!fm) {
    return null
  }
  const lines = fm[1].split(NEWLINE_RE)
  const start = lines.findIndex(line => line.trim() === 'description: >-')
  if (start === -1) {
    return null
  }
  const descLines = []
  for (const line of lines.slice(start + 1)) {
    if (!LEADING_SPACES_RE.test(line)) {
      break
    }
    descLines.push(line.replace(LEADING_SPACES_RE, '').trimEnd())
  }
  if (descLines.length === 0) {
    return null
  }
  return descLines.join(' ').trim()
}

/**
 * Підготовка опису skill для вставки в звичайний markdown (заголовок H1, bullet без code fence).
 * Послідовність `<id>` сприймається markdownlint (MD033) як inline HTML — замінюємо на `{id}`.
 * @param {string} desc один рядок з YAML frontmatter SKILL.md
 * @returns {string} той самий рядок після заміни літералу з кутовими дужками навколо id на плейсхолдер у фігурних дужках (MD033).
 */
function skillDescriptionSafeForMarkdownInline(desc) {
  return desc.replaceAll('<id>', '{id}')
}

/**
 * YAML frontmatter для `.claude/commands/*.md`: поле `description` потрібне розширенню VSCode,
 * щоб команди з’являлись у списку. Текст збігається з полем `description` у frontmatter `SKILL.md`.
 * @param {string} descriptionRaw значення з `extractSkillDescription` (може бути порожнім)
 * @returns {string} блок `---` … `---` і порожній рядок після
 */
function formatClaudeCommandFrontmatter(descriptionRaw) {
  let text = skillDescriptionSafeForMarkdownInline(String(descriptionRaw || '').trim())
  if (!text) {
    text = 'Див. SKILL.md у каталозі скілу в .cursor/skills.'
  }
  return `---\ndescription: >-\n  ${text}\n---\n\n`
}

/**
 * YAML frontmatter для `.pi/skills/<dir>/SKILL.md` згідно зі специфікацією pi.dev:
 * обов'язкові поля `name` (1-64, `[a-z0-9-]`) і `description` (≤ 1024). Текст description збігається
 * з полем `description` у frontmatter джерельного `SKILL.md`.
 * @param {string} skillName ім'я скілу (наприклад `n-fix`); має бути валідним pi-name
 * @param {string} descriptionRaw значення з `extractSkillDescription` (може бути порожнім)
 * @returns {string} блок `---` … `---` і порожній рядок після
 */
function formatPiSkillFrontmatter(skillName, descriptionRaw) {
  let text = skillDescriptionSafeForMarkdownInline(String(descriptionRaw || '').trim())
  if (!text) {
    text = 'Див. SKILL.md у каталозі скілу в .cursor/skills.'
  }
  return `---\nname: ${skillName}\ndescription: >-\n  ${text}\n---\n\n`
}

/**
 * Повертає відсортовані імена *.mdc у .cursor/rules поточного проєкту
 * @returns {Promise<string[]>} базові імена файлів (лише .mdc)
 */
async function listProjectRulesMdcFiles() {
  const rulesDir = join(cwd(), RULES_DIR)
  if (!existsSync(rulesDir)) {
    return []
  }
  const names = await readdir(rulesDir)
  return names.filter(n => n.endsWith('.mdc')).toSorted((a, b) => a.localeCompare(b))
}

/**
 * Базові імена файлів .mdc, які очікуються згідно з .n-cursor.json (префікс n-).
 * @param {string[]} configRules елементи масиву rules з конфігу
 * @returns {Set<string>} множина очікуваних імен файлів (наприклад n-bun.mdc)
 */
function expectedManagedRuleBasenames(configRules) {
  return new Set(configRules.map(rule => `${RULE_PREFIX}${normalizeRuleName(rule)}.mdc`))
}

/**
 * Видаляє з каталогу правил файли *.mdc з префіксом n-, яких немає у конфігурації.
 * Файли без префікса n- не змінює.
 * @param {string} rulesDir абсолютний шлях до .cursor/rules
 * @param {string[]} configRules елементи масиву rules з .n-cursor.json
 * @returns {Promise<string[]>} відсортовані імена видалених файлів
 */
async function removeOrphanManagedRuleFiles(rulesDir, configRules) {
  if (!existsSync(rulesDir)) {
    return []
  }
  const expected = expectedManagedRuleBasenames(configRules)
  const names = await readdir(rulesDir)
  const removed = []
  for (const name of names) {
    if (name.endsWith('.mdc') && name.startsWith(RULE_PREFIX) && !expected.has(name)) {
      await unlink(join(rulesDir, name))
      removed.push(name)
    }
  }
  return removed.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Повертає відсортований список директорій skills у `.cursor/skills`.
 * Директорія вважається skill-каталогом, якщо це підкаталог (без префікса `.`).
 * @returns {Promise<string[]>} імена директорій (наприклад `n-fix`, `custom-skill`)
 */
async function listProjectSkillDirNames() {
  const skillsRoot = join(cwd(), SKILLS_DIR)
  if (!existsSync(skillsRoot)) {
    return []
  }
  const entries = await readdir(skillsRoot, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .toSorted((a, b) => a.localeCompare(b))
}

/**
 * Формує markdown-рядки для секції Skills у AGENTS.md з усіх skill-директорій на диску.
 * @returns {Promise<{ name: string }[]>} елементи з полем name для Mustache-секції skills
 */
async function buildSkillBulletItems() {
  const skillsRoot = join(cwd(), SKILLS_DIR)
  const skillDirNames = await listProjectSkillDirNames()
  const items = []
  for (const dirName of skillDirNames) {
    const skillMdPath = join(skillsRoot, dirName, 'SKILL.md')
    let desc = ''
    if (existsSync(skillMdPath)) {
      const text = await readFile(skillMdPath, 'utf8')
      const parsed = extractSkillDescription(text)
      if (parsed) {
        desc = skillDescriptionSafeForMarkdownInline(parsed)
      }
    }
    const pathLine = `- \`${SKILLS_DIR}/${dirName}/SKILL.md\``
    const line = desc ? `${pathLine} — ${desc}` : pathLine
    items.push({ name: line })
  }
  return items
}

/**
 * Видаляє каталоги n-* у .cursor/skills, яких немає у конфігурації skills
 * @param {string} skillsRoot абсолютний шлях до .cursor/skills
 * @param {string[]} configSkills елементи масиву skills з .n-cursor.json
 * @returns {Promise<string[]>} імена видалених каталогів
 */
async function removeOrphanManagedSkillDirs(skillsRoot, configSkills) {
  if (!existsSync(skillsRoot)) {
    return []
  }
  const expected = new Set(configSkills.map(s => managedSkillDirName(s)))
  const entries = await readdir(skillsRoot, { withFileTypes: true })
  const removed = []
  for (const e of entries) {
    const isManagedDir = e.isDirectory() && e.name.startsWith(RULE_PREFIX)
    const isOrphan = isManagedDir && !expected.has(e.name)
    if (isOrphan) {
      await rm(join(skillsRoot, e.name), { recursive: true, force: true })
      removed.push(e.name)
    }
  }
  return removed.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Рендерить коротку секцію для CLAUDE.md: не розпаралелювати лінт (ESLint) між shells/субагентами.
 * @returns {string[]} рядки для вставки (з порожнім рядком на початку)
 */
function buildClaudeLintParallelismSectionLines() {
  return [
    '',
    '## Лінт і ESLint (без паралельних запусків)',
    '',
    'Щоб не запускати **кілька** одночасних **`eslint`** (і не перевантажувати диск/CPU), **заборонено** стартувати `bun run lint` / `lint-js` / `eslint` **паралельно** в різних Bash-задачах, **фонових** shells чи **субагентах** (Task тощо). Має бути **один** послідовний прогон на сесію; команда **`/n-lint`** — **не** ділити на паралельні підзадачі. Деталі: `.cursor/skills/n-lint/SKILL.md`.',
    ''
  ]
}

/**
 * Рендерить секцію Skills для CLAUDE.md з урахуванням наявних slash-команд.
 * @returns {Promise<string[]>} готові рядки секції (або порожній масив)
 */
async function buildClaudeSkillsSectionLines() {
  const skillDirNames = await listProjectSkillDirNames()
  if (skillDirNames.length === 0) {
    return []
  }

  const lines = ['', '## Skills', '']
  const skillsRoot = join(cwd(), SKILLS_DIR)
  const commandsRoot = join(cwd(), COMMANDS_DIR)
  for (const dirName of skillDirNames) {
    const skillMdPath = join(skillsRoot, dirName, 'SKILL.md')
    const commandPath = join(commandsRoot, `${dirName}.md`)
    let desc = ''
    if (existsSync(skillMdPath)) {
      const text = await readFile(skillMdPath, 'utf8')
      const parsed = extractSkillDescription(text)
      if (parsed) {
        desc = skillDescriptionSafeForMarkdownInline(parsed)
      }
    }
    const ref = `- \`${SKILLS_DIR}/${dirName}/SKILL.md\``
    lines.push(desc ? `${ref} — ${desc}` : ref)
    if (existsSync(commandPath)) {
      lines.push(`  Команда: \`/${dirName}\``)
    }
  }
  return lines
}

/**
 * Генерує CLAUDE.md у корені cwd з at-імпортами всіх .mdc-правил та посиланнями на skills.
 * Завдяки цьому Claude Code автоматично завантажує вміст кожного правила при старті.
 * @returns {Promise<void>}
 */
/**
 * @param {string[]} [ignore] директорії заборонені для редагування
 */
async function syncClaudeMd(ignore) {
  const lines = [`<!-- Цей файл генерується автоматично через \`npx ${PACKAGE_NAME}\`. Не редагуй вручну. -->`, '']

  if (Array.isArray(ignore) && ignore.length > 0) {
    lines.push('## Захищені директорії', '', 'Ніколи не змінюй, не видаляй і не створюй файли у цих директоріях:')
    for (const dir of ignore) {
      let d = dir
      while (d.endsWith('/')) d = d.slice(0, -1)
      lines.push(`- \`${d}/\``)
    }
    lines.push('')
  }

  const mdcFiles = await listProjectRulesMdcFiles()
  for (const mdcFile of mdcFiles) {
    lines.push(`@${RULES_DIR}/${mdcFile}`)
  }

  lines.push(...buildClaudeLintParallelismSectionLines())

  const skillsSectionLines = await buildClaudeSkillsSectionLines()
  lines.push(...skillsSectionLines)
  const claudeMdPath = join(cwd(), 'CLAUDE.md')
  const hadFile = existsSync(claudeMdPath)
  await writeFile(claudeMdPath, formatGeneratedMarkdownLines(lines), 'utf8')
  console.log(hadFile ? `📝 Оновлено CLAUDE.md` : `📝 Створено CLAUDE.md`)
}

/**
 * Повністю перезаписує AGENTS.md у корені cwd з npm/AGENTS.template.md
 * @param {string} [agentsTemplatePath] шлях до AGENTS.template.md у корені пакету-джерела
 * @returns {Promise<void>} завершення запису файлу
 */
async function syncAgentsMd(agentsTemplatePath = BUNDLED_AGENTS_TEMPLATE_PATH) {
  if (!existsSync(agentsTemplatePath)) {
    throw new Error(
      `Не знайдено шаблон ${AGENTS_TEMPLATE_FILE} у пакеті.\n` +
        `Очікуваний шлях: ${agentsTemplatePath}\n` +
        `Перевстановіть ${PACKAGE_NAME}.`
    )
  }
  const templateText = await readFile(agentsTemplatePath, 'utf8')
  const mdcFiles = await listProjectRulesMdcFiles()
  const skillItems = await buildSkillBulletItems()
  const commandItems = await buildAgentsCommandBulletItems(cwd())
  const body = renderAgentsTemplate(templateText, mdcFiles, skillItems, commandItems)
  const agentsPath = join(cwd(), AGENTS_FILE)
  const hadFile = existsSync(agentsPath)
  await writeFile(agentsPath, body.endsWith('\n') ? body : `${body}\n`, 'utf8')
  console.log(
    hadFile
      ? `📝 Оновлено ${AGENTS_FILE} з ${AGENTS_TEMPLATE_FILE}`
      : `📝 Створено ${AGENTS_FILE} з ${AGENTS_TEMPLATE_FILE}`
  )
}

/**
 * Копіює лише skills зі списку configSkills (джерело: skills/<id>/ у пакеті)
 * @param {string[]} configSkills id без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету-джерела
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих копіювань
 */
async function syncSkills(configSkills, bundledSkillsDir = BUNDLED_SKILLS_DIR) {
  if (configSkills.length === 0 || !existsSync(bundledSkillsDir)) {
    return { success: 0, fail: 0 }
  }

  const skillsRoot = join(cwd(), SKILLS_DIR)
  await mkdir(skillsRoot, { recursive: true })

  let success = 0
  let fail = 0

  for (const skillId of configSkills) {
    const id = normalizeSkillId(skillId)
    const srcDir = join(bundledSkillsDir, id)
    const destDirName = managedSkillDirName(skillId)
    const destDir = join(skillsRoot, destDirName)

    if (existsSync(srcDir)) {
      process.stdout.write(`  ⬇  ${id} → ${SKILLS_DIR}/${destDirName} ... `)
      try {
        await mkdir(destDir, { recursive: true })
        const files = await readdir(srcDir)
        for (const file of files) {
          if (file === 'auto.md') continue
          const content = await readFile(join(srcDir, file), 'utf8')
          await writeFile(join(destDir, file), content, 'utf8')
        }
        console.log(`✅`)
        success++
      } catch (error) {
        console.log(`❌`)
        console.error(`     Помилка: ${error.message}`)
        fail++
      }
    } else {
      process.stdout.write(`  ⬇  ${id} → ${SKILLS_DIR}/${destDirName} ... `)
      console.log(`❌`)
      console.error(`     Немає каталогу в пакеті: skills/${id}`)
      fail++
    }
  }
  return { success, fail }
}

/**
 * Синхронізує .claude/commands/n-<id>.md зі skills пакету.
 * У кожному файлі обов’язково YAML frontmatter з `description` (як у `SKILL.md`), інакше команди
 * не з’являються у розширенні VSCode; далі — заголовок H1 лише з імені команди (без повтору опису) і посилання на `.cursor/skills/…/SKILL.md`.
 * @param {string[]} configSkills id без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету-джерела
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
async function syncCommands(configSkills, bundledSkillsDir = BUNDLED_SKILLS_DIR) {
  if (configSkills.length === 0 || !existsSync(bundledSkillsDir)) {
    return { success: 0, fail: 0 }
  }

  const commandsDir = join(cwd(), COMMANDS_DIR)
  await mkdir(commandsDir, { recursive: true })

  let success = 0
  let fail = 0

  for (const skillId of configSkills) {
    const id = normalizeSkillId(skillId)
    const srcSkillMd = join(bundledSkillsDir, id, 'SKILL.md')
    const destDirName = managedSkillDirName(skillId)
    const destFile = join(commandsDir, `${RULE_PREFIX}${id}.md`)

    process.stdout.write(`  ⬇  ${id} → ${COMMANDS_DIR}/${RULE_PREFIX}${id}.md ... `)
    if (existsSync(srcSkillMd)) {
      try {
        const raw = await readFile(srcSkillMd, 'utf8')
        const descRaw = extractSkillDescription(raw)
        const frontmatter = formatClaudeCommandFrontmatter(descRaw || '')
        const header = `# ${RULE_PREFIX}${id}\n\n`
        const body = `${frontmatter}${header}Виконай інструкції зі скілу \`.cursor/skills/${destDirName}/SKILL.md\`.\n`
        await writeFile(destFile, body, 'utf8')
        console.log(`✅`)
        success++
      } catch (error) {
        console.log(`❌`)
        console.error(`     Помилка: ${error.message}`)
        fail++
      }
    } else {
      console.log(`❌`)
      console.error(`     Немає SKILL.md у пакеті: skills/${id}`)
      fail++
    }
  }
  return { success, fail }
}

/**
 * Видаляє файли n-*.md у .claude/commands, яких немає у конфігурації skills
 * @param {string} commandsDir абсолютний шлях до .claude/commands
 * @param {string[]} configSkills id без префікса n-
 * @returns {Promise<string[]>} імена видалених файлів
 */
async function removeOrphanManagedCommandFiles(commandsDir, configSkills) {
  if (!existsSync(commandsDir)) {
    return []
  }
  const expected = new Set(configSkills.map(s => `${RULE_PREFIX}${normalizeSkillId(s)}.md`))
  const names = await readdir(commandsDir)
  const removed = []
  for (const name of names) {
    if (name.endsWith('.md') && name.startsWith(RULE_PREFIX) && !expected.has(name)) {
      await unlink(join(commandsDir, name))
      removed.push(name)
    }
  }
  return removed.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Синхронізує .claude/commands/{dirName}.md для всіх локальних скілів з .cursor/skills/
 * що не керуються пакетом (відсутні в configSkills). Frontmatter `description` — як у відповідному SKILL.md.
 * @param {string[]} configSkills id керованих skills (вже оброблені syncCommands)
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
async function syncLocalOnlySkillCommands(configSkills) {
  const skillsRoot = join(cwd(), SKILLS_DIR)
  if (!existsSync(skillsRoot)) return { success: 0, fail: 0 }

  const commandsDir = join(cwd(), COMMANDS_DIR)
  await mkdir(commandsDir, { recursive: true })

  const managedDirNames = new Set(configSkills.map(s => managedSkillDirName(s)))
  const allDirNames = await listProjectSkillDirNames()
  const localOnly = allDirNames.filter(d => !managedDirNames.has(d))

  let success = 0
  let fail = 0

  for (const dirName of localOnly) {
    const skillMdPath = join(skillsRoot, dirName, 'SKILL.md')
    const destFile = join(commandsDir, `${dirName}.md`)

    process.stdout.write(`  ⬇  ${dirName} → ${COMMANDS_DIR}/${dirName}.md ... `)
    try {
      let descRaw = ''
      if (existsSync(skillMdPath)) {
        const raw = await readFile(skillMdPath, 'utf8')
        const parsed = extractSkillDescription(raw)
        if (parsed) descRaw = parsed
      }
      const frontmatter = formatClaudeCommandFrontmatter(descRaw)
      const header = `# ${dirName}\n\n`
      const body = `${frontmatter}${header}Виконай інструкції зі скілу \`${SKILLS_DIR}/${dirName}/SKILL.md\`.\n`
      await writeFile(destFile, body, 'utf8')
      console.log(`✅`)
      success++
    } catch (error) {
      console.log(`❌`)
      console.error(`     Помилка: ${errorMessage(error)}`)
      fail++
    }
  }
  return { success, fail }
}

/**
 * Видаляє .claude/commands/{dirName}.md файли локальних скілів, яких більше немає в .cursor/skills/
 * @param {string} commandsDir абсолютний шлях до .claude/commands
 * @param {string[]} configSkills id керованих skills
 * @returns {Promise<string[]>} імена видалених файлів
 */
async function removeOrphanLocalSkillCommandFiles(commandsDir, configSkills) {
  if (!existsSync(commandsDir)) return []

  const managedDirNames = new Set(configSkills.map(s => managedSkillDirName(s)))
  const allDirNames = new Set(await listProjectSkillDirNames())
  const names = await readdir(commandsDir)
  const removed = []

  for (const name of names.filter(n => n.endsWith('.md') && !n.startsWith(RULE_PREFIX))) {
    const dirName = name.slice(0, -3)
    if (!managedDirNames.has(dirName) && !allDirNames.has(dirName)) {
      await unlink(join(commandsDir, name))
      removed.push(name)
    }
  }
  return removed.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Синхронізує .pi/skills/n-<id>/SKILL.md зі skills пакету для pi.dev-сумісності.
 * Pi-skill — це директорія з SKILL.md (frontmatter `name`+`description`), тіло-делегат на джерельний
 * `.cursor/skills/<dir>/SKILL.md`. Симетрично до `syncCommands`, але дир замість `.md`-файлу.
 * @param {string[]} configSkills id без префікса n-
 * @param {string} [bundledSkillsDir] каталог `skills/` у корені пакету-джерела
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
async function syncPiSkills(configSkills, bundledSkillsDir = BUNDLED_SKILLS_DIR) {
  if (configSkills.length === 0 || !existsSync(bundledSkillsDir)) {
    return { success: 0, fail: 0 }
  }

  const piSkillsRoot = join(cwd(), PI_SKILLS_DIR)
  await mkdir(piSkillsRoot, { recursive: true })

  let success = 0
  let fail = 0

  for (const skillId of configSkills) {
    const id = normalizeSkillId(skillId)
    const srcSkillMd = join(bundledSkillsDir, id, 'SKILL.md')
    const destDirName = managedSkillDirName(skillId)
    const destDir = join(piSkillsRoot, destDirName)
    const destFile = join(destDir, 'SKILL.md')

    process.stdout.write(`  ⬇  ${id} → ${PI_SKILLS_DIR}/${destDirName}/SKILL.md ... `)
    if (existsSync(srcSkillMd)) {
      try {
        const raw = await readFile(srcSkillMd, 'utf8')
        const descRaw = extractSkillDescription(raw)
        await mkdir(destDir, { recursive: true })
        const frontmatter = formatPiSkillFrontmatter(destDirName, descRaw || '')
        const header = `# ${destDirName}\n\n`
        const body = `${frontmatter}${header}Виконай інструкції зі скілу \`.cursor/skills/${destDirName}/SKILL.md\`.\n`
        await writeFile(destFile, body, 'utf8')
        console.log(`✅`)
        success++
      } catch (error) {
        console.log(`❌`)
        console.error(`     Помилка: ${errorMessage(error)}`)
        fail++
      }
    } else {
      console.log(`❌`)
      console.error(`     Немає SKILL.md у пакеті: skills/${id}`)
      fail++
    }
  }
  return { success, fail }
}

/**
 * Синхронізує .pi/skills/{dirName}/SKILL.md для всіх локальних скілів з .cursor/skills/
 * що не керуються пакетом. Симетрично до `syncLocalOnlySkillCommands`.
 * @param {string[]} configSkills id керованих skills (уже оброблені syncPiSkills)
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
async function syncLocalOnlyPiSkills(configSkills) {
  const skillsRoot = join(cwd(), SKILLS_DIR)
  if (!existsSync(skillsRoot)) return { success: 0, fail: 0 }

  const piSkillsRoot = join(cwd(), PI_SKILLS_DIR)
  await mkdir(piSkillsRoot, { recursive: true })

  const managedDirNames = new Set(configSkills.map(s => managedSkillDirName(s)))
  const allDirNames = await listProjectSkillDirNames()
  const localOnly = allDirNames.filter(d => !managedDirNames.has(d))

  let success = 0
  let fail = 0

  for (const dirName of localOnly) {
    const skillMdPath = join(skillsRoot, dirName, 'SKILL.md')
    const destDir = join(piSkillsRoot, dirName)
    const destFile = join(destDir, 'SKILL.md')

    process.stdout.write(`  ⬇  ${dirName} → ${PI_SKILLS_DIR}/${dirName}/SKILL.md ... `)
    try {
      let descRaw = ''
      if (existsSync(skillMdPath)) {
        const raw = await readFile(skillMdPath, 'utf8')
        const parsed = extractSkillDescription(raw)
        if (parsed) descRaw = parsed
      }
      await mkdir(destDir, { recursive: true })
      const frontmatter = formatPiSkillFrontmatter(dirName, descRaw)
      const header = `# ${dirName}\n\n`
      const body = `${frontmatter}${header}Виконай інструкції зі скілу \`${SKILLS_DIR}/${dirName}/SKILL.md\`.\n`
      await writeFile(destFile, body, 'utf8')
      console.log(`✅`)
      success++
    } catch (error) {
      console.log(`❌`)
      console.error(`     Помилка: ${errorMessage(error)}`)
      fail++
    }
  }
  return { success, fail }
}

/**
 * Видаляє n-* директорії у .pi/skills, яких немає у конфігурації skills.
 * @param {string} piSkillsDir абсолютний шлях до .pi/skills
 * @param {string[]} configSkills id без префікса n-
 * @returns {Promise<string[]>} імена видалених директорій
 */
async function removeOrphanManagedPiSkillDirs(piSkillsDir, configSkills) {
  if (!existsSync(piSkillsDir)) return []
  const expected = new Set(configSkills.map(s => managedSkillDirName(s)))
  const entries = await readdir(piSkillsDir, { withFileTypes: true })
  const removed = []
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(RULE_PREFIX) && !expected.has(entry.name)) {
      await rm(join(piSkillsDir, entry.name), { recursive: true, force: true })
      removed.push(entry.name)
    }
  }
  return removed.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Видаляє .pi/skills/{dirName} директорії локальних скілів, яких більше немає в .cursor/skills/.
 * @param {string} piSkillsDir абсолютний шлях до .pi/skills
 * @param {string[]} configSkills id керованих skills
 * @returns {Promise<string[]>} імена видалених директорій
 */
async function removeOrphanLocalPiSkillDirs(piSkillsDir, configSkills) {
  if (!existsSync(piSkillsDir)) return []
  const managedDirNames = new Set(configSkills.map(s => managedSkillDirName(s)))
  const allDirNames = new Set(await listProjectSkillDirNames())
  const entries = await readdir(piSkillsDir, { withFileTypes: true })
  const removed = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(RULE_PREFIX)) continue
    if (!managedDirNames.has(entry.name) && !allDirNames.has(entry.name)) {
      await rm(join(piSkillsDir, entry.name), { recursive: true, force: true })
      removed.push(entry.name)
    }
  }
  return removed.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Людинозрозумілий текст винятку для логів.
 * @param {unknown} error виняток із catch
 * @returns {string} текст повідомлення
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Виконує крок синхронізації з уніфікованим логуванням помилки.
 * @template T
 * @param {string} prefix префікс повідомлення про помилку
 * @param {() => Promise<T>} action операція
 * @returns {Promise<T>} результат операції
 */
async function runSyncStep(prefix, action) {
  try {
    return await action()
  } catch (error) {
    console.error(`${prefix}${errorMessage(error)}`)
    throw error
  }
}

/**
 * Копіює керовані `.mdc` файли з пакету до `.cursor/rules`.
 * @param {string[]} rules список rules з конфігу
 * @param {string} bundledRulesDir каталог `rules` пакету-джерела
 * @param {string} rulesDir абсолютний шлях до `.cursor/rules`
 * @returns {Promise<{ successCount: number, failCount: number }>} статистика копіювання
 */
async function syncManagedRuleFiles(rules, bundledRulesDir, rulesDir) {
  let successCount = 0
  let failCount = 0
  for (const rule of rules) {
    const fileName = `${RULE_PREFIX}${normalizeRuleName(rule)}.mdc`
    const destPath = join(rulesDir, fileName)
    try {
      process.stdout.write(`  ⬇  ${rule} → ${RULES_DIR}/${fileName} ... `)
      const content = await readBundledRuleContent(rule, bundledRulesDir)
      await writeFile(destPath, content, 'utf8')
      console.log(`✅`)
      successCount++
    } catch (error) {
      console.log(`❌`)
      console.error(`     Помилка: ${errorMessage(error)}`)
      failCount++
    }
  }
  return { successCount, failCount }
}

/**
 * Логує видалені керовані правила/skills/commands у єдиному форматі.
 * @param {string} title назва сутностей
 * @param {string} basePath базовий шлях для виводу
 * @param {string[]} names перелік елементів
 * @returns {void}
 */
function logRemovedManagedItems(title, basePath, names) {
  if (names.length === 0) {
    return
  }
  console.log(`\n🧹 Видалено ${title} поза списком ${CONFIG_FILE} (${names.length}):`)
  for (const name of names) {
    console.log(`   − ${basePath}/${name}`)
  }
}

/**
 * Spawn-wrapper для `npx @nitra/cursor fix [<rule>...]`. Один шлях у коді: для кожного правила
 * робить `bun rules/<id>/fix.mjs` як окремий процес. Сам `fix.mjs` читає `.n-cursor.json`,
 * перевіряє whitelist (`runRuleCli`) і друкує per-rule summary.
 *
 * Без аргументів — discover з `.cursor/rules/*.mdc` у проекті-споживачі.
 *
 * Серіалізація паралельних запусків — per-rule, всередині `runStandardRule` (`withLock('fix-<id>')`).
 * На рівні `runFixCommand` локу нема: різні набори правил можуть прогресувати незалежно,
 * а однакові правила серіалізуються в spawn'ах нижче.
 * @param {string[]} requestedRules імена правил; порожній масив — discovery з `.cursor/rules/`
 * @returns {Promise<void>}
 */
async function runFixCommand(requestedRules) {
  const available = await listRuleIds(BUNDLED_RULES_DIR)
  if (available.length === 0) {
    console.error('❌ Не знайдено жодного правила у пакеті')
    throw new Error('No rules found')
  }

  let idsToRun
  if (requestedRules.length > 0) {
    const unknown = requestedRules.filter(id => !available.includes(id))
    if (unknown.length > 0) {
      console.error(`❌ Невідомі правила: ${unknown.join(', ')}`)
      console.log(`   Доступні: ${available.join(', ')}`)
      throw new Error(`Unknown rules: ${unknown.join(', ')}`)
    }
    idsToRun = requestedRules
  } else {
    const mdcFiles = await listProjectRulesMdcFiles()
    if (mdcFiles.length === 0) {
      throw new Error(
        `Немає файлів *.mdc у ${RULES_DIR}/. Запустіть \`npx ${PACKAGE_NAME}\` або вкажіть правила: \`npx ${PACKAGE_NAME} fix bun ga\``
      )
    }
    idsToRun = discoverCheckRulesFromCursorRules(available, mdcFiles)
    if (idsToRun.length === 0) {
      console.log(
        `\n🔍 ${PACKAGE_NAME} fix — у ${RULES_DIR}/ немає правил з programmatic перевіркою ` +
          `(відповідного fix.mjs у пакеті). Нічого не запущено.\n`
      )
      return
    }
  }

  let totalFailed = 0
  /** @type {{ id: string, ms: number, ok: boolean }[]} */
  const timings = []
  for (const id of idsToRun) {
    const fixPath = join(BUNDLED_RULES_DIR, id, 'fix.mjs')
    const startedAt = Date.now()
    const result = spawnSync('bun', [fixPath], { stdio: 'inherit' })
    const ok = result.status === 0
    timings.push({ id: `fix-${id}`, ms: Date.now() - startedAt, ok })
    if (!ok) totalFailed++
  }

  process.stdout.write(formatTimingSummary('Fix timing', timings))

  if (totalFailed > 0) {
    throw new Error(`${totalFailed} з ${idsToRun.length} правил мають проблеми`)
  }
}

/**
 * Читає поле `version` з `package.json` пакету за абсолютним шляхом до його кореня.
 * @param {string} packageRoot корінь пакету (тека з `package.json`)
 * @returns {Promise<string | null>} semver рядком або null, якщо файлу/поля немає або JSON некоректний
 */
async function readBundledVersionAt(packageRoot) {
  const p = join(packageRoot, 'package.json')
  if (!existsSync(p)) {
    return null
  }
  try {
    const pkg = JSON.parse(await readFile(p, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * Якщо `upgradeNitraCursorToLatestAndBunInstall` встановив у `node_modules/@nitra/cursor` версію,
 * відмінну від тієї, з якої стартував поточний процес (наприклад, з npx-кешу), запускає бінар нової
 * версії через `spawnSync` і завершує поточний процес із успадкованим exit-кодом. Re-exec потрібен,
 * бо ES-модулі вже завантажені у V8 (RULE_MIGRATIONS, detectAutoRules тощо) і нова логіка
 * без повної заміни процесу не підхопиться. Захист від нескінченного циклу — env `NITRA_CURSOR_REEXEC=1`.
 * @param {string} effectivePackageRoot шлях, повернутий `upgradeNitraCursorToLatestAndBunInstall`
 * @returns {Promise<void>} повертається лише якщо re-exec не потрібен; інакше кидає `ReexecHandoff`,
 *   який ловить top-level catch і прокидає exit-код у `process.exitCode`
 */
async function reexecIfPackageVersionChanged(effectivePackageRoot) {
  if (env.NITRA_CURSOR_REEXEC === '1') {
    return
  }
  if (effectivePackageRoot === BUNDLED_PACKAGE_ROOT) {
    return
  }
  const currentVersion = await readBundledVersionAt(BUNDLED_PACKAGE_ROOT)
  const installedVersion = await readBundledVersionAt(effectivePackageRoot)
  if (!currentVersion || !installedVersion || currentVersion === installedVersion) {
    return
  }
  const newBinPath = join(effectivePackageRoot, 'bin', 'n-cursor.js')
  if (!existsSync(newBinPath)) {
    return
  }
  console.log(
    `🔁 Перезапуск ${PACKAGE_NAME}: процес стартував на ${currentVersion}, ` +
      `після self-upgrade встановлено ${installedVersion}.\n` +
      `   Re-exec свіжого бінаря, щоб підхопити нову логіку (RULE_MIGRATIONS, auto-detect тощо).\n`
  )
  const result = spawnSync(process.execPath, [newBinPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...env, NITRA_CURSOR_REEXEC: '1' }
  })
  if (result.error) {
    throw result.error
  }
  throw new ReexecHandoff(typeof result.status === 'number' ? result.status : 1)
}

/**
 * Сентинельна помилка, яку кидає `reexecIfPackageVersionChanged` після успішного re-exec.
 * Top-level catch розпізнає її й виставляє `process.exitCode = code` без stack-trace —
 * процес тоді коректно завершується з тим самим кодом, що й child re-exec-у.
 */
class ReexecHandoff extends Error {
  /**
   * @param {number} code exit-код, який повернув child-процес
   */
  constructor(code) {
    super('reexec-handoff')
    this.name = 'ReexecHandoff'
    this.code = code
  }
}

/**
 * Копіює правила з каталогу `mdc/` установленого пакету та синхронізує `.cursor/rules`
 * @returns {Promise<void>}
 */
async function runSync() {
  console.log(`\n🔧 ${PACKAGE_NAME} — завантаження cursor-правил\n`)

  const projectRoot = cwd()
  const effectivePackageRoot = await runSyncStep(`❌ Не вдалося оновити ${PACKAGE_NAME} або виконати bun i: `, () =>
    upgradeNitraCursorToLatestAndBunInstall(projectRoot, BUNDLED_PACKAGE_ROOT)
  )

  await reexecIfPackageVersionChanged(effectivePackageRoot)

  const bundledRulesDir = join(effectivePackageRoot, 'rules')
  const bundledSkillsDir = join(effectivePackageRoot, 'skills')
  const bundledAgentsTemplatePath = join(effectivePackageRoot, AGENTS_TEMPLATE_FILE)

  const config = await runSyncStep('❌ ', () => readConfig({ bundledRulesDir, bundledSkillsDir }))

  const { rules, skills, version, ignore } = config
  const claudeConfigEnabled = config['claude-config'] !== false
  const bundledVer = await readBundledVersionAt(effectivePackageRoot)
  if (bundledVer) {
    const line =
      effectivePackageRoot === BUNDLED_PACKAGE_ROOT
        ? `📦 Джерело правил: ${PACKAGE_NAME}@${bundledVer}`
        : `📦 Джерело правил: ${PACKAGE_NAME}@${bundledVer} (шлях: ${effectivePackageRoot})`
    console.log(`${line}\n`)
  }
  if (version) {
    console.log(`⚠️  Поле "version" у ${CONFIG_FILE} ігнорується; правила беруться з установленого пакету.\n`)
  }
  console.log(`📋 Правил до завантаження: ${rules.length}`)
  console.log(`📋 Skills до синхронізації: ${skills.length}`)

  await runSyncStep('❌ Не вдалося записати setup-bun-deps action: ', async () => {
    const { destPath } = await syncSetupBunDepsAction(cwd(), effectivePackageRoot)
    console.log(`📝 Оновлено ${destPath} (composite setup-bun-deps з пакету)\n`)
  })

  const rulesDir = join(cwd(), RULES_DIR)
  await mkdir(rulesDir, { recursive: true })
  const { successCount, failCount } = await syncManagedRuleFiles(rules, bundledRulesDir, rulesDir)

  await runSyncStep(`❌ Не вдалося прибрати зайві файли в ${RULES_DIR}: `, async () => {
    const removed = await removeOrphanManagedRuleFiles(rulesDir, rules)
    logRemovedManagedItems('правила', RULES_DIR, removed)
  })

  await runSyncStep('❌ Skills: ', async () => {
    const { success: skillOk, fail: skillFail } = await syncSkills(skills, bundledSkillsDir)
    if (skills.length > 0) {
      console.log(`\n🧩 Skills: ${skillOk} скопійовано, ${skillFail} з помилками`)
    }
    const removedSkills = await removeOrphanManagedSkillDirs(join(cwd(), SKILLS_DIR), skills)
    logRemovedManagedItems('skills', SKILLS_DIR, removedSkills)
    if (skillFail > 0) {
      throw new Error(`Не вдалося скопіювати ${skillFail} з ${skills.length} skills`)
    }
  })

  await runSyncStep('❌ Commands: ', async () => {
    const { success: cmdOk, fail: cmdFail } = await syncCommands(skills, bundledSkillsDir)
    const { success: localOk, fail: localFail } = await syncLocalOnlySkillCommands(skills)
    const totalOk = cmdOk + localOk
    const totalFail = cmdFail + localFail
    if (totalOk + totalFail > 0) {
      console.log(`\n⌨️  Commands: ${totalOk} скопійовано, ${totalFail} з помилками`)
    }
    const commandsDir = join(cwd(), COMMANDS_DIR)
    const removedCmds = await removeOrphanManagedCommandFiles(commandsDir, skills)
    logRemovedManagedItems('commands', COMMANDS_DIR, removedCmds)
    const removedLocalCmds = await removeOrphanLocalSkillCommandFiles(commandsDir, skills)
    logRemovedManagedItems('commands (local)', COMMANDS_DIR, removedLocalCmds)
    if (totalFail > 0) {
      throw new Error(`Не вдалося скопіювати ${totalFail} commands`)
    }
  })

  await runSyncStep('❌ Pi skills: ', async () => {
    const { success: piOk, fail: piFail } = await syncPiSkills(skills, bundledSkillsDir)
    const { success: piLocalOk, fail: piLocalFail } = await syncLocalOnlyPiSkills(skills)
    const totalOk = piOk + piLocalOk
    const totalFail = piFail + piLocalFail
    if (totalOk + totalFail > 0) {
      console.log(`\n🥧 Pi skills: ${totalOk} скопійовано, ${totalFail} з помилками`)
    }
    const piSkillsDir = join(cwd(), PI_SKILLS_DIR)
    const removedPi = await removeOrphanManagedPiSkillDirs(piSkillsDir, skills)
    logRemovedManagedItems('pi skills', PI_SKILLS_DIR, removedPi)
    const removedLocalPi = await removeOrphanLocalPiSkillDirs(piSkillsDir, skills)
    logRemovedManagedItems('pi skills (local)', PI_SKILLS_DIR, removedLocalPi)
    if (totalFail > 0) {
      throw new Error(`Не вдалося скопіювати ${totalFail} pi skills`)
    }
  })

  await runSyncStep(`❌ Не вдалося оновити ${AGENTS_FILE}: `, () => syncAgentsMd(bundledAgentsTemplatePath))
  await runSyncStep('❌ Не вдалося оновити CLAUDE.md: ', () =>
    syncClaudeMd(/** @type {string[] | undefined} */ (ignore))
  )

  await runSyncStep('❌ Не вдалося синхронізувати Claude-конфіг: ', async () => {
    const result = await syncClaudeConfig({
      projectRoot: cwd(),
      bundledPackageRoot: effectivePackageRoot,
      enabled: claudeConfigEnabled,
      rules
    })
    if (!claudeConfigEnabled) {
      console.log('🤖 Claude-конфіг: пропущено (claude-config: false у .n-cursor.json)')
      return
    }
    const parts = []
    if (result.settings) parts.push('.claude/settings.json')
    if (result.cursorHooks) parts.push('.cursor/hooks.json')
    if (result.commands.length > 0) parts.push(`${result.commands.length} slash-commands`)
    if (result.adrHook) parts.push('.claude/hooks/capture-decisions.sh')
    if (result.adrNormalizeHook) parts.push('.claude/hooks/normalize-decisions.sh')
    if (result.adrHookLib?.length > 0) {
      for (const libPath of result.adrHookLib) {
        parts.push(libPath)
      }
    }
    if (result.gitignoreAdr) parts.push('.gitignore (adr fragment)')
    if (result.piExtension) parts.push('.pi/extensions/n-cursor-adr/')
    if (parts.length > 0) {
      console.log(`🤖 Claude-конфіг: ${parts.join(', ')}`)
    }
  })

  console.log(`\n✨ Готово: ${successCount} завантажено, ${failCount} з помилками\n`)
  if (failCount > 0) {
    throw new Error(`Не вдалося завантажити ${failCount} з ${rules.length} правил`)
  }
}

// CLI: маршрутизація команд
const [command, ...args] = process.argv.slice(2)

try {
  await ensureNitraCursorInRootDevDependencies(cwd())
  switch (command) {
    case 'fix': {
      await runFixCommand(args)

      break
    }
    case 'check': {
      // Backward-compatibility alias. Перейменовано на `fix` у 1.13.84 (узгоджено з ім'ям файла `rules/<id>/fix.mjs`).
      console.warn(
        `⚠️  Команда \`check\` deprecated — використовуйте \`fix\` (\`npx ${PACKAGE_NAME} fix [<rule>...]\`)`
      )
      await runFixCommand(args)

      break
    }
    case 'rename-yaml-extensions': {
      const code = await runRenameYamlExtensionsCli(args)
      if (code !== 0) {
        process.exitCode = 1
      }

      break
    }
    case 'post-tool-use-fix': {
      // Викликається з .claude/settings.json як PostToolUse hook Claude Code.
      // Маршрутизує змінений файл у релевантні правила і прокидає `fix` лише з ними.
      const code = await runPostToolUseFixCli()
      process.exitCode = code

      break
    }
    case 'lint': {
      // Оркестратор lint-ланцюжка з тайменгом на кожен крок (fail-fast).
      // Замінює раніше використовуваний агрегатор `bun run lint-ga && bun run lint-js && …` у root package.json.
      process.exitCode = runLintCli()

      break
    }
    case 'lint-ga': {
      // Канонічний lint-ga з preflight на shellcheck → actionlint → zizmor → check-ga (ga.mdc).
      // Останній крок (check-ga) async — тому await обов'язковий, інакше process.exitCode буде Promise.
      process.exitCode = await runLintGaCli()

      break
    }
    case 'lint-rego': {
      // Канонічний lint-rego: preflight opa/regal → opa check --strict → regal lint → conftest verify (опц.).
      process.exitCode = await runLintRego()

      break
    }
    case 'lint-k8s': {
      // Канонічний lint-k8s: kubeconform + kubescape по знайдених деревах `…/k8s/*.yaml`.
      process.exitCode = await runLintK8s()

      break
    }
    case 'lint-docker': {
      // Канонічний lint-docker: hadolint по Dockerfile та *.Dockerfile (docker.mdc).
      process.exitCode = await runLintDocker()

      break
    }
    case 'lint-text': {
      // Канонічний lint-text: cspell → run-shellcheck → markdownlint-cli2 --fix → run-v8r (text.mdc).
      process.exitCode = await runLintTextCli()

      break
    }
    case 'coverage': {
      // n-cursor coverage — оркестратор покриття + мутаційного тестування з discovery
      // провайдерів через .n-cursor.json#rules (test.mdc).
      const { runCoverageCli } = await import('../rules/test/coverage/coverage.mjs')
      process.exitCode = await runCoverageCli({ fix: args.includes('--fix') })

      break
    }
    case 'skill': {
      process.exitCode = runSkillsCli(args)

      break
    }
    case undefined:
    case '': {
      await runSync()

      break
    }
    default: {
      console.error(`❌ Невідома команда: ${command}`)
      console.error(
        `   Очікується: (без аргументів) синхронізація правил, check, rename-yaml-extensions, post-tool-use-fix, lint, lint-ga, lint-rego, lint-k8s, lint-docker, lint-text, coverage, skill`
      )
      process.exitCode = 1
    }
  }
} catch (error) {
  if (error instanceof ReexecHandoff) {
    process.exitCode = error.code
  } else if (error instanceof Error && error.message) {
    console.error(error.message)
    process.exitCode = 1
  } else {
    console.error(error)
    process.exitCode = 1
  }
}
