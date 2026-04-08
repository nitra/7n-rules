#!/usr/bin/env node

/**
 * n-cursor — CLI завантаження правил та перевірки проєкту
 *
 * Використання:
 *   `npx \@nitra/cursor`             — завантажити cursor-правила
 *   `npx \@nitra/cursor check`       — перевірити правила, перелічені в AGENTS.md (якщо є check-*.mjs);
 *                                     якщо в корені вже є `.n-cursor.json`, спочатку зчитується конфіг і за потреби дописується `$schema`
 *   `npx \@nitra/cursor check bun`   — перевірити лише вказані правила (ігнорує AGENTS.md)
 *
 * Якщо у корені репозиторію немає .n-cursor.json, спочатку перейменовується за наявності nitra-cursor.json;
 * у `.cursor/rules` файли `nitra-*.mdc` перейменовуються на `n-*.mdc`; інакше конфіг створюється автоматично
 * з усіма правилами з каталогу mdc пакету (їх можна відредагувати після створення). У файлі завжди має бути
 * поле `$schema` з посиланням на JSON Schema пакету (публічний URL для IDE); при зчитуванні конфігу воно додається або виправляється на диску, якщо відсутнє або некоректне.
 *
 * Файл AGENTS.md у корені: щоразу повністю перезаписується змістом з AGENTS.template.md
 * пакету; список правил у шаблоні будується з файлів *.mdc у .cursor/rules поточного проєкту.
 *
 * Після завантаження: у .cursor/rules видаляються файли *.mdc з префіксом «n-» (керовані
 * пакетом), яких немає у списку rules у .n-cursor.json. Інші .mdc у цій директорії залишаються.
 *
 * Composite GitHub Action `.github/actions/setup-bun-deps/action.yml` копіюється з каталогу
 * `github-actions/` пакету при кожному успішному синку (workflows з правил ga / js-lint / text).
 *
 * Skills копіюються з npm/skills пакету лише для id з масиву «skills» у .n-cursor.json
 * (у JSON — без префікса, як імена файлів у mdc/ без n-). У пакеті джерело — каталоги
 * skills/<id>/ (без префікса); у проєкті — .cursor/skills/n-<id>/ (префікс n-, як n-*.mdc).
 * Якщо ключа skills немає, за замовчуванням підтягуються всі підкаталоги skills/ (лише імена без префікса n-).
 * Зайві каталоги n-* у .cursor/skills, яких немає у списку, видаляються.
 *
 * Якщо в корені є package.json і в ньому ще немає \@nitra/cursor у devDependencies (і не оголошено
 * в dependencies), CLI дописує devDependencies з діапазоном ^<version> поточного пакету — зручно після npx.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  ensureNitraCursorInRootDevDependencies,
  readBundledPackageVersion
} from '../scripts/ensure-nitra-cursor-dev-dependencies.mjs'
import { syncSetupBunDepsAction } from '../scripts/sync-setup-bun-deps-action.mjs'

const PACKAGE_NAME = '@nitra/cursor'
const CONFIG_FILE = '.n-cursor.json'
/** Публічний URL JSON Schema для поля `$schema` у `.n-cursor.json` (IDE); вміст правил CLI читає лише з диска пакету */
const CONFIG_SCHEMA_URL = 'https://unpkg.com/@nitra/cursor/schemas/n-cursor.json'
const AGENTS_FILE = 'AGENTS.md'
const AGENTS_TEMPLATE_FILE = 'AGENTS.template.md'
const RULES_DIR = '.cursor/rules'
const SKILLS_DIR = '.cursor/skills'
const COMMANDS_DIR = '.claude/commands'
const RULE_PREFIX = 'n-'

const binDir = dirname(fileURLToPath(import.meta.url))
const BUNDLED_MDC_DIR = join(binDir, '..', 'mdc')
const BUNDLED_SCRIPTS_DIR = join(binDir, '..', 'scripts')
const BUNDLED_SKILLS_DIR = join(binDir, '..', 'skills')
const BUNDLED_AGENTS_TEMPLATE_PATH = join(binDir, '..', AGENTS_TEMPLATE_FILE)
/** Корінь установленого пакету (каталог з `mdc/`, `github-actions/`, …) */
const BUNDLED_PACKAGE_ROOT = join(binDir, '..')

