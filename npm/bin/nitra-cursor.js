#!/usr/bin/env node

/**
 * nitra-cursor — CLI завантаження правил
 *
 * Завантажує cursor-правила з npm-пакету nitra-cursor у локальний репозиторій.
 *
 * Використання:
 *   npx @nitra/cursor
 *
 * Якщо у корені репозиторію немає nitra-cursor.json, він створюється автоматично
 * з усіма правилами з каталогу mdc пакету (їх можна відредагувати після створення).
 *
 * Файл AGENTS.md у корені: щоразу повністю перезаписується змістом з AGENTS.template.md
 * пакету; список правил у шаблоні будується з файлів *.mdc у .cursor/rules поточного проєкту.
 *
 * Після завантаження: у .cursor/rules видаляються файли *.mdc з префіксом «nitra-» (керовані
 * пакетом), яких немає у списку rules у nitra-cursor.json. Інші .mdc у цій директорії залишаються.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@nitra/cursor'
const UNPKG_BASE = 'https://unpkg.com'
const CONFIG_FILE = 'nitra-cursor.json'
const AGENTS_FILE = 'AGENTS.md'
const AGENTS_TEMPLATE_FILE = 'AGENTS.template.md'
const RULES_DIR = '.cursor/rules'
const RULE_PREFIX = 'nitra-'

const binDir = dirname(fileURLToPath(import.meta.url))
const BUNDLED_MDC_DIR = join(binDir, '..', 'mdc')
const BUNDLED_AGENTS_TEMPLATE_PATH = join(binDir, '..', AGENTS_TEMPLATE_FILE)

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
    .sort((a, b) => a.localeCompare(b))
  if (rules.length === 0) {
    throw new Error(`У каталозі mdc пакету немає файлів .mdc. Створіть ${CONFIG_FILE} вручну.`)
  }
  return rules
}

/**
 * Завантажує текст з URL
 * @param {string} url адреса HTTP(S)
 * @returns {Promise<string>} тіло відповіді як UTF-8 текст
 */
