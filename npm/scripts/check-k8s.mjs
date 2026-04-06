/**
 * Перевіряє Kubernetes YAML у шляхах з сегментом `k8s` (див. k8s.mdc).
 *
 * Перший рядок `# yaml-language-server: $schema=…`, без дублікатів, розширення `.yaml`
 * (окрім `kustomization.yml`); URL схеми за першим документом — kustomization / yannh / datree
 * (datree: `https://datreeio.github.io/CRDs-catalog/<group>/<kind>_<version>.json`).
 * Dockerfile — правило docker.mdc, скрипт check-docker.mjs.
 */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { pass } from './utils/pass.mjs'
import { walkDir } from './utils/walkDir.mjs'

/** Версія набору схем yannh — узгоджено з k8s.mdc */
const YANNH_PIN = 'v1.33.9-standalone-strict'

/** Гілка репозиторію yannh/kubernetes-json-schema для raw.githubusercontent.com (каталог набору в URL одразу після ref). */
const YANNH_REF = 'master'

const KUSTOMIZATION_SCHEMA = 'https://json.schemastore.org/kustomization.json'

const YANNH_BASE = `https://raw.githubusercontent.com/yannh/kubernetes-json-schema/${YANNH_REF}/${YANNH_PIN}/`

/** Публікація [CRDs-catalog](https://github.com/datreeio/CRDs-catalog) на GitHub Pages (те саме дерево, що й raw на `main`). */
const DATREE_CRD_BASE = 'https://datreeio.github.io/CRDs-catalog/'

/**
 * Групи API Kubernetes, для яких у перевірці очікується схема yannh (не datree CRD catalog).
 * `gateway.networking.k8s.io` та інші розширення поза цим списком — datree.
 */
const YANNH_GROUPS = new Set([
  'admissionregistration.k8s.io',
  'apiextensions.k8s.io',
  'apiregistration.k8s.io',
  'apps',
  'authentication.k8s.io',
  'authorization.k8s.io',
  'autoscaling',
  'batch',
  'certificates.k8s.io',
  'coordination.k8s.io',
  'discovery.k8s.io',
  'events.k8s.io',
  'flowcontrol.apiserver.k8s.io',
  'internal.apiserver.k8s.io',
  'networking.k8s.io',
  'node.k8s.io',
  'policy',
  'rbac.authorization.k8s.io',
  'resource.k8s.io',
  'scheduling.k8s.io',
  'storage.k8s.io',
  'storagemigration.k8s.io'
])

const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/

/**
 * Чи містить шлях сегмент директорії `k8s` (рівно ця назва компонента).
 * @param {string} filePath шлях до файлу
 * @returns {boolean} true, якщо серед компонентів шляху є каталог `k8s`
 */
export function pathHasK8sSegment(filePath) {
  const parts = filePath.split(/[/\\]/u)
  return parts.includes('k8s')
}

/**
 * Збирає всі yaml/yml під деревом від кореня cwd, якщо шлях містить сегмент `k8s`.
 * @param {string} root корінь репозиторію (cwd)
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи до файлів
 */
