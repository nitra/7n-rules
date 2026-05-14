/**
 * Запуск kubeconform та kubescape для каталогів `…/k8s`, де є YAML-маніфести (див. k8s.mdc).
 *
 * Знаходить унікальні корені каталогів із іменем `k8s` за шляхами файлів **`*.yaml`**
 * (той самий принцип сегмента `k8s`, що й у check-k8s.mjs; розширення **`.yml`** під `k8s` не використовується). Якщо таких файлів немає — вихід 0
 * без виклику зовнішніх CLI.
 *
 * kubeconform перевіряє маніфести проти OpenAPI-схем Kubernetes; kubescape — сканування на
 * misconfiguration / compliance (NSA, MITRE, CIS тощо). Обидві утиліти очікуються в PATH
 * (локально: Homebrew, релізи GitHub; у CI — крок установки з k8s.mdc).
 *
 * Версія `-kubernetes-version` для kubeconform узгоджена з PIN yannh у check-k8s.mjs / k8s.mdc.
 * Kubescape не має аналога цього прапорця; орієнтир цільового кластера — та сама лінія релізу (див. k8s.mdc).
 */
import { spawnSync } from 'node:child_process'
import { basename, dirname, relative } from 'node:path'

import { isRunAsCli } from './cli-entry.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

const PATH_SEPARATOR_RE = /[/\\]/u
const YAML_EXT_RE = /\.yaml$/iu

/** Версія Kubernetes для kubeconform — синхронно з YANNH_PIN (без префікса v і суфікса -standalone-strict). */
const KUBERNETES_VERSION = '1.33.9'

/** Додатковий реєстр схем для CRD (як у README kubeconform). */
const DATREE_CRD_SCHEMA_LOCATION =
  'https://datreeio.github.io/CRDs-catalog/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'

/**
 * Чи містить шлях сегмент директорії `k8s` (відносно `root`, якщо передано).
 *
 * Якщо корінь репо сам має компонент `k8s` (напр. `/Users/.../abie/k8s/`), без relativize
 * функція повертала б true для **усіх** файлів проєкту — включно з `.github/workflows/*.yml`,
 * які належать `ga.mdc`. Передавай `root` у викликах з walkDir щоб уникнути false-positive.
 * @param {string} filePath абсолютний або відносний шлях до файлу
 * @param {string} [root] корінь репо для relativize (типово — без relativize)
 * @returns {boolean} true, якщо серед компонентів шляху **відносно root** є каталог `k8s`
 */
export function pathHasK8sSegment(filePath, root) {
  const target = root ? relative(root, filePath).replaceAll('\\', '/') : filePath
  if (target === '') return false
  const parts = target.split(PATH_SEPARATOR_RE)
  return parts.includes('k8s')
}

/**
 * Каталог `…/k8s`, що містить маніфест (йдемо вгору від файлу до компонента `k8s`).
 * @param {string} absFile абсолютний шлях до yaml
 * @returns {string | null} абсолютний шлях до `…/k8s` або null, якщо сегмента `k8s` у ланцюжку немає
 */
export function k8sRootFromFile(absFile) {
  let dir = dirname(absFile)
  for (let i = 0; i < 64; i++) {
    if (basename(dir) === 'k8s') return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Унікальні корені `k8s` за наявності `*.yaml` під деревом cwd.
 * @param {string} root корінь репозиторію
 * @param {string[]} [ignorePaths] абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи до каталогів `k8s`
 */
export async function findK8sRoots(root, ignorePaths = []) {
  /** @type {Set<string>} */
  const roots = new Set()
  await walkDir(
    root,
    p => {
      const rel = relative(root, p).replaceAll('\\', '/')
      // `.github/` належить `ga.mdc`; kubeconform/kubescape там не запускаємо.
      if (rel.startsWith('.github/')) return
      if (!pathHasK8sSegment(p, root)) return
      if (!YAML_EXT_RE.test(p)) return
      const k8sRoot = k8sRootFromFile(p)
      if (k8sRoot) roots.add(k8sRoot)
    },
    ignorePaths
  )
  return [...roots].toSorted((a, b) => a.localeCompare(b))
}

/**
 * Запускає kubeconform для переліку каталогів.
 * @param {string[]} dirs абсолютні шляхи до `…/k8s`
 * @returns {number} код виходу процесу kubeconform (127, якщо kubeconform відсутній у PATH)
 */
function runKubeconform(dirs) {
  const args = [
    '-summary',
    '-kubernetes-version',
    KUBERNETES_VERSION,
    '-schema-location',
    'default',
    '-schema-location',
    DATREE_CRD_SCHEMA_LOCATION,
    '-ignore-missing-schemas',
    ...dirs
  ]
  const kubeconformPath = resolveCmd('kubeconform')
  if (!kubeconformPath) {
    console.error('kubeconform не знайдено в PATH. Встанови з https://github.com/yannh/kubeconform#readme')
    return 127
  }
  const r = spawnSync(kubeconformPath, args, { stdio: 'inherit', shell: false })
  if (r.error && 'code' in r.error && r.error.code === 'ENOENT') {
    console.error('kubeconform не знайдено в PATH. Встанови з https://github.com/yannh/kubeconform#readme')
    return 127
  }
  return r.status ?? 1
}

/**
 * Запускає kubescape scan для кожного каталогу окремо (узгоджено з прикладами CLI).
 * Немає прапорця версії Kubernetes — за потреби додай `scan framework <ім’я>` під CIS/інші набори.
 * @param {string[]} dirs абсолютні шляхи до `…/k8s`
 * @returns {number} 0 при успіху, інакше код останнього невдалого scan або 127, якщо kubescape відсутній у PATH
 */
function runKubescape(dirs) {
  for (const d of dirs) {
    const kubescapePath = resolveCmd('kubescape')
    if (!kubescapePath) {
      console.error('kubescape не знайдено в PATH. Встанови з https://github.com/kubescape/kubescape#readme')
      return 127
    }
    const r = spawnSync(kubescapePath, ['scan', d, '--severity-threshold', 'high'], {
      stdio: 'inherit',
      shell: false
    })
    if (r.error && 'code' in r.error && r.error.code === 'ENOENT') {
      console.error('kubescape не знайдено в PATH. Встанови з https://github.com/kubescape/kubescape#readme')
      return 127
    }
    if (r.status !== 0) return r.status ?? 1
  }
  return 0
}

/**
 * Головна точка входу: kubeconform + kubescape для усіх знайдених дерев `k8s`.
 * @returns {Promise<number>} код виходу для `process.exitCode` (0 — успіх або пропуск)
 */
async function main() {
  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)
  const dirs = await findK8sRoots(root, ignorePaths)

  if (dirs.length === 0) {
    console.log('run-k8s: немає *.yaml під k8s — kubeconform і kubescape пропущено')
    return 0
  }

  console.log(`run-k8s: каталоги k8s (${dirs.length}):`)
  for (const d of dirs) console.log(`  ${d}`)

  const kc = runKubeconform(dirs)
  if (kc !== 0) return kc

  const ks = runKubescape(dirs)
  return ks
}

if (isRunAsCli()) {
  process.exitCode = await main()
}