async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — не вдалося завантажити: ${url}`)
  }
  return response.text()
}

/**
 * Зчитує конфіг nitra-cursor.json з поточної директорії
 * @returns {Promise<{rules: string[], version?: string}>} об'єкт з масивом rules і опційно version; при відсутності файлу створює дефолтний конфіг
 */
async function readConfig() {
  const configPath = join(cwd(), CONFIG_FILE)
  if (!existsSync(configPath)) {
    const rules = await discoverBundledRuleNames()
    const defaultConfig = { rules }
    await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8')
    console.log(
      `📝 Створено ${CONFIG_FILE} з усіма правилами з пакету (${rules.length}). За потреби відредагуйте список.\n`
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
  return config
}

/**
 * Повертає URL для завантаження правила з unpkg
 * @param {string} ruleName - ім'я без розширення, наприклад "js-format"
 * @param {string} [version] - версія пакету (необов'язково, за замовчуванням "latest")
 * @returns {string} повний URL файлу правила на unpkg
 */
function buildUrl(ruleName, version) {
  const name = ruleName.endsWith('.mdc') ? ruleName : `${ruleName}.mdc`
  const ver = version ? `@${version}` : '@latest'
  return `${UNPKG_BASE}/${PACKAGE_NAME}${ver}/mdc/${name}`
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
 * Підставляє у вміст AGENTS.template.md список шляхів до файлів правил
 * @param {string} templateText вміст AGENTS.template.md
 * @param {string[]} mdcBasenames імена файлів (*.mdc) з .cursor/rules
 * @returns {string} готовий markdown для AGENTS.md
 */
function renderAgentsTemplate(templateText, mdcBasenames) {
  const items = mdcBasenames.map(mdcName => ({
    name: `- ${RULES_DIR}/${mdcName}`
  }))
  return expandMustacheSection(templateText, 'services', items, 'name')
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
  return names.filter(n => n.endsWith('.mdc')).sort((a, b) => a.localeCompare(b))
}

/**
 * Базові імена файлів .mdc, які очікуються згідно з nitra-cursor.json (префікс nitra-).
 * @param {string[]} configRules елементи масиву rules з конфігу
 * @returns {Set<string>} множина очікуваних імен файлів (наприклад nitra-bun.mdc)
 */
function expectedManagedRuleBasenames(configRules) {
  return new Set(configRules.map(rule => `${RULE_PREFIX}${normalizeRuleName(rule)}`))
}

/**
 * Видаляє з каталогу правил файли *.mdc з префіксом nitra-, яких немає у конфігурації.
 * Файли без префікса nitra- не змінює.
 * @param {string} rulesDir абсолютний шлях до .cursor/rules
 * @param {string[]} configRules елементи масиву rules з nitra-cursor.json
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
    if (!name.endsWith('.mdc') || !name.startsWith(RULE_PREFIX)) {
      continue
    }
    if (expected.has(name)) {
      continue
    }
    await unlink(join(rulesDir, name))
    removed.push(name)
  }
  return removed.sort((a, b) => a.localeCompare(b))
}

/**
 * Повністю перезаписує AGENTS.md у корені cwd з npm/AGENTS.template.md
 * @returns {Promise<void>} завершення запису файлу
 */
async function syncAgentsMd() {
  if (!existsSync(BUNDLED_AGENTS_TEMPLATE_PATH)) {
    throw new Error(
      `Не знайдено шаблон ${AGENTS_TEMPLATE_FILE} у пакеті.\n` +
        `Очікуваний шлях: ${BUNDLED_AGENTS_TEMPLATE_PATH}\n` +
        `Перевстановіть ${PACKAGE_NAME}.`
    )
  }
  const templateText = await readFile(BUNDLED_AGENTS_TEMPLATE_PATH, 'utf8')
  const mdcFiles = await listProjectRulesMdcFiles()
  const body = renderAgentsTemplate(templateText, mdcFiles)
  const agentsPath = join(cwd(), AGENTS_FILE)
  const hadFile = existsSync(agentsPath)
  const out = body.endsWith('\n') ? body : `${body}\n`
  await writeFile(agentsPath, out, 'utf8')
  console.log(hadFile ? `📝 Оновлено ${AGENTS_FILE} з ${AGENTS_TEMPLATE_FILE}` : `📝 Створено ${AGENTS_FILE} з ${AGENTS_TEMPLATE_FILE}`)
}

console.log(`\n🔧 @nitra/cursor — завантаження cursor-правил\n`)

// 1. Зчитуємо конфіг
let config
try {
  config = await readConfig()
} catch (error) {
  console.error(`❌ ${error.message}`)
  process.exit(1)
}

const { rules, version } = config
if (version) {
  console.log(`📦 Версія пакету: ${version}`)
}
console.log(`📋 Правил до завантаження: ${rules.length}`)

// 2. Створюємо директорію .cursor/rules якщо не існує
const rulesDir = join(cwd(), RULES_DIR)
await mkdir(rulesDir, { recursive: true })

// 3. Завантажуємо та зберігаємо кожне правило
let successCount = 0
let failCount = 0

for (const rule of rules) {
  const url = buildUrl(rule, version)
  const fileName = `${RULE_PREFIX}${normalizeRuleName(rule)}`
  const destPath = join(rulesDir, fileName)

  try {
    process.stdout.write(`  ⬇  ${rule} → ${RULES_DIR}/${fileName} ... `)
    const content = await fetchText(url)
    await writeFile(destPath, content, 'utf8')
    console.log(`✅`)
    successCount++
  } catch (error) {
    console.log(`❌`)
    console.error(`     Помилка: ${error.message}`)
    failCount++
  }
}

// 4. Прибираємо керовані nitra-*.mdc, яких немає у nitra-cursor.json
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
  process.exit(1)
}

// 5. AGENTS.md зі списком файлів *.mdc у .cursor/rules (після оновлення на диску)
try {
  await syncAgentsMd()
} catch (error) {
  console.error(`❌ Не вдалося оновити ${AGENTS_FILE}: ${error.message}`)
  process.exit(1)
}

// 6. Підсумок
console.log(`\n✨ Готово: ${successCount} завантажено, ${failCount} з помилками\n`)
if (failCount > 0) {
  process.exit(1)
}