async function findK8sYamlFiles(root) {
  /** @type {string[]} */
  const out = []
  await walkDir(root, p => {
    if (!pathHasK8sSegment(p)) return
    if (!/\.ya?ml$/iu.test(p)) return
    out.push(p)
  })
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Прибирає BOM і ділить на рядки.
 * @param {string} content вміст файлу
 * @returns {string[]} рядки без BOM на початку
 */
function toLines(content) {
  const body = content.startsWith('\uFEFF') ? content.slice(1) : content
  return body.split(/\r?\n/u)
}

/**
 * Вміст після першого рядка (modeline), без провідних порожніх рядків.
 * @param {string[]} lines рядки файлу
 * @returns {string} тіло для парсингу першого YAML-документа
 */
function yamlBodyAfterModeline(lines) {
  let i = 1
  while (i < lines.length && lines[i].trim() === '') i++
  return lines.slice(i).join('\n')
}

/**
 * Перший YAML-документ (до наступного `---` на окремому рядку).
 * @param {string} body фрагмент YAML
 * @returns {string} перший документ без зайвих пробілів по краях
 */
function firstYamlDocument(body) {
  const parts = body.split(/^---\s*$/mu)
  return (parts[0] ?? body).trim()
}

/**
 * Витягує `apiVersion` та `kind` з тексту документа (без повного YAML-парсера).
 * @param {string} doc фрагмент YAML одного документа
 * @returns {{ apiVersion?: string, kind?: string }} знайдені поля або властивості відсутні
 */
function extractApiVersionAndKind(doc) {
  const av = doc.match(/^\s*apiVersion:\s*(\S+)\s*$/mu)
  const k = doc.match(/^\s*kind:\s*(\S+)\s*$/mu)
  return {
    apiVersion: av?.[1]?.replaceAll(/^["']|["']$/gu, ''),
    kind: k?.[1]?.replaceAll(/^["']|["']$/gu, '')
  }
}

/**
 * Kind для імен файлів yannh/datree: лише літери та цифри, нижній регістр (Service → service, HTTPRoute → httproute).
 * @param {string} kind значення поля kind
 * @returns {string} рядок для шаблону імені файлу схеми
 */
function kindToSchemaFilePart(kind) {
  return kind.replaceAll(/[^a-zA-Z0-9]/gu, '').toLowerCase()
}

/**
 * Очікуваний $schema для маніфесту згідно з k8s.mdc.
 * @param {string} filePath шлях до файлу (для імені kustomization)
 * @param {string} doc перший YAML-документ після modeline
 * @returns {{ expected: string | null, reason: string }} reason — для повідомлень про помилку
 */
export function expectedSchemaUrl(filePath, doc) {
  const base = basename(filePath)
  const baseLower = base.toLowerCase()

  if (baseLower === 'kustomization.yaml' || baseLower === 'kustomization.yml') {
    return { expected: KUSTOMIZATION_SCHEMA, reason: 'kustomization (ім’я файлу)' }
  }

  const { apiVersion, kind } = extractApiVersionAndKind(doc)
  if (!apiVersion || !kind) {
    return {
      expected: null,
      reason: 'не знайдено apiVersion/kind у першому документі (потрібні для перевірки $schema)'
    }
  }

  if (apiVersion === 'v1') {
    const k = kindToSchemaFilePart(kind)
    return { expected: `${YANNH_BASE}${k}-v1.json`, reason: 'core v1 (yannh)' }
  }

  if (!apiVersion.includes('/')) {
    return {
      expected: null,
      reason: `нестандартний apiVersion "${apiVersion}" — очікується v1 або group/version`
    }
  }

  const slash = apiVersion.indexOf('/')
  const group = apiVersion.slice(0, Math.max(0, slash))
  const version = apiVersion.slice(slash + 1)
  const kindPart = kindToSchemaFilePart(kind)
  const groupDash = group.replaceAll('.', '-')

  if (YANNH_GROUPS.has(group)) {
    const url = `${YANNH_BASE}${kindPart}-${groupDash}-${version}.json`
    return { expected: url, reason: 'вбудований API Kubernetes (yannh)' }
  }

  const datreeKind = kindToSchemaFilePart(kind)
  const url = `${DATREE_CRD_BASE}${group}/${datreeKind}_${version}.json`
  return { expected: url, reason: 'CRD / група поза yannh (datree CRDs-catalog)' }
}

/**
 * Підраховує рядки з modeline $schema у файлі.
 * @param {string[]} lines рядки файлу
 * @returns {number} скільки рядків містять modeline `$schema`
 */
function countSchemaModelines(lines) {
  return lines.filter(l => /^\s*#\s*yaml-language-server:\s*\$schema=\S+/u.test(l.trim())).length
}

/**
 * Перевіряє один YAML у дереві k8s (modeline, схема).
 * @param {string} abs абсолютний шлях до файлу
 * @param {string} root корінь репозиторію
 * @param {(msg: string) => void} fail реєстрація помилки
 * @param {(msg: string) => void} pass реєстрація успіху
 * @returns {Promise<void>}
 */
async function checkK8sYamlFile(abs, root, fail, pass) {
  const rel = relative(root, abs) || abs
  const base = basename(abs)
  const baseLower = base.toLowerCase()

  if (baseLower.endsWith('.yml') && baseLower !== 'kustomization.yml') {
    fail(`${rel}: розширення .yml — перейменуй на .yaml (див. k8s.mdc)`)
    return
  }

  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch (error) {
    fail(`${rel}: не вдалося прочитати (${error.message})`)
    return
  }

  const lines = toLines(raw)
  if (lines.length === 0 || lines[0].trim() === '') {
    fail(`${rel}: перший рядок порожній — потрібен # yaml-language-server: $schema=…`)
    return
  }

  const m = lines[0].match(MODELINE_RE)
  if (!m) {
    fail(`${rel}: перший рядок має бути коментарем # yaml-language-server: $schema=<url> (без префіксів перед #)`)
    return
  }

  const schemaUrl = m[1]
  if (countSchemaModelines(lines) > 1) {
    fail(`${rel}: кілька рядків yaml-language-server $schema — лиш один modeline на файл (див. k8s.mdc)`)
    return
  }

  if (schemaUrl.startsWith('file:')) {
    pass(`${rel}: локальна схема (file:) — перевірка URL за apiVersion/kind пропущена`)
    return
  }

  if (!/^https:/iu.test(schemaUrl)) {
    fail(`${rel}: $schema має бути https URL або file: (див. k8s.mdc)`)
    return
  }

  const body = yamlBodyAfterModeline(lines)
  const doc = firstYamlDocument(body)
  const { expected, reason } = expectedSchemaUrl(abs, doc)

  if (expected === null) {
    fail(`${rel}: ${reason}`)
    return
  }

  if (schemaUrl !== expected) {
    fail(`${rel}: $schema не відповідає правилу (${reason}). Очікується:\n     ${expected}\n     Зараз: ${schemaUrl}`)
    return
  }

  pass(`${rel}: $schema узгоджено (${reason})`)
}

/**
 * Перевіряє відповідність проєкту правилам k8s.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const root = process.cwd()
  const yamlFiles = await findK8sYamlFiles(root)

  if (yamlFiles.length === 0) {
    pass('Немає yaml/yml під k8s — перевірку $schema пропущено')
    return 0
  }

  pass(`YAML у k8s: ${yamlFiles.length} файл(ів)`)

  for (const abs of yamlFiles) {
    await checkK8sYamlFile(abs, root, fail, pass)
  }

  return exitCode
}
