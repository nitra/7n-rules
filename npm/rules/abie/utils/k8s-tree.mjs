/**
 * Обхід k8s-дерева abie з кешуванням на час одного прогону:
 *   - `findK8sYamlFiles(root, ignorePaths)` — yaml/yml файли під сегментом `k8s/`.
 *   - `collectDeploymentDirs(root, yamlAbs)` — каталоги, де знайдено `kind: Deployment`.
 *
 * Кеш — module-level singleton, ключований за `(root, ignorePaths)`. Перший виклик
 * платить за обхід; наступні концерни в межах того ж прогону отримують готове.
 * Для тестів — `resetAbieK8sTreeCache()` (інакше withTmpCwd-фікстури злипатимуться).
 */
import { dirname, relative } from 'node:path'

import { pathHasK8sSegment } from '../../k8s/js/check.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { isDeploymentDoc, readAndParseYamlDocs } from './yaml.mjs'

const YAML_EXTENSION_RE = /\.ya?ml$/iu

/** @type {Map<string, Promise<string[]>>} */
const yamlCache = new Map()
/** @type {Map<string, Promise<Set<string>>>} */
const deploymentCache = new Map()

/**
 * Скидає кеш — тести мусять викликати між фікстурами.
 * @returns {void}
 */
export function resetAbieK8sTreeCache() {
  yamlCache.clear()
  deploymentCache.clear()
}

/**
 * Стабільний ключ кешу за (root, ignorePaths).
 * @param {string} root
 * @param {string[]} ignorePaths
 * @returns {string}
 */
function cacheKey(root, ignorePaths) {
  return `${root}|${[...ignorePaths].toSorted((a, b) => a.localeCompare(b)).join(':')}`
}

/**
 * Збирає абсолютні шляхи до `.yaml`/`.yml` під деревом, де є сегмент `k8s/`.
 * Каталог `.github/` свідомо пропускається (належить `ga.mdc`).
 * @param {string} root корінь репозиторію
 * @param {string[]} [ignorePaths] абсолютні шляхи каталогів-виключень
 * @returns {Promise<string[]>}
 */
export function findK8sYamlFiles(root, ignorePaths = []) {
  const key = cacheKey(root, ignorePaths)
  const cached = yamlCache.get(key)
  if (cached) return cached
  const promise = (async () => {
    /** @type {string[]} */
    const out = []
    await walkDir(
      root,
      p => {
        const rel = relative(root, p).replaceAll('\\', '/')
        if (rel.startsWith('.github/')) return
        if (!pathHasK8sSegment(p, root)) return
        if (!YAML_EXTENSION_RE.test(p)) return
        out.push(p)
      },
      ignorePaths
    )
    return [...out].toSorted((a, b) => a.localeCompare(b))
  })()
  yamlCache.set(key, promise)
  return promise
}

/**
 * Каталоги, де є хоча б один `kind: Deployment` у YAML під `k8s/`.
 * @param {string} root корінь репозиторію
 * @param {string[]} yamlAbs абсолютні шляхи `.yaml`/`.yml` під `k8s/` (як з `findK8sYamlFiles`)
 * @param {(msg: string) => void} [fail] репортер помилок парсингу (опц.)
 * @returns {Promise<Set<string>>} абсолютні шляхи директорій
 */
export function collectDeploymentDirs(root, yamlAbs, fail = () => {}) {
  const key = `${root}|${[...yamlAbs].toSorted((a, b) => a.localeCompare(b)).join(':')}`
  const cached = deploymentCache.get(key)
  if (cached) return cached
  const promise = (async () => {
    /** @type {Set<string>} */
    const dirs = new Set()
    for (const abs of yamlAbs) {
      const rel = relative(root, abs).replaceAll('\\', '/') || abs
      const docs = await readAndParseYamlDocs(abs, rel, fail)
      if (docs) {
        for (const doc of docs) {
          if (doc.errors.length === 0 && isDeploymentDoc(doc.toJSON())) {
            dirs.add(dirname(abs))
          }
        }
      }
    }
    return dirs
  })()
  deploymentCache.set(key, promise)
  return promise
}
