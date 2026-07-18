/** @see ./docs/uv-diff.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

import { isBreaking } from '@7n/rules/plugin-api'

/** Дефолтний суфікс бекапу — той самий, що й для package.json/Cargo.toml. */
const DEFAULT_BACKUP_SUFFIX = '.taze-bak'

// Ім'я пакета (PEP 508: літери/цифри/`._-`) + опційні `[extras]` + решта
// (версійний specifier, можливо з `; marker` — ігнорується, не наш скоуп).
const PEP508_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*])?\s*([^;]*)/

/**
 * Парсить один PEP 508-рядок залежності (`"typer>=0.19.1,<0.20.0"`,
 * `"strawberry-graphql[asgi]>=0.282.0"`) на ім'я/extras/specifier.
 * @param {string} requirement рядок із `[project].dependencies`
 * @returns {{name: string, extras: string[], specifier: string}|null} розбір, або null для невалідного рядка
 */
export function parsePep508(requirement) {
  if (typeof requirement !== 'string') return null
  const m = PEP508_RE.exec(requirement)
  if (!m) return null
  const extras = m[2]
    ? m[2]
        .slice(1, -1)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : []
  return { name: m[1], extras, specifier: (m[3] ?? '').trim() }
}

// 1-3 числові компоненти PEP 440 (`"1"`, `"0.4"`, `"1.2.3"`), без урахування
// pre/post/dev-суфіксів (поза скоупом major/minor/patch-класифікації).
const PEP440_VERSION_RE = /^[\s=><~!]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/
// Операторний префікс версійного сегмента (`>=`, `==`, `~=`, `!=` тощо) — для відсікання при витягуванні голої версії.
const VERSION_OPERATOR_PREFIX_RE = /^[>=~!]+/

/**
 * Парсить ядро PEP 440-версії (major.minor.patch, відсутні компоненти → 0).
 * @param {string} spec версійний рядок (сегмент specifier-а, без операторного префікса)
 * @returns {{major:number, minor:number, patch:number}|null} ядро або null для не-версії
 */
export function parsePep440Version(spec) {
  if (typeof spec !== 'string') return null
  const m = PEP440_VERSION_RE.exec(spec)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0) }
}

/**
 * Дістає нижню межу версійного specifier-а (перший сегмент `>=`/`==`/`~=`
 * серед comma-separated списку, напр. `">=0.19.1,<0.20.0"` → `"0.19.1"`).
 * Саме нижня межа відповідає версії, яку реально ставить `uv add --bounds lower`.
 * @param {string} specifier версійний specifier із `parsePep508`
 * @returns {string|null} версія нижньої межі, або null якщо немає жодного `>=`/`==`/`~=`-сегмента
 */
export function extractLowerBoundVersion(specifier) {
  if (!specifier) return null
  const clause = specifier
    .split(',')
    .map(s => s.trim())
    .find(c => c.startsWith('>=') || c.startsWith('==') || c.startsWith('~='))
  return clause ? clause.replace(VERSION_OPERATOR_PREFIX_RE, '').trim() : null
}

/**
 * Порівнює `[project].dependencies` двох pyproject.toml — той самий контракт,
 * що й `diffPackageJson`/`diffCargoToml` ядра. Матчинг по ІМЕНІ пакета (не по
 * позиції в масиві — PEP 621 `dependencies` це список PEP 508-рядків, не
 * мапа ім'я→версія).
 * @param {object} oldManifest розпарсений старий pyproject.toml (бекап)
 * @param {object} newManifest розпарсений новий pyproject.toml
 * @param {string} manifest відносний шлях pyproject.toml (мітка джерела запису)
 * @returns {{major: Array<{manifest:string, pkg:string, from:string, to:string}>, minorPatch:number}} зміни
 */
