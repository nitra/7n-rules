/**
 * Агрегація change-файлів одного workspace у version-bump + секцію CHANGELOG
 * (Keep a Changelog 1.1.0, новіше зверху). Без побічних ефектів — лише обчислення/рендер;
 * запис на диск і git — у release.mjs.
 */
import { VALID_BUMPS, VALID_SECTIONS } from './change-file.mjs'

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/
const CHANGELOG_HEADER = '# Changelog'

/**
 * @param {string} version `x.y.z`
 * @param {string} bump `major|minor|patch`
 * @returns {string} нова версія
 */
export function bumpVersion(version, bump) {
  const m = SEMVER_RE.exec(version)
  if (!m) throw new Error(`aggregate: невалідний semver «${version}»`)
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * @param {string[]} bumps непорожній список
 * @returns {string} найвищий bump (major > minor > patch)
 */
export function maxBump(bumps) {
  return VALID_BUMPS.find(level => bumps.includes(level)) ?? 'patch'
}

/**
 * Обмежує bump зверху стелею (`package.json#release.maxBump`) — наприклад, не дає
 * `major`-change-файлу підняти major-версію пакета, навіть якщо його явно поставили.
 * @param {string} bump обчислений bump (`major|minor|patch`)
 * @param {string | null} [cap] стеля (`major|minor|patch`) або `null` — без обмеження
 * @returns {string} bump не суворіший за `cap`
 */
export function capBump(bump, cap) {
  if (!cap) return bump
  const bumpRank = VALID_BUMPS.indexOf(bump)
  const capRank = VALID_BUMPS.indexOf(cap)
  return bumpRank < capRank ? cap : bump
}

/**
 * @param {string} version нова версія
 * @param {string} date `YYYY-MM-DD`
 * @param {Array<{ section: string, description: string }>} entries записи change-файлів
 * @returns {string} markdown-блок секції
 */
export function renderChangelogSection(version, date, entries) {
  let out = `## [${version}] - ${date}\n`
  for (const section of VALID_SECTIONS) {
    const bullets = entries.filter(e => e.section === section)
    if (bullets.length === 0) continue
    const bulletLines = bullets.map(b => '- ' + b.description).join('\n')
    out += `\n### ${section}\n\n${bulletLines}\n`
  }
  return out
}

/**
 * @param {string} existingText наявний CHANGELOG.md (може бути порожнім)
 * @param {string} sectionBlock новий блок версії
 * @returns {string} CHANGELOG із секцією зверху
 */
export function prependChangelogSection(existingText, sectionBlock) {
  const text = existingText.trimStart()
  if (!text.startsWith(CHANGELOG_HEADER)) {
    return `${CHANGELOG_HEADER}\n\n${sectionBlock}`
  }
  const nl = text.indexOf('\n')
  const head = text.slice(0, nl === -1 ? text.length : nl)
  const rest = nl === -1 ? '' : text.slice(nl + 1).trimStart()
  return `${head}\n\n${sectionBlock}\n${rest}`
}

/**
 * @param {object} params параметри
 * @param {string} params.currentVersion поточна version маніфесту
 * @param {Array<{ file: string, entry: { bump: string, section: string, description: string } }>} params.changeFiles change-файли workspace
 * @param {string} params.date `YYYY-MM-DD`
 * @param {string | null} [params.maxBumpCap] стеля bump з `package.json#release.maxBump`; `null` — без обмеження
 * @returns {{ newVersion: string, sectionBlock: string, consumedFiles: string[] } | null} результат або null, якщо змін нема
 */
export function aggregateWorkspace({ currentVersion, changeFiles, date, maxBumpCap = null }) {
  if (changeFiles.length === 0) return null
  const bump = capBump(maxBump(changeFiles.map(c => c.entry.bump)), maxBumpCap)
  const newVersion = bumpVersion(currentVersion, bump)
  const sectionBlock = renderChangelogSection(
    newVersion,
    date,
    changeFiles.map(c => c.entry)
  )
  return { newVersion, sectionBlock, consumedFiles: changeFiles.map(c => c.file) }
}
