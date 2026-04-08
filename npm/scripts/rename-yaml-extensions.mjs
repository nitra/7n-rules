/**
 * Перейменовує розширення YAML за домовленістю репозиторію (k8s.mdc, ga.mdc). Лише логіка; **CLI** — **`bin/rename-yaml-extensions.mjs`**
 * та підкоманда **`npx \@nitra/cursor rename-yaml-extensions`**.
 *
 * - Файли з сегментом шляху `k8s` та суфіксом `.yml` → `.yaml` (маніфести під k8s).
 * - Файли з сегментом `.github` та суфіксом `.yaml` → `.yml` (workflows тощо; у workflows лише `.yml`).
 *
 * Обхід з пропуском `node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next` — як у **`walkDir`**.
 *
 * Розбір аргументів для CLI: **`parseRenameYamlArgs`** (`--dry-run`, `--root=…`).
 */
import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { cwd } from 'node:process'
import { relative, resolve } from 'node:path'

import { walkDir } from './utils/walkDir.mjs'

/**
 * Відносний шлях від кореня з `/`; `null`, якщо поза root.
 * @param {string} rootAbs абсолютний корінь
 * @param {string} fileAbs абсолютний шлях до файлу
 * @returns {string | null} відносний шлях з `/` або null, якщо fileAbs поза rootAbs
 */
export function posixRelFromRoot(rootAbs, fileAbs) {
  const r = (relative(rootAbs, resolve(fileAbs)) || fileAbs).replaceAll('\\', '/')
  if (r.startsWith('..')) return null
  return r
}

/**
 * Чи шлях підходить під k8s-маніфести: є сегмент `k8s`, суфікс `.yml` (регістр розширення ігнорується).
 * @param {string} relPosix відносний шлях
 * @returns {boolean} true, якщо є сегмент k8s і суфікс .yml
 */
export function pathMatchesK8sYml(relPosix) {
  if (!/\.yml$/iu.test(relPosix)) return false
  return relPosix.split('/').includes('k8s')
}

/**
 * Чи шлях підходить під `.github`: є сегмент `.github`, суфікс `.yaml` (регістр розширення ігнорується).
 * @param {string} relPosix відносний шлях
 * @returns {boolean} true, якщо є сегмент .github і суфікс .yaml
 */
export function pathMatchesGithubYaml(relPosix) {
  if (!/\.yaml$/iu.test(relPosix)) return false
  return relPosix.split('/').includes('.github')
}

/**
 * Замінює останнє розширення файлу на **newExt** (з крапкою, наприклад **`.yaml`**).
 * @param {string} relPosix відносний шлях
 * @param {string} newExt нове розширення
 * @returns {string} шлях з останнім розширенням, заміненим на newExt
 */
export function replaceExtension(relPosix, newExt) {
  const m = relPosix.match(/^(.+)(\.[^./\\]+)$/u)
  if (!m) return relPosix + newExt
  return m[1] + newExt
}

/**
 * Збирає операції перейменування (без виконання).
 * @param {string} rootAbs абсолютний корінь репозиторію
 * @returns {Promise<Array<{ kind: 'k8s' | 'github', fromAbs: string, toAbs: string, relFrom: string, relTo: string }>>} відсортовані операції перейменування без запису на диск
 */
async function collectRenameOps(rootAbs) {
  /** @type {Array<{ kind: 'k8s' | 'github', fromAbs: string, toAbs: string, relFrom: string, relTo: string }>} */
  const ops = []

  await walkDir(rootAbs, fileAbs => {
    const rel = posixRelFromRoot(rootAbs, fileAbs)
    if (rel === null) return
    if (pathMatchesK8sYml(rel)) {
      const relTo = replaceExtension(rel, '.yaml')
      if (relTo === rel) return
      ops.push({
        kind: 'k8s',
        fromAbs: resolve(rootAbs, rel),
        toAbs: resolve(rootAbs, relTo),
        relFrom: rel,
        relTo
      })
      return
    }
    if (pathMatchesGithubYaml(rel)) {
      const relTo = replaceExtension(rel, '.yml')
      if (relTo === rel) return
      ops.push({
        kind: 'github',
        fromAbs: resolve(rootAbs, rel),
        toAbs: resolve(rootAbs, relTo),
        relFrom: rel,
        relTo
      })
    }
  })

  ops.sort((a, b) => {
    const ko = (a.kind === 'k8s' ? 0 : 1) - (b.kind === 'k8s' ? 0 : 1)
    if (ko !== 0) return ko
    return a.relFrom.localeCompare(b.relFrom)
  })

  return ops
}

/**
 * Виконує перейменування за правилами k8s / .github.
 * @param {string} root корінь обходу (відносний або абсолютний)
 * @param {{ dryRun?: boolean }} [options] опції: лише симуляція без `rename`, якщо dryRun true
 * @returns {Promise<{ renamed: { relFrom: string, relTo: string }[], errors: string[] }>} списки успішних перейменувань і текстів помилок
 */
export async function renameYamlExtensions(root, options = {}) {
  const dryRun = options.dryRun === true
  const rootAbs = resolve(root)
  const ops = await collectRenameOps(rootAbs)

  /** @type { { relFrom: string, relTo: string }[]} */
  const renamed = []
  /** @type {string[]} */
  const errors = []

  for (const op of ops) {
    if (!existsSync(op.fromAbs)) {
      errors.push(`${op.relFrom}: файл зник перед перейменуванням`)
    } else if (existsSync(op.toAbs)) {
      errors.push(`${op.relFrom} → ${op.relTo}: цільовий файл уже існує, пропущено`)
    } else if (dryRun) {
      renamed.push({ relFrom: op.relFrom, relTo: op.relTo })
    } else {
      try {
        await rename(op.fromAbs, op.toAbs)
        renamed.push({ relFrom: op.relFrom, relTo: op.relTo })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.push(`${op.relFrom}: ${msg}`)
      }
    }
  }

  return { renamed, errors }
}

/**
 * Розбір CLI: **`--dry-run`**, **`--root=...`**.
 * @param {string[]} argv зазвичай **`process.argv.slice(2)`**
 * @returns {{ dryRun: boolean, root: string }} прапор симуляції та абсолютний корінь обходу
 */
export function parseRenameYamlArgs(argv) {
  let dryRun = false
  let root = cwd()
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true
    else if (a.startsWith('--root=')) root = resolve(a.slice('--root='.length))
  }
  return { dryRun, root }
}