/**
 * Імена правил (без .mdc) з каталогу mdc поточної інсталяції пакету
 * @returns {Promise<string[]>} відсортовані імена файлів правил без суфікса .mdc
 */
async function discoverBundledRuleNames() {
  if (!existsSync(BUNDLED_MDC_DIR)) {
    throw new Error(
      `Не знайдено каталог правил пакету.\n` +
        `Очікуваний шлях: ${BUNDLED_MDC_DIR}\n` +
        `Перевстановіть ${PACKAGE_NAME} або створіть ${CONFIG_FILE} вручну.`
    )
  }
  const names = await readdir(BUNDLED_MDC_DIR)
  const rules = names
    .filter(n => n.endsWith('.mdc'))
    .map(n => n.slice(0, -'.mdc'.length))
    .toSorted((a, b) => a.localeCompare(b))
  if (rules.length === 0) {
    throw new Error(`У каталозі mdc пакету немає файлів .mdc. Створіть ${CONFIG_FILE} вручну.`)
  }
  return rules
}

/**
 * Імена skills (id без префікса n-) з каталогу skills пакету — лише підкаталоги `<id>/` без префікса n-
 * @returns {Promise<string[]>} відсортовані id
 */
async function discoverBundledSkillNames() {
  if (!existsSync(BUNDLED_SKILLS_DIR)) {
    return []
  }
  const entries = await readdir(BUNDLED_SKILLS_DIR, { withFileTypes: true })
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
 * Зчитує конфіг .n-cursor.json з поточної директорії
 * @returns {Promise<{ $schema: string, rules: string[], skills: string[], version?: string } & Record<string, unknown>>} rules, skills (id без префікса n-); поле version у файлі за наявності ігнорується при синхронізації правил
 */
async function readConfig() {
  await migrateLegacyConfigIfNeeded()
  const configPath = join(cwd(), CONFIG_FILE)
  if (!existsSync(configPath)) {
    const rules = await discoverBundledRuleNames()
    const skills = await discoverBundledSkillNames()
    const defaultConfig = { $schema: CONFIG_SCHEMA_URL, rules, skills }
    await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8')
    console.log(
      `📝 Створено ${CONFIG_FILE} з усіма правилами (${rules.length}) і skills (${skills.length}) з пакету. За потреби відредагуйте списки.\n`
    )
    return defaultConfig
  }
  const raw = await readFile(configPath, 'utf8')
  let config
  try {
    config = JSON.parse(raw)
  } catch {
    throw new Error(`Невірний JSON у файлі ${CONFIG_FILE}`)
  }
  if (!Array.isArray(config.rules) || config.rules.length === 0) {
    throw new Error(`У ${CONFIG_FILE} має бути непорожній масив "rules"`)
  }
  if (!Array.isArray(config.skills)) {
    if ('skills' in config) {
      throw new Error(`У ${CONFIG_FILE} поле "skills" має бути масивом рядків`)
    }
    config.skills = await discoverBundledSkillNames()
  }

  if (config.$schema !== CONFIG_SCHEMA_URL) {
    const { $schema: _omit, ...rest } = config
    const normalized = { $schema: CONFIG_SCHEMA_URL, ...rest }
    await writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    console.log(`📝 Оновлено поле $schema у ${CONFIG_FILE}\n`)
    return normalized
  }

  return config
}

/**
 * Витягує чисте ім'я файлу правила (без шляху, але зберігає .mdc)
 * "npm/mdc/js-format.mdc" → "js-format.mdc"
 * "js-format"              → "js-format.mdc"
 * @param {string} ruleName шлях або базове ім'я, з суфіксом .mdc або без
 * @returns {string} лише ім'я файлу з суфіксом .mdc
 */
function normalizeRuleName(ruleName) {
  const name = ruleName.endsWith('.mdc') ? ruleName : `${ruleName}.mdc`
  return basename(name)
}

/**
 * Читає вміст правила з каталогу `mdc/` установленого пакету (наприклад `node_modules/@nitra/cursor/mdc` або кеш npx).
 * @param {string} rule елемент масиву rules з `.n-cursor.json`
 * @returns {Promise<string>} текст правила для запису в `.cursor/rules/n-*.mdc`
 */
function readBundledRuleContent(rule) {
  const bundledName = normalizeRuleName(rule)
  const bundledPath = join(BUNDLED_MDC_DIR, bundledName)
  if (!existsSync(bundledPath)) {
    throw new Error(
      `Немає файлу ${bundledName} у ${BUNDLED_MDC_DIR}. Оновіть ${PACKAGE_NAME} або приберіть "${rule}" з rules у ${CONFIG_FILE}.`
    )
  }
  return readFile(bundledPath, 'utf8')
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
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) {
    return null
  }
  const block = fm[1]
  const desc = block.match(/description:\s*>-\s*\r?\n((?:^\s+.+(?:\r?\n|$))+)/m)
  if (!desc) {
    return null
  }
  return desc[1]
    .split(/\r?\n/)
    .map(line => line.replace(/^\s+/, '').trimEnd())
    .join(' ')
    .trim()
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
 * Розгортає в шаблоні блок Mustache {{#section}} … {{/section}} для масиву елементів
 * @param {string} template вихідний текст шаблону
 * @param {string} section ім'я секції (наприклад services)
 * @param {Record<string, string>[]} items елементи для повторення тіла секції
 * @param {string} prop ключ поля для підстановки замість {{prop}}
 * @returns {string} текст після розгортання усіх входжень блоку
 */
function expandMustacheSection(template, section, items, prop) {
  const open = `{{#${section}}}`
  const close = `{{/${section}}}`
  const placeholder = `{{${prop}}}`
  let result = template
  let start = result.indexOf(open)
  let end = result.indexOf(close)
  while (start !== -1 && end !== -1 && end > start) {
    const inner = result.slice(start + open.length, end)
    const rendered = items.map(item => inner.split(placeholder).join(String(item[prop]))).join('')
    result = result.slice(0, start) + rendered + result.slice(end + close.length)
    start = result.indexOf(open)
    end = result.indexOf(close)
  }
  return result
}

/**
 * Підставляє у вміст AGENTS.template.md список шляхів до файлів правил і skills
 * @param {string} templateText вміст AGENTS.template.md
 * @param {string[]} mdcBasenames імена файлів (*.mdc) з .cursor/rules
 * @param {{ name: string }[]} skillItems рядки для секції Skills
 * @returns {string} готовий markdown для AGENTS.md
 */
function renderAgentsTemplate(templateText, mdcBasenames, skillItems) {
  let result = templateText
  const serviceItems = mdcBasenames.map(mdcName => ({
    name: `- ${RULES_DIR}/${mdcName}`
  }))
  result = expandMustacheSection(result, 'services', serviceItems, 'name')
  result = expandMustacheSection(result, 'skills', skillItems, 'name')
  return result
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
  return new Set(configRules.map(rule => `${RULE_PREFIX}${normalizeRuleName(rule)}`))
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
 * Формує markdown-рядки для секції Skills у AGENTS.md з SKILL.md на диску
 * @param {string[]} skillIds id з конфігу (без префікса n-)
 * @returns {Promise<{ name: string }[]>} елементи з полем name для Mustache-секції skills
 */
async function buildSkillBulletItems(skillIds) {
  const skillsRoot = join(cwd(), SKILLS_DIR)
  const items = []
  for (const id of skillIds) {
    const dirName = managedSkillDirName(id)
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
 * Генерує CLAUDE.md у корені cwd з at-імпортами всіх .mdc-правил та посиланнями на skills.
 * Завдяки цьому Claude Code автоматично завантажує вміст кожного правила при старті.
 * @param {string[]} configRules елементи масиву rules з .n-cursor.json
 * @param {string[]} configSkills id skills з конфігу
 * @returns {Promise<void>}
 */
async function syncClaudeMd(configRules, configSkills) {
  const lines = [`<!-- Цей файл генерується автоматично через \`npx ${PACKAGE_NAME}\`. Не редагуй вручну. -->`, '']

  for (const rule of configRules) {
    const fileName = `${RULE_PREFIX}${normalizeRuleName(rule)}`
    lines.push(`@${RULES_DIR}/${fileName}`)
  }

  if (configSkills.length > 0) {
    lines.push('', '## Skills', '')
    const skillsRoot = join(cwd(), SKILLS_DIR)
    for (const skillId of configSkills) {
      const id = normalizeSkillId(skillId)
      const dirName = managedSkillDirName(skillId)
      const skillMdPath = join(skillsRoot, dirName, 'SKILL.md')
      let desc = ''
      if (existsSync(skillMdPath)) {
        const text = await readFile(skillMdPath, 'utf8')
        const parsed = extractSkillDescription(text)
        if (parsed) desc = skillDescriptionSafeForMarkdownInline(parsed)
      }
      const ref = `- \`${SKILLS_DIR}/${dirName}/SKILL.md\``
      lines.push(desc ? `${ref} — ${desc}` : ref, `  Команда: \`/${RULE_PREFIX}${id}\``)
    }
  }

  lines.push('')
  const claudeMdPath = join(cwd(), 'CLAUDE.md')
  const hadFile = existsSync(claudeMdPath)
  await writeFile(claudeMdPath, lines.join('\n'), 'utf8')
  console.log(hadFile ? `📝 Оновлено CLAUDE.md` : `📝 Створено CLAUDE.md`)
}

/**
 * Повністю перезаписує AGENTS.md у корені cwd з npm/AGENTS.template.md
 * @param {string[]} configSkills id skills з конфігу
 * @returns {Promise<void>} завершення запису файлу
 */
async function syncAgentsMd(configSkills) {
  if (!existsSync(BUNDLED_AGENTS_TEMPLATE_PATH)) {
    throw new Error(
      `Не знайдено шаблон ${AGENTS_TEMPLATE_FILE} у пакеті.\n` +
        `Очікуваний шлях: ${BUNDLED_AGENTS_TEMPLATE_PATH}\n` +
        `Перевстановіть ${PACKAGE_NAME}.`
    )
  }
  const templateText = await readFile(BUNDLED_AGENTS_TEMPLATE_PATH, 'utf8')
  const mdcFiles = await listProjectRulesMdcFiles()
  const skillItems = await buildSkillBulletItems(configSkills)
  const body = renderAgentsTemplate(templateText, mdcFiles, skillItems)
  const agentsPath = join(cwd(), AGENTS_FILE)
  const hadFile = existsSync(agentsPath)
  const out = body.endsWith('\n') ? body : `${body}\n`
  await writeFile(agentsPath, out, 'utf8')
  console.log(
    hadFile
      ? `📝 Оновлено ${AGENTS_FILE} з ${AGENTS_TEMPLATE_FILE}`
      : `📝 Створено ${AGENTS_FILE} з ${AGENTS_TEMPLATE_FILE}`
  )
}

/**
 * Копіює лише skills зі списку configSkills (джерело: skills/<id>/ у пакеті)
 * @param {string[]} configSkills id без префікса n-
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих копіювань
 */
async function syncSkills(configSkills) {
  if (configSkills.length === 0 || !existsSync(BUNDLED_SKILLS_DIR)) {
    return { success: 0, fail: 0 }
  }

  const skillsRoot = join(cwd(), SKILLS_DIR)
  await mkdir(skillsRoot, { recursive: true })

  let success = 0
  let fail = 0

  for (const skillId of configSkills) {
    const id = normalizeSkillId(skillId)
    const srcDir = join(BUNDLED_SKILLS_DIR, id)
    const destDirName = managedSkillDirName(skillId)
    const destDir = join(skillsRoot, destDirName)

    if (existsSync(srcDir)) {
      process.stdout.write(`  ⬇  ${id} → ${SKILLS_DIR}/${destDirName} ... `)
      try {
        await mkdir(destDir, { recursive: true })
        const files = await readdir(srcDir)
        for (const file of files) {
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
 * Кожен файл містить посилання на відповідний cursor skill, а не копію інструкцій.
 * @param {string[]} configSkills id без префікса n-
 * @returns {Promise<{ success: number, fail: number }>} лічильники успішних і невдалих записів
 */
async function syncCommands(configSkills) {
  if (configSkills.length === 0 || !existsSync(BUNDLED_SKILLS_DIR)) {
    return { success: 0, fail: 0 }
  }

  const commandsDir = join(cwd(), COMMANDS_DIR)
  await mkdir(commandsDir, { recursive: true })

  let success = 0
  let fail = 0

  for (const skillId of configSkills) {
    const id = normalizeSkillId(skillId)
    const srcSkillMd = join(BUNDLED_SKILLS_DIR, id, 'SKILL.md')
    const destDirName = managedSkillDirName(skillId)
    const destFile = join(commandsDir, `${RULE_PREFIX}${id}.md`)

    process.stdout.write(`  ⬇  ${id} → ${COMMANDS_DIR}/${RULE_PREFIX}${id}.md ... `)
    if (existsSync(srcSkillMd)) {
      try {
        const raw = await readFile(srcSkillMd, 'utf8')
        const descRaw = extractSkillDescription(raw)
        const desc = descRaw ? skillDescriptionSafeForMarkdownInline(descRaw) : ''
        const header = desc ? `# ${RULE_PREFIX}${id} — ${desc}\n\n` : ''
        const body = `${header}Виконай інструкції зі скілу \`.cursor/skills/${destDirName}/SKILL.md\`.\n`
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
 * Знаходить доступні check-скрипти у каталозі scripts пакету
 * @returns {Promise<string[]>} відсортовані імена правил (наприклад ['bun', 'ga', 'js-lint'])
 */
async function discoverCheckScripts() {
  if (!existsSync(BUNDLED_SCRIPTS_DIR)) return []
  const names = await readdir(BUNDLED_SCRIPTS_DIR)
  return names
    .filter(n => n.startsWith('check-') && n.endsWith('.mjs'))
    .map(n => n.slice('check-'.length, -'.mjs'.length))
    .toSorted((a, b) => a.localeCompare(b))
}

/**
 * Перетворює базове ім'я .mdc у .cursor/rules на id скрипта check-<id>.mjs
 * @param {string} mdcBasename наприклад n-bun.mdc або script.mdc
 * @returns {string} id без суфікса .mdc та без префікса n- для керованих правил
 */
function mdcBasenameToCheckId(mdcBasename) {
  const base = basename(mdcBasename)
  const withoutExt = base.endsWith('.mdc') ? base.slice(0, -'.mdc'.length) : base
  return withoutExt.startsWith(RULE_PREFIX) ? withoutExt.slice(RULE_PREFIX.length) : withoutExt
}

/**
 * Зчитує AGENTS.md і повертає унікальні id перевірок у порядку згадування, лише ті що є в available
 * @param {string[]} available імена з discoverCheckScripts()
 * @returns {Promise<string[]>} унікальні id перевірок у порядку згадування в AGENTS.md
 */
async function discoverCheckRulesFromAgentsMd(available) {
  const agentsPath = join(cwd(), AGENTS_FILE)
  if (!existsSync(agentsPath)) {
    throw new Error(
      `Немає ${AGENTS_FILE}. Запустіть \`npx ${PACKAGE_NAME}\` або вкажіть правила: \`npx ${PACKAGE_NAME} check bun ga\``
    )
  }
  const text = await readFile(agentsPath, 'utf8')
  const re = /\.cursor\/rules\/([^\s#`>]+\.mdc)/g
  const raw = []
  let m
  while ((m = re.exec(text)) !== null) {
    raw.push(m[1])
  }
  if (raw.length === 0) {
    throw new Error(
      `У ${AGENTS_FILE} немає посилань \`.cursor/rules/….mdc\`. Оновіть файл (\`npx ${PACKAGE_NAME}\`) або передайте правила явно.`
    )
  }
  const seen = new Set()
  const ordered = []
  for (const pathFragment of raw) {
    const id = mdcBasenameToCheckId(pathFragment)
    if (available.includes(id) && !seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }
  return ordered
}

/**
 * Запускає перевірки: без аргументів — за списком у AGENTS.md; з аргументами — лише вказані правила
 * @param {string[]} requestedRules імена правил; порожній масив — брати з AGENTS.md
 * @returns {Promise<void>}
 */
async function runChecks(requestedRules) {
  const available = await discoverCheckScripts()
  if (available.length === 0) {
    console.error('❌ Не знайдено жодного check-скрипта у пакеті')
    throw new Error('No check scripts found')
  }

  const root = cwd()
  const legacyConfigPath = join(root, 'nitra-cursor.json')
  if (existsSync(join(root, CONFIG_FILE)) || existsSync(legacyConfigPath)) {
    try {
      await readConfig()
    } catch (error) {
      console.error(`❌ ${error.message}`)
      throw error
    }
  }

  let rulesToCheck
  if (requestedRules.length > 0) {
    rulesToCheck = requestedRules
  } else {
    rulesToCheck = await discoverCheckRulesFromAgentsMd(available)
    if (rulesToCheck.length === 0) {
      console.log(
        `\n🔍 ${PACKAGE_NAME} check — у ${AGENTS_FILE} немає правил з programmatic перевіркою ` +
          `(відповідного check-*.mjs у пакеті). Нічого не запущено.\n`
      )
      return
    }
  }

  const unknown = rulesToCheck.filter(r => !available.includes(r))
  if (unknown.length > 0) {
    console.error(`❌ Невідомі правила: ${unknown.join(', ')}`)
    console.log(`   Доступні: ${available.join(', ')}`)
    throw new Error(`Unknown rules: ${unknown.join(', ')}`)
  }

  console.log(`\n🔍 ${PACKAGE_NAME} check — перевірка правил (${rulesToCheck.length})\n`)

  let totalFailed = 0

  for (const rule of rulesToCheck) {
    const scriptPath = join(BUNDLED_SCRIPTS_DIR, `check-${rule}.mjs`)
    console.log(`📋 ${rule}:`)
    try {
      const { check } = await import(scriptPath)
      const code = await check()
      if (code !== 0) totalFailed++
    } catch (error) {
      console.log(`  ❌ Помилка виконання: ${error.message}`)
      totalFailed++
    }
    console.log()
  }

  const passedCount = rulesToCheck.length - totalFailed
  console.log(`✨ Результат: ${passedCount}/${rulesToCheck.length} правил без зауважень\n`)

  if (totalFailed > 0) {
    throw new Error(`${totalFailed} з ${rulesToCheck.length} правил мають проблеми`)
  }
}

/**
 * Копіює правила з каталогу `mdc/` установленого пакету та синхронізує `.cursor/rules`
 * @returns {Promise<void>}
 */
async function runSync() {
  console.log(`\n🔧 ${PACKAGE_NAME} — завантаження cursor-правил\n`)

  let config
  try {
    config = await readConfig()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    throw error
  }

  const { rules, skills, version } = config
  const bundledVer = await readBundledPackageVersion()
  if (bundledVer) {
    console.log(`📦 Джерело правил: ${PACKAGE_NAME}@${bundledVer}`)
  }
  if (version) {
    console.log(`⚠️  Поле "version" у ${CONFIG_FILE} ігнорується; правила беруться з установленого пакету.\n`)
  }
  console.log(`📋 Правил до завантаження: ${rules.length}`)
  console.log(`📋 Skills до синхронізації: ${skills.length}`)

  try {
    const { destPath } = await syncSetupBunDepsAction(cwd(), BUNDLED_PACKAGE_ROOT)
    console.log(`📝 Оновлено ${destPath} (composite setup-bun-deps з пакету)\n`)
  } catch (error) {
    console.error(`❌ Не вдалося записати setup-bun-deps action: ${error.message}`)
    throw error
  }

  const rulesDir = join(cwd(), RULES_DIR)
  await mkdir(rulesDir, { recursive: true })

  let successCount = 0
  let failCount = 0

  for (const rule of rules) {
    const fileName = `${RULE_PREFIX}${normalizeRuleName(rule)}`
    const destPath = join(rulesDir, fileName)

    try {
      process.stdout.write(`  ⬇  ${rule} → ${RULES_DIR}/${fileName} ... `)
      const content = await readBundledRuleContent(rule)
      await writeFile(destPath, content, 'utf8')
      console.log(`✅`)
      successCount++
    } catch (error) {
      console.log(`❌`)
      console.error(`     Помилка: ${error.message}`)
      failCount++
    }
  }

  try {
    const removed = await removeOrphanManagedRuleFiles(rulesDir, rules)
    if (removed.length > 0) {
      console.log(`\n🧹 Видалено правила поза списком ${CONFIG_FILE} (${removed.length}):`)
      for (const name of removed) {
        console.log(`   − ${RULES_DIR}/${name}`)
      }
    }
  } catch (error) {
    console.error(`❌ Не вдалося прибрати зайві файли в ${RULES_DIR}: ${error.message}`)
    throw error
  }

  try {
    const { success: skillOk, fail: skillFail } = await syncSkills(skills)
    if (skills.length > 0) {
      console.log(`\n🧩 Skills: ${skillOk} скопійовано, ${skillFail} з помилками`)
    }
    const removedSkills = await removeOrphanManagedSkillDirs(join(cwd(), SKILLS_DIR), skills)
    if (removedSkills.length > 0) {
      console.log(`\n🧹 Видалено skills поза списком ${CONFIG_FILE} (${removedSkills.length}):`)
      for (const name of removedSkills) {
        console.log(`   − ${SKILLS_DIR}/${name}`)
      }
    }
    if (skillFail > 0) {
      throw new Error(`Не вдалося скопіювати ${skillFail} з ${skills.length} skills`)
    }
  } catch (error) {
    console.error(`❌ Skills: ${error.message}`)
    throw error
  }

  try {
    const { success: cmdOk, fail: cmdFail } = await syncCommands(skills)
    if (skills.length > 0) {
      console.log(`\n⌨️  Commands: ${cmdOk} скопійовано, ${cmdFail} з помилками`)
    }
    const removedCmds = await removeOrphanManagedCommandFiles(join(cwd(), COMMANDS_DIR), skills)
    if (removedCmds.length > 0) {
      console.log(`\n🧹 Видалено commands поза списком ${CONFIG_FILE} (${removedCmds.length}):`)
      for (const name of removedCmds) {
        console.log(`   − ${COMMANDS_DIR}/${name}`)
      }
    }
    if (cmdFail > 0) {
      throw new Error(`Не вдалося скопіювати ${cmdFail} з ${skills.length} commands`)
    }
  } catch (error) {
    console.error(`❌ Commands: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  try {
    await syncAgentsMd(skills)
  } catch (error) {
    console.error(`❌ Не вдалося оновити ${AGENTS_FILE}: ${error.message}`)
    throw error
  }

  try {
    await syncClaudeMd(rules, skills)
  } catch (error) {
    console.error(`❌ Не вдалося оновити CLAUDE.md: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  console.log(`\n✨ Готово: ${successCount} завантажено, ${failCount} з помилками\n`)
  if (failCount > 0) {
    throw new Error(`Не вдалося завантажити ${failCount} з ${rules.length} правил`)
  }
}

// CLI: маршрутизація команд
const [command, ...args] = process.argv.slice(2)

try {
  await ensureNitraCursorInRootDevDependencies(cwd())
  if (command === 'check') {
    await runChecks(args)
  } else {
    await runSync()
  }
} catch {
  process.exitCode = 1
}
