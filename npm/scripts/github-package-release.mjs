/** Підготовка metadata й notes для GitHub Release package-тегу. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIPPED_DIRECTORIES = new Set(['.git', '.worktrees', 'node_modules'])

/**
 * Розділяє package-тег `<name>@<version>`, не плутаючи scope з роздільником версії.
 * @param {string} tag Git tag опублікованого npm-пакета
 * @returns {{name: string, version: string}} назва пакета та його версія
 */
export function parsePackageTag(tag) {
  const separator = tag.lastIndexOf('@')
  if (separator <= 0 || separator === tag.length - 1) throw new Error(`Unsupported package tag: ${tag}`)
  return { name: tag.slice(0, separator), version: tag.slice(separator + 1) }
}

/**
 * Витягує одну Keep a Changelog секцію з Markdown за її версією.
 * @param {string} changelog повний текст CHANGELOG.md
 * @param {string} version версія, позначена в `## [version]`
 * @returns {string} точний Markdown опису версії без сусідніх секцій
 */
export function extractChangelogSection(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
  if (start === -1) throw new Error(`Missing CHANGELOG section for ${version}`)
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
  return lines.slice(start, next === -1 ? undefined : next).join('\n').trim()
}

/**
 * Знаходить publishable npm package за name в усьому дереві workspace.
 * @param {string} root абсолютний корінь репозиторію
 * @param {string} name npm name із Git tag
 * @returns {{dir: string, version: string}} директорія та опублікована версія
 */
export function findPublishablePackage(root, name) {
  /** @type {Array<{dir: string, version: string}>} */
  const matches = []

  /** @param {string} directory абсолютна директорія для обходу */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue
      const child = join(directory, entry.name)
      const manifestPath = join(child, 'package.json')
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
          if (manifest.name === name && manifest.private !== true && typeof manifest.version === 'string' && existsSync(join(child, 'CHANGELOG.md'))) {
            matches.push({ dir: child, version: manifest.version })
          }
        } catch {
          // Некоректний сторонній manifest не є publishable workspace цього репозиторію.
        }
      }
      visit(child)
    }
  }

  visit(root)
  if (matches.length !== 1) throw new Error(`Expected one publishable package named ${name}, found ${matches.length}`)
  return matches[0]
}

/**
 * Готує назву й changelog notes GitHub Release для конкретного package-тегу.
 * @param {string} root абсолютний корінь репозиторію
 * @param {string} tag Git tag опублікованого npm-пакета
 * @returns {{title: string, notes: string}} метадані для `gh release create`
 */
export function prepareGitHubRelease(root, tag) {
  const { name, version } = parsePackageTag(tag)
  const packageInfo = findPublishablePackage(root, name)
  if (packageInfo.version !== version) {
    throw new Error(`Tag ${tag} does not match ${name}@${packageInfo.version} in package.json`)
  }
  const changelog = readFileSync(join(packageInfo.dir, 'CHANGELOG.md'), 'utf8')
  return { title: tag, notes: extractChangelogSection(changelog, version) }
}

/**
 * Перетворює release-workspaces на package-теги за поточними manifests.
 * @param {string} root абсолютний корінь репозиторію
 * @param {string[]} workspaces відносні шляхи workspace-ів із release engine
 * @returns {string[]} package-теги у порядку вхідних workspace-ів
 */
export function releaseTagsForWorkspaces(root, workspaces) {
  if (!Array.isArray(workspaces)) throw new Error('Release workspaces must be an array')
  return workspaces.map(workspace => {
    if (typeof workspace !== 'string' || workspace === '' || workspace.split('/').some(part => part === '.' || part === '..')) {
      throw new Error(`Unsupported workspace path: ${workspace}`)
    }
    const manifest = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'))
    if (manifest.private === true || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`Workspace is not publishable: ${workspace}`)
    }
    return `${manifest.name}@${manifest.version}`
  })
}

/**
 * Записує release notes у переданий шлях для GitHub Actions workflow.
 * @param {string[]} args CLI аргументи: tag і абсолютний шлях notes-файлу
 * @returns {void}
 */
export function run(args) {
  if (args[0] === '--tags') {
    if (args.length !== 2) throw new Error('Usage: github-package-release.mjs --tags <json-array>')
    const tags = JSON.parse(args[1])
    if (!Array.isArray(tags)) throw new Error('Release tags must be an array')
    for (const tag of tags) console.log(parsePackageTag(tag).name + '@' + parsePackageTag(tag).version)
    return
  }
  const [tag, notesPath] = args
  if (!tag || !notesPath) throw new Error('Usage: github-package-release.mjs <package-tag> <notes-path>')
  const release = prepareGitHubRelease(process.cwd(), tag)
  writeFileSync(notesPath, `${release.notes}\n`, 'utf8')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run(process.argv.slice(2))
