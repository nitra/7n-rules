/**
 * Один change-файл `<ws>/.changes/<timestamp>-<rand>.md`: YAML-подібний frontmatter
 * із двома ключами (`bump`, `section`) + текст опису. Парсер мінімальний — лише ці два
 * ключі, без зовнішніх залежностей.
 */

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Дозволені semver-бампи, від найбільшого до найменшого (порядок використовується для max). */
export const VALID_BUMPS = Object.freeze(['major', 'minor', 'patch'])

/** Дозволені Keep a Changelog секції (заголовок `### {section}`). */
export const VALID_SECTIONS = Object.freeze(['Added', 'Changed', 'Fixed', 'Removed'])

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/**
 * @param {string} block тіло frontmatter (між `---`)
 * @returns {Record<string, string>} пари ключ→значення
 */
function parseFrontmatterBlock(block) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

/**
 * @param {string} text вміст change-файлу
 * @returns {{ bump: string, section: string, description: string }} розпарсений запис
 */
export function parseChangeFile(text) {
  const m = FRONTMATTER_RE.exec(text)
  if (!m) throw new Error('change-файл: відсутній frontmatter `---`')
  const fm = parseFrontmatterBlock(m[1])
  const description = m[2].trim()
  if (!VALID_BUMPS.includes(fm.bump)) {
    throw new Error(`change-файл: bump має бути одним із ${VALID_BUMPS.join('|')} (отримано «${fm.bump ?? ''}»)`)
  }
  if (!VALID_SECTIONS.includes(fm.section)) {
    throw new Error(
      `change-файл: section має бути одним із ${VALID_SECTIONS.join('|')} (отримано «${fm.section ?? ''}»)`
    )
  }
  if (!description) throw new Error('change-файл: порожній опис')
  return { bump: fm.bump, section: fm.section, description }
}

/**
 * @param {{ bump: string, section: string, description: string }} entry запис
 * @returns {string} вміст change-файлу
 */
export function serializeChangeFile(entry) {
  return `---\nbump: ${entry.bump}\nsection: ${entry.section}\n---\n${entry.description}\n`
}

/** Підкаталог зі change-файлами всередині workspace. */
export const CHANGES_DIR = '.changes'

/**
 * @param {number} timestamp `Date.now()`
 * @param {string} suffix короткий випадковий суфікс (hex)
 * @returns {string} `<timestamp>-<suffix>.md`
 */
export function changeFileName(timestamp, suffix) {
  return `${timestamp}-${suffix}.md`
}

/**
 * Унікальне ім'я для нового change-файлу: timestamp (порядок) + rand (анти-колізія
 * для паралельних агентів у різних worktree, що пишуть у ту саму мілісекунду).
 * @returns {string} результат
 */
export function newChangeFileName() {
  return changeFileName(Date.now(), randomBytes(3).toString('hex'))
}

/**
 * @param {string} ws шлях workspace (відносно `cwd`)
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<Array<{ file: string, entry: { bump: string, section: string, description: string } }>>} розпарсені change-файли
 */
export async function readChangeFiles(ws, cwd = process.cwd()) {
  const dir = join(cwd, ws, CHANGES_DIR)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir)
  const names = entries.filter(n => n.endsWith('.md')).toSorted()
  const result = []
  for (const file of names) {
    const text = await readFile(join(dir, file), 'utf8')
    result.push({ file, entry: parseChangeFile(text) })
  }
  return result
}