export function diffPyprojectDeps(oldManifest, newManifest, manifest) {
  const oldDeps = oldManifest?.project?.dependencies ?? []
  const newByName = new Map()
  for (const requirement of newDeps(newManifest)) {
    const parsed = parsePep508(requirement)
    if (parsed) newByName.set(parsed.name, parsed)
  }

  const major = []
  let minorPatch = 0
  for (const oldRequirement of oldDeps) {
    const oldParsed = parsePep508(oldRequirement)
    if (!oldParsed) continue
    const newParsed = newByName.get(oldParsed.name)
    if (!newParsed || newParsed.specifier === oldParsed.specifier) continue

    const from = extractLowerBoundVersion(oldParsed.specifier)
    const to = extractLowerBoundVersion(newParsed.specifier)
    if (from === null || to === null || from === to) continue

    const fromV = parsePep440Version(from)
    const toV = parsePep440Version(to)
    if (fromV && toV && isBreaking(fromV, toV)) {
      major.push({ manifest, pkg: oldParsed.name, from, to })
    } else {
      minorPatch += 1
    }
  }
  return { major, minorPatch }
}

/**
 * @param {object} manifest розпарсений pyproject.toml
 * @returns {string[]} `[project].dependencies` (порожній масив, якщо відсутнє)
 */
function newDeps(manifest) {
  return manifest?.project?.dependencies ?? []
}

/**
 * Читає й парсить TOML-файл, або повертає null, якщо файл відсутній/невалідний.
 * @param {string} path абсолютний шлях
 * @returns {Promise<object|null>} розпарсений обʼєкт або null
 */
async function readTomlOrNull(path) {
  if (!existsSync(path)) return null
  try {
    return parseToml(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Збирає diff по pyproject.toml: порівнює `<cwd>/pyproject.toml` з
 * `<cwd>/pyproject.toml<backupSuffix>` — той самий контракт, що й
 * `collectTazeDiff`/`collectCargoDiff` ядра.
 * @param {string} cwd корінь репозиторію (де лежить pyproject.toml — uv-конвенція: один кореневий файл, не per-crate, як Cargo.toml)
 * @param {string} [backupSuffix] суфікс бекап-файлу
 * @returns {Promise<{major: Array<{manifest:string, pkg:string, from:string, to:string}>, minorPatch:number, totalChanged:number, comparedManifests:number}>} агрегований diff
 */
export async function collectUvDiff(cwd, backupSuffix = DEFAULT_BACKUP_SUFFIX) {
  const oldManifest = await readTomlOrNull(join(cwd, `pyproject.toml${backupSuffix}`))
  const newManifest = await readTomlOrNull(join(cwd, 'pyproject.toml'))
  if (!oldManifest || !newManifest) {
    return { major: [], minorPatch: 0, totalChanged: 0, comparedManifests: 0 }
  }
  const res = diffPyprojectDeps(oldManifest, newManifest, 'pyproject.toml')
  return {
    major: res.major,
    minorPatch: res.minorPatch,
    totalChanged: res.major.length + res.minorPatch,
    comparedManifests: 1
  }
}

/**
 * Дістає `{name, extras, raw}` кожної прямої залежності з
 * `[project].dependencies` поточного pyproject.toml — вхід для
 * per-пакетного bump-циклу (`uv` немає єдиної команди "підняти все до
 * latest, навіть через major", на відміну від `bunx taze -w -r latest`/
 * `cargo upgrade --incompatible allow` — підтверджено емпірично: `uv add
 * <pkg>` на вже присутній залежності НЕ переписує specifier, поки не буде
 * `uv remove` спершу). `raw` — оригінальний PEP 508-рядок, потрібен для
 * best-effort відновлення, якщо `uv add` після `uv remove` не вдався.
 * @param {object} manifest розпарсений pyproject.toml
 * @returns {Array<{name: string, extras: string[], raw: string}>} прямі залежності
 */
export function listDirectDependencies(manifest) {
  return newDeps(manifest)
    .map(requirement => {
      const parsed = parsePep508(requirement)
      return parsed ? { ...parsed, raw: requirement } : null
    })
    .filter(Boolean)
    .map(({ name, extras, raw }) => ({ name, extras, raw }))
}
