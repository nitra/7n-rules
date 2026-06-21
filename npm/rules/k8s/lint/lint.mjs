/**
 * Запуск kubeconform та kubescape для каталогів `…/k8s`, де є YAML-маніфести (див. k8s.mdc).
 *
 * Знаходить унікальні корені каталогів із іменем `k8s` за шляхами файлів **`*.yaml`**
 * (той самий принцип сегмента `k8s`, що й у rules/k8s/check.mjs; розширення **`.yml`** під `k8s` не використовується). Якщо таких файлів немає — вихід 0
 * без виклику зовнішніх CLI.
 *
 * kubeconform перевіряє маніфести проти OpenAPI-схем Kubernetes; kubescape — сканування на
 * misconfiguration / compliance (NSA, MITRE, CIS тощо). Обидві утиліти очікуються в PATH
 * (локально: Homebrew, релізи GitHub; у CI — крок установки з k8s.mdc).
 *
 * Версія `-kubernetes-version` для kubeconform узгоджена з PIN yannh у rules/k8s/check.mjs / k8s.mdc.
 * Kubescape не має аналога цього прапорця; орієнтир цільового кластера — та сама лінія релізу (див. k8s.mdc).
 *
 * Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) —
 * `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'

import { parse } from 'yaml'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'

/** Per-project kubescape exceptions file; підмішується через --exceptions, якщо існує в корені. */
const KUBESCAPE_EXCEPTIONS_FILE = '.kubescape-exceptions.json'

/** Назва kustomization-файлу (під `k8s` дозволено лише `.yaml`, див. k8s.mdc). */
const KUSTOMIZATION_FILE = 'kustomization.yaml'

/** Підказка встановлення kubescape (PATH miss / ENOENT). */
const KUBESCAPE_MISSING_HINT = 'kubescape не знайдено в PATH. Встанови з https://github.com/kubescape/kubescape#readme'

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
  const kubeconformPath = ensureTool('kubeconform')
  const r = spawnSync(kubeconformPath, args, { stdio: 'inherit', shell: false })
  if (r.error && 'code' in r.error && r.error.code === 'ENOENT') {
    console.error('kubeconform не знайдено в PATH. Встанови з https://github.com/yannh/kubeconform#readme')
    return 127
  }
  return r.status ?? 1
}

/**
 * Будує аргументи `--exceptions <file>` для kubescape, якщо в корені проєкту є
 * `.kubescape-exceptions.json`. Інакше — порожній масив.
 * @param {string} root корінь репозиторію
 * @returns {string[]} `['--exceptions', '<abs-path>']` або `[]`
 */
export function buildKubescapeExceptionsArgs(root) {
  const exceptionsPath = join(root, KUBESCAPE_EXCEPTIONS_FILE)
  return existsSync(exceptionsPath) ? ['--exceptions', exceptionsPath] : []
}

/**
 * Знаходить каталоги-«точки входу» Kustomize під `dir` — ті, що містять `kustomization.yaml`,
 * чий перший YAML-документ має `kind: Kustomization` (або без `kind` — типово Kustomization).
 * Kustomize Components (`kind: Component`) пропускаються: вони не білдяться окремо,
 * а підключаються через `components:` із overlay (див. k8s.mdc, секція «Kustomize: структура каталогів»).
 *
 * Семантика збігається з реальною поведінкою `kustomize build <dir>`: воно зчитує саме
 * `kustomization.yaml`, тож пошук іде за назвою файлу (без `.yml`-варіанту — заборонено каноном).
 * @param {string} dir абсолютний шлях до `…/k8s`
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи до dir-ів з білдабельним `kustomization.yaml`
 */
export async function findKustomizationDirs(dir) {
  /** @type {string[]} */
  const candidates = []
  await walkDir(dir, p => {
    if (basename(p) === KUSTOMIZATION_FILE) candidates.push(p)
  })
  /** @type {Set<string>} */
  const result = new Set()
  for (const p of candidates) {
    let text
    try {
      text = await readFile(p, 'utf8')
    } catch {
      continue
    }
    let doc
    try {
      doc = parse(text)
    } catch {
      continue
    }
    if (doc && typeof doc === 'object' && doc.kind === 'Component') continue
    result.add(dirname(p))
  }
  return [...result].toSorted((a, b) => a.localeCompare(b))
}

