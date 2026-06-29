/**
 * Обхід k8s-дерева abie з кешуванням на час одного прогону:
 *   - `findK8sYamlFiles(root, ignorePaths)` — yaml/yml файли під сегментом `k8s/`.
 *   - `collectDeploymentDirs(root, yamlAbs)` — каталоги, де знайдено `kind: Deployment`.
 *
 * Кеш — module-level singleton, ключований за `(root, ignorePaths)`. Перший виклик
 * платить за обхід; наступні концерни в межах того ж прогону отримують готове.
 */
import { dirname, relative } from 'node:path'

import { pathHasK8sSegment } from '../../k8s/manifests/main.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { isDeploymentDoc, readAndParseYamlDocs } from './yaml.mjs'

const YAML_EXTENSION_RE = /\.ya?ml$/iu

/** @type {Map<string, Promise<string[]>>} */
const yamlCache = new Map()
/** @type {Map<string, Promise<Set<string>>>} */
const deploymentCache = new Map()

/**
 * Стабільний ключ кешу за (root, ignorePaths).
 * @param {string} root опис.
 * @param {string[]} ignorePaths опис.
 * @returns {string} результат
 */
function cacheKey(root, ignorePaths) {
  return `${root}|${[...ignorePaths].toSorted((a, b) => a.localeCompare(b)).join(':')}`
}

/**
 * Збирає абсолютні шляхи до `.yaml`/`.yml` під деревом, де є сегмент `k8s/`.
 * Каталог `.github/` свідомо пропускається (належить `ga.mdc`).
 * @param {string} root корінь репозиторію
 * @param {string[]} [ignorePaths] абсолютні шляхи каталогів-виключень
 * @returns {Promise<string[]>} результат
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
/**
 * No-op fail-handler за замовчуванням для `collectDeploymentDirs` — пошкоджені YAML
 * під час cross-rule сканування мовчки пропускаються; формальний reporter передає сам caller.
 * @param {string} _msg повідомлення про помилку (ігнорується)
 */
const silentFail = _msg => {
  // noop
}

/**
 * Знаходить унікальні каталоги, що містять Deployment-маніфести серед переданих YAML-файлів.
 * Парсить документи через `readAndParseYamlDocs` і фільтрує лише ті, що є Deployment.
 * Кешує результат за ключем `root|<sorted yamlAbs>`, щоб повторні виклики не робили I/O.
 * @param {string} root абсолютний корінь репо для побудови relative-шляхів у повідомленнях
 * @param {string[]} yamlAbs абсолютні шляхи до YAML-файлів для перевірки
 * @param {(msg: string) => void} [fail] callback на помилку парсингу (за замовчуванням noop)
 * @returns {Promise<Set<string>>} проміс із сетом абсолютних каталогів, де знайдено Deployment
 */
export function collectDeploymentDirs(root, yamlAbs, fail = silentFail) {
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
