/**
 * `n-cursor release` — агрегує per-workspace change-файли у version-bump + CHANGELOG,
 * комітить, ставить тег `<name>@<version>`, видаляє use-up change-файли. Запускається
 * у CI на `main` (n-cursor-release-design, варіант A). Сам нічого не публікує.
 */
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getMonorepoProjectRootDirs, readPackageManifest } from '../changelog/lib/package-manifest.mjs'
import { aggregateWorkspace, prependChangelogSection } from './lib/aggregate.mjs'
import { CHANGES_DIR, readChangeFiles } from './lib/change-file.mjs'
import { defaultRunGit, synthesizeChangeFromCommits } from './lib/fallback.mjs'

const SEMVER_LINE_RE = /("version"\s*:\s*")[^"]*(")/
const PY_VERSION_LINE_RE = /^(version\s*=\s*")[^"]*(")/m

/**
 * Записує нову version у маніфест, зберігаючи форматування файлу.
 * @param {string} cwd корінь
 * @param {import('../changelog/lib/package-manifest.mjs').PackageManifest} manifest маніфест
 * @param {string} newVersion нова версія
 * @returns {Promise<void>} результат
 */
async function writeManifestVersion(cwd, manifest, newVersion) {
  const path = join(cwd, manifest.ws === '.' ? manifest.manifestRel : `${manifest.ws}/${manifest.manifestRel}`)
  const text = await readFile(path, 'utf8')
  const re = manifest.kind === 'npm' ? SEMVER_LINE_RE : PY_VERSION_LINE_RE
  const replaced = text.replace(re, `$1${newVersion}$2`)
  if (replaced === text) {
    throw new Error(
      `release: не вдалося оновити version у ${manifest.ws}/${manifest.manifestRel} — патерн version не знайдено`
    )
  }
  await writeFile(path, replaced)
}

/**
 * @param {string} cwd корінь
 * @param {string} ws workspace
 * @param {string} sectionBlock новий блок CHANGELOG
 * @returns {Promise<void>} результат
 */
async function prependWorkspaceChangelog(cwd, ws, sectionBlock) {
  const path = join(cwd, ws, 'CHANGELOG.md')
  const existing = existsSync(path) ? await readFile(path, 'utf8') : ''
  await writeFile(path, prependChangelogSection(existing, sectionBlock))
}

/**
 * Зібрати change-файли workspace (явні + fallback-синтез, якщо явних нема, але є коміти).
 * @param {string} cwd корінь
 * @param {import('../changelog/lib/package-manifest.mjs').PackageManifest} manifest маніфест
 * @param {(args: string[]) => Promise<string | null>} runGit git-раннер
 * @returns {Promise<Array<{ file: string | null, entry: { bump: string, section: string, description: string } }>>} change-файли
 */
async function collectChangeFiles(cwd, manifest, runGit) {
  const explicit = await readChangeFiles(manifest.ws, cwd)
  if (explicit.length > 0) return explicit
  if (!manifest.name) return []
  const synthesized = await synthesizeChangeFromCommits(manifest.name, manifest.ws, { runGit })
  if (!synthesized) return []
  console.warn(`⚠️  ${manifest.ws}: немає change-файлів — синтезовано запис із комітів (fallback)`)
  return [{ file: null, entry: synthesized }]
}

/**
 * Пушить release-коміт (із тегами) у апстрім, переживаючи паралельні push у ту саму гілку.
 * `runGit` — ТИХИЙ раннер (повертає null при помилці), тож non-fast-forward push не кидає, а
 * повертає null; цей хелпер ЯВНО перевіряє результат, щоб реліз не «вдався» без приземленого
 * commit-back (саме така мовчазна поразка лишала npm попереду git). За відмовою push:
 * fetch + rebase release-коміту на свіжий апстрім, пересунути теги на новий HEAD і повторити
 * (до `attempts` разів). Без апстріму або при rebase-конфлікті — кидаємо, а не маскуємо.
 * @param {(args: string[]) => Promise<string | null>} runGit git-раннер
 * @param {string[]} tags теги релізу (вже створені на поточному HEAD)
 * @param {number} [attempts] максимум спроб push
 * @returns {Promise<void>} результат; кидає, якщо push так і не приземлився
 */
async function pushReleaseWithRetry(runGit, tags, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const pushed = await runGit(['push', '--follow-tags'])
    if (pushed !== null) return
    if (attempt === attempts) break
    // push відхилено (найімовірніше non-fast-forward — апстрім пішов уперед) → інтегруємо й пробуємо ще
    const upstream = (await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))?.trim()
    if (!upstream) {
      throw new Error('release: git push відхилено, а upstream для rebase немає — commit-back не приземлився')
    }
    const remote = upstream.includes('/') ? upstream.slice(0, upstream.indexOf('/')) : 'origin'
    await runGit(['fetch', remote])
    const rebased = await runGit(['rebase', upstream])
    if (rebased === null) {
      await runGit(['rebase', '--abort'])
      throw new Error(`release: push відхилено і rebase на ${upstream} дав конфлікт — розв'яжи вручну`)
    }
    // після rebase хеш release-коміту змінився → пересуваємо теги на новий HEAD
    for (const tag of tags) {
      await runGit(['tag', '-f', tag])
    }
  }
  throw new Error(
    `release: git push не вдався після ${attempts} спроб (non-fast-forward?) — commit-back не приземлився, реліз неуспішний`
  )
}