/**
 * Запускає `kubectl kustomize <dir>` і повертає stdout як буфер. stderr інхеритимо в термінал,
 * щоб помилки збірки (биті посилання, недозволені плагіни) було видно одразу. Використовуємо
 * вшитий у kubectl kustomize замість окремого бінарника — kubectl є штатним інструментом і не
 * потребує доступу до кластера для підкоманди `kustomize` (рендеринг локальний).
 * @param {string} kubectlPath абсолютний шлях до бінарника kubectl
 * @param {string} dir абсолютний шлях до каталогу з `kustomization.yaml`
 * @returns {{ status: number, stdout: Buffer }} статус процесу і зібраний маніфест
 */
function runKustomizeBuild(kubectlPath, dir) {
  const r = spawnSync(kubectlPath, ['kustomize', dir], {
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: false
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? Buffer.alloc(0) }
}

/**
 * Запускає `kubescape scan <file>` для зібраного kustomize-маніфесту. stdout/stderr інхерит у термінал.
 *
 * Маніфест пишемо в тимчасовий файл, бо `kubescape scan` у v4.x **не читає stdin**: `-` як шлях
 * не розпізнається (`no resources found to scan`), а прапорця типу `--input`/`--stdin` у CLI немає
 * (`kubescape scan --help` показує лише шляхи й кластер). Тимчасова директорія створюється
 * через `mkdtempSync` під `os.tmpdir()` і прибирається в `finally`.
 * @param {string} kubescapePath абсолютний шлях до бінарника kubescape
 * @param {Buffer} manifest зібраний kustomize-маніфест
 * @param {string[]} exceptionsArgs `['--exceptions', '<file>']` або `[]`
 * @returns {{ status: number, enoent: boolean }} статус процесу і прапор ENOENT
 */
function runKubescapeManifest(kubescapePath, manifest, exceptionsArgs) {
  const dir = mkdtempSync(join(tmpdir(), 'nitra-cursor-k8s-'))
  const file = join(dir, 'manifest.yaml')
  try {
    writeFileSync(file, manifest)
    const r = spawnSync(kubescapePath, ['scan', file, '--severity-threshold', 'high', ...exceptionsArgs], {
      stdio: 'inherit',
      shell: false
    })
    const enoent = Boolean(r.error && 'code' in r.error && r.error.code === 'ENOENT')
    return { status: r.status ?? 1, enoent }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Сирий dir-скан kubescape для `…/k8s`-кореня без білдабельного `kustomization.yaml`.
 * @param {string} kubescapePath абсолютний шлях до бінарника kubescape
 * @param {string} dir абсолютний шлях до `…/k8s`
 * @param {string[]} exceptionsArgs `['--exceptions', '<file>']` або `[]`
 * @returns {number} 0 при успіху, 127 якщо kubescape зник з PATH, інакше код процесу
 */
function scanRawK8sDir(kubescapePath, dir, exceptionsArgs) {
  console.log(`run-k8s: kubescape scan ${dir} (без kustomization — сирий dir-скан)`)
  const r = spawnSync(kubescapePath, ['scan', dir, '--severity-threshold', 'high', ...exceptionsArgs], {
    stdio: 'inherit',
    shell: false
  })
  if (r.error && 'code' in r.error && r.error.code === 'ENOENT') {
    console.error(KUBESCAPE_MISSING_HINT)
    return 127
  }
  return r.status ?? 1
}

/**
 * Скан kubescape'ом зібраних kustomize-маніфестів: для кожного `kustomization.yaml`-каталогу
 * `kubectl kustomize <dir>` → `kubescape scan <tmp>`.
 * @param {string} kubectlPath абсолютний шлях до бінарника kubectl
 * @param {string} kubescapePath абсолютний шлях до бінарника kubescape
 * @param {string[]} kdirs абсолютні шляхи каталогів з білдабельним `kustomization.yaml`
 * @param {string[]} exceptionsArgs `['--exceptions', '<file>']` або `[]`
 * @returns {number} 0 при успіху, 127 якщо kubescape зник з PATH, інакше код невдалого процесу
 */
function scanKustomizeK8sDirs(kubectlPath, kubescapePath, kdirs, exceptionsArgs) {
  for (const kdir of kdirs) {
    console.log(`run-k8s: kubectl kustomize ${kdir} | kubescape scan <tmp>`)
    const build = runKustomizeBuild(kubectlPath, kdir)
    if (build.status !== 0) return build.status
    const ks = runKubescapeManifest(kubescapePath, build.stdout, exceptionsArgs)
    if (ks.enoent) {
      console.error(KUBESCAPE_MISSING_HINT)
      return 127
    }
    if (ks.status !== 0) return ks.status
  }
  return 0
}

/**
 * Запускає kubescape по зібраному kustomize-маніфесту для кожного `…/k8s`-кореня. Для кожного
 * dir-у з `kustomization.yaml` (крім `kind: Component`) робимо `kubectl kustomize <dir>` і
 * передаємо stdout у `kubescape scan <tmp-file>` через тимчасовий файл (kubescape v4.x не читає
 * stdin — див. `runKubescapeManifest`). Збірка через kustomize нормалізує namespace на workload-маніфестах
 * і `base/networkpolicy.yaml` (через `base/kustomization.yaml` `namespace:`), що дає коректний
 * матчинг `podSelector` у C-0260 (`Missing network policy`) і дозволяє kubescape бачити дерево
 * overlays / components зі справжніми ресурсами.
 *
 * Якщо в `…/k8s`-корені немає жодного білдабельного kustomization.yaml (проєкт без Kustomize) —
 * fallback на старий dir-скан, щоб не блокувати чистий YAML-only набір маніфестів.
 *
 * Якщо в корені репо є `.kubescape-exceptions.json` — підмішується через `--exceptions <file>`
 * (точкові винятки control'ів, напр. C-0012 на ConfigMap з публічним JWT-конфігом; див. k8s.mdc).
 * @param {string[]} dirs абсолютні шляхи до `…/k8s`
 * @param {string} root корінь репозиторію (для пошуку exceptions-файлу)
 * @returns {Promise<number>} 0 при успіху, інакше код невдалого процесу або 127, якщо kubescape/kubectl відсутні
 */
async function runKubescape(dirs, root) {
  const exceptionsArgs = buildKubescapeExceptionsArgs(root)
  if (exceptionsArgs.length > 0) {
    console.log(`run-k8s: kubescape exceptions — ${KUBESCAPE_EXCEPTIONS_FILE}`)
  }
  const kubescapePath = ensureTool('kubescape')
  let kubectlPath = null
  for (const d of dirs) {
    const kdirs = await findKustomizationDirs(d)
    if (kdirs.length === 0) {
      const rawStatus = scanRawK8sDir(kubescapePath, d, exceptionsArgs)
      if (rawStatus !== 0) return rawStatus
      continue
    }
    if (kubectlPath === null) {
      kubectlPath = resolveCmd('kubectl')
      if (!kubectlPath) {
        console.error('kubectl не знайдено в PATH. Встанови з https://kubernetes.io/docs/tasks/tools/#kubectl')
        return 127
      }
    }
    const buildStatus = scanKustomizeK8sDirs(kubectlPath, kubescapePath, kdirs, exceptionsArgs)
    if (buildStatus !== 0) return buildStatus
  }
  return 0
}

/**
 * Внутрішні кроки `lint-k8s` без локу: kubeconform + kubescape для усіх знайдених дерев `k8s`.
 * @returns {Promise<number>} код виходу для `process.exitCode` (0 — успіх або пропуск)
 */
async function runLintK8sSteps() {
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

  const ks = await runKubescape(dirs, root)
  return ks
}

/**
 * Публічна CLI-форма: серіалізує через `withLock('lint-k8s')` + дедуп за станом git-дерева.
 * Експортовано як `runLintK8s` — використовується з `bin/n-cursor.js` як підкоманда `lint-k8s`.
 * @returns {Promise<number>} код виходу
 */
export const runLintK8s = () => runStandardLint(import.meta.dirname, runLintK8sSteps)

if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runLintK8s()
}
