/**
 * `n-cursor change` — пише один change-файл `<ws>/.changes/<timestamp>-<rand>.md`.
 * Замінює ручне редагування CHANGELOG у feature-флоу (n-changelog.mdc v3.0).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CHANGES_DIR, newChangeFileName, parseChangeFile, serializeChangeFile } from './lib/change-file.mjs'

/**
 * @param {object} params параметри
 * @param {string} params.bump `major|minor|patch`
 * @param {string} params.section `Added|Changed|Fixed|Removed`
 * @param {string} params.message опис
 * @param {string} [params.ws] workspace (за замовчуванням `.`)
 * @param {string} [params.cwd] корінь
 * @returns {Promise<string>} відносний шлях створеного файлу (від ws)
 */
export async function writeChange({ bump, section, message, ws = '.', cwd = process.cwd() }) {
  const description = (message ?? '').trim()
  const content = serializeChangeFile({ bump, section, description })
  // Валідація полів: parseChangeFile кидає зрозумілу помилку на невалідних bump/section/порожньому описі.
  parseChangeFile(content)

  const dir = join(cwd, ws, CHANGES_DIR)
  await mkdir(dir, { recursive: true })
  const name = newChangeFileName()
  await writeFile(join(dir, name), content)
  return join(CHANGES_DIR, name)
}

/**
 * @param {string[]} args аргументи CLI (`--bump`, `--section`, `--message`, `--ws`)
 * @returns {Promise<number>} exit-код
 */
export async function runChangeCli(args) {
  const get = flag => {
    const i = args.indexOf(flag)
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined
  }
  const bump = get('--bump')
  const section = get('--section')
  const message = get('--message')
  const ws = get('--ws') ?? '.'
  if (!bump || !section || !message) {
    console.error('❌ Використання: n-cursor change --bump <major|minor|patch> --section <Added|Changed|Fixed|Removed> --message "<опис>" [--ws <шлях>]')
    return 1
  }
  try {
    const rel = await writeChange({ bump, section, message, ws })
    console.log(`✅ ${join(ws, rel)}`)
    return 0
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
