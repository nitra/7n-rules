#!/usr/bin/env node

/**
 * @nitra/cursor CLI
 *
 * Завантажує cursor-правила з npm-пакету @nitra/cursor у локальний репозиторій.
 *
 * Використання:
 *   npx @nitra/cursor
 *
 * Перед запуском у цільовому репо потрібно створити файл nitra-cursor.json
 * зі списком правил для завантаження.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { cwd } from 'node:process'

const PACKAGE_NAME = '@nitra/cursor'
const UNPKG_BASE = 'https://unpkg.com'
const CONFIG_FILE = 'nitra-cursor.json'
const RULES_DIR = '.cursor/rules'
const RULE_PREFIX = 'nitra-'

/**
 * Завантажує текст з URL
 * @param {string} url
 * @returns {Promise<string>}
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
 * @returns {Promise<{rules: string[], version?: string}>}
 */
async function readConfig() {
  const configPath = join(cwd(), CONFIG_FILE)
  if (!existsSync(configPath)) {
    throw new Error(
      `Файл конфігурації не знайдено: ${CONFIG_FILE}\n` +
      `Створіть файл ${CONFIG_FILE} у корені репозиторію.\n` +
      `Приклад:\n` +
      `{\n  "rules": ["js-format", "npm-module", "spell"]\n}`
    )
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
 * @param {string} ruleName — ім'я без розширення, наприклад "js-format"
 * @param {string} [version] — версія пакету (необов'язково, за замовчуванням "latest")
 * @returns {string}
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
 * @param {string} ruleName
 * @returns {string}
 */
function normalizeRuleName(ruleName) {
  const name = ruleName.endsWith('.mdc') ? ruleName : `${ruleName}.mdc`
  return basename(name)
}

async function main() {
  console.log(`\n🔧 @nitra/cursor — завантаження cursor-правил\n`)

  // 1. Зчитуємо конфіг
  let config
  try {
    config = await readConfig()
  } catch (err) {
    console.error(`❌ ${err.message}`)
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
    } catch (err) {
      console.log(`❌`)
      console.error(`     Помилка: ${err.message}`)
      failCount++
    }
  }

  // 4. Підсумок
  console.log(`\n✨ Готово: ${successCount} завантажено, ${failCount} з помилками\n`)
  if (failCount > 0) {
    process.exit(1)
  }
}

main()
