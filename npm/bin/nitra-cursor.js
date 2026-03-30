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
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@nitra/cursor'
const UNPKG_BASE = 'https://unpkg.com'
const CONFIG_FILE = 'nitra-cursor.json'
const RULES_DIR = '.cursor/rules'
const RULE_PREFIX = 'nitra-'

const binDir = dirname(fileURLToPath(import.meta.url))
const BUNDLED_MDC_DIR = join(binDir, '..', 'mdc')

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
      `📝 Створено ${CONFIG_FILE} з усіма правилами з пакету (${rules.length}). ` + `За потреби відредагуйте список.\n`
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

// 4. Підсумок
console.log(`\n✨ Готово: ${successCount} завантажено, ${failCount} з помилками\n`)
if (failCount > 0) {
  process.exit(1)
}