/**
 * @param {object} [opts] опції
 * @param {string} [opts.cwd] корінь
 * @param {string} [opts.date] `YYYY-MM-DD` (за замовчуванням сьогодні)
 * @param {(args: string[]) => Promise<string | null>} [opts.runGit] git-раннер
 * @returns {Promise<Array<{ ws: string, name: string | null, newVersion: string }>>} зрелізовані пакети
 */
export async function release(opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  const runGit = opts.runGit ?? defaultRunGit(cwd)

  const workspaces = await getMonorepoProjectRootDirs(cwd)
  const subWorkspaces = workspaces.filter(w => w !== '.')
  const isMonorepoRoot = subWorkspaces.length > 0

  /** @type {Array<{ ws: string, name: string | null, newVersion: string }>} */
  const released = []
  const tags = []

  for (const ws of workspaces) {
    if (ws === '.' && isMonorepoRoot) continue
    const manifest = await readPackageManifest(ws, cwd)
    if (!manifest || !manifest.version) continue

    const changeFiles = await collectChangeFiles(cwd, manifest, runGit)
    const agg = aggregateWorkspace({ currentVersion: manifest.version, changeFiles, date })
    if (!agg) continue

    await writeManifestVersion(cwd, manifest, agg.newVersion)
    await prependWorkspaceChangelog(cwd, ws, agg.sectionBlock)
    for (const file of agg.consumedFiles.filter(Boolean)) {
      await rm(join(cwd, ws, CHANGES_DIR, file))
    }
    released.push({ ws, name: manifest.name, newVersion: agg.newVersion })
    if (manifest.name) tags.push(`${manifest.name}@${agg.newVersion}`)
  }

  if (released.length > 0) {
    const subject = tags.length > 0 ? tags.join(', ') : released.map(r => `${r.ws}@${r.newVersion}`).join(', ')
    await runGit(['add', '-A'])
    const committed = await runGit(['commit', '-m', `release: ${subject}`])
    if (committed === null) {
      throw new Error('release: git commit не вдався — теги та push скасовано')
    }
    for (const tag of tags) {
      await runGit(['tag', tag])
    }
    await pushReleaseWithRetry(runGit, tags)
  }
  return released
}

/**
 * @param {string[]} _args аргументи CLI (наразі без опцій)
 * @param {import('./release.mjs').ReleaseOpts} [opts] опції для тестів (cwd, date, runGit)
 * @returns {Promise<number>} exit-код
 */
export async function runReleaseCli(_args, opts = {}) {
  try {
    const released = await release(opts)
    if (released.length === 0) {
      console.log('release: немає змін для релізу')
    } else {
      for (const r of released) console.log(`✅ ${r.name ?? r.ws}@${r.newVersion}`)
    }
    return 0
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
